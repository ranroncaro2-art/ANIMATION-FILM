import asyncio
import io
import json
import logging
import uuid
import zipfile
from datetime import datetime
from typing import List, Dict, Any, Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from schemas import (
    PipelineRequest,
    StoryAnalysisResponse,
    AssetsResponse,
    ShotPlannerResponse,
    KeyframePromptResponse,
    MotionPromptResponse,
    SceneAnalysis,
    CharacterAsset,
    EnvironmentAsset,
    PropAsset,
    Shot,
    ShotKeyframePrompt,
    ShotMotionPrompt,
    ApiKeyProfilePayload,
    JobCreateRequest,
    JobStatusResponse,
    StandardizedShotData,
    ArtStylePreset,
)
from pipeline import (
    run_story_analyzer,
    run_assets_extractor,
    run_shot_planner_batch,
    chunk_scenes_by_tokens,
    execute_pipeline_job,
    compile_motion_prompt,
    DEFAULT_STYLE_PRESETS,
    parse_storyboard_to_standardized_shots,
    standardized_shots_to_shots,
    assemble_prompts,
)
from gemini_client import input_tokens_var, output_tokens_var, close_gemini_client
from quota_scheduler import global_scheduler
from database import (
    save_profiles,
    get_all_profiles,
    create_job,
    update_job_status,
    get_job,
    get_checkpoint,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("MainAPI")

app = FastAPI(title="TOOL ANIMATION FILM PRO API - Quota Aware Job Scheduler")

@app.on_event("shutdown")
async def shutdown_gemini_client():
    await close_gemini_client()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

active_job_tasks: Dict[str, asyncio.Task] = {}


@app.get("/")
def read_root():
    return {"status": "TOOL ANIMATION FILM PRO API is running with Quota-Aware Scheduler"}


@app.get("/api/system/mac")
def get_system_mac_address():
    try:
        raw_mac = uuid.getnode()
        mac_str = ':'.join(['{:02x}'.format((raw_mac >> element) & 0xff) for element in range(0, 8*6, 8)][::-1]).upper()
        if mac_str == "00:00:00:00:00:00":
            return {"success": False, "mac": "MAC-NOT-FOUND"}
        return {"success": True, "mac": mac_str}
    except Exception as err:
        return {"success": False, "mac": "ERROR-FETCHING-MAC", "error": str(err)}


# --- API Profile & Quota Endpoints ---

@app.post("/api/gemini/profiles")
async def save_gemini_profiles(profiles: List[ApiKeyProfilePayload]):
    """Save or update API key profiles and declared quota limits in SQLite."""
    try:
        dicts = [p.model_dump() for p in profiles]
        save_profiles(dicts)
        return {"success": True, "count": len(profiles), "profiles": get_all_profiles()}
    except Exception as e:
        logger.error("Error saving profiles: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/gemini/profiles")
async def get_gemini_profiles():
    """Retrieve configured API key profiles (with masked keys for UI)."""
    profiles = get_all_profiles()
    masked = []
    for p in profiles:
        raw_k = p.get("apiKey", "")
        masked_k = f"{raw_k[:8]}••••{raw_k[-4:]}" if len(raw_k) > 12 else "••••••••••••"
        p_copy = dict(p)
        p_copy["apiKeyMasked"] = masked_k
        masked.append(p_copy)
    return {"profiles": masked}


@app.get("/api/gemini/quota-status")
async def gemini_quota_status():
    """Expose real-time scheduler quota pool state for the desktop UI."""
    return {"groups": await global_scheduler.get_quota_status()}


# --- Async Pipeline Job Endpoints ---

@app.post("/api/pipeline-jobs", response_model=JobStatusResponse)
async def create_pipeline_job(req: JobCreateRequest, background_tasks: BackgroundTasks):
    """Start an asynchronous background pipeline job with checkpointing & quota scheduling."""
    try:
        # Save inline profiles if provided
        if req.profiles:
            save_profiles([p.model_dump() for p in req.profiles])

        job_id = f"job_{uuid.uuid4().hex[:10]}"
        job_data = {
            "id": job_id,
            "status": "pending",
            "mode": req.mode,
            "quality_preset": req.quality_preset,
            "storyboard": req.storyboard,
            "profile_ids": req.profile_ids or [],
            "progress": 0.0,
            "total_steps": 5,
            "completed_steps": 0,
            "eta_seconds": global_scheduler.estimate_eta_seconds(10),
        }
        create_job(job_data)

        # Launch background task
        async def _run_job_wrapper():
            try:
                await execute_pipeline_job(
                    job_id=job_id,
                    storyboard=req.storyboard,
                    profile_ids=req.profile_ids,
                    mode=req.mode,
                    quality_preset=req.quality_preset,
                )
            except asyncio.CancelledError:
                logger.warning("Job %s was cancelled.", job_id)
                update_job_status(job_id, status="cancelled", error="Job cancelled by user")
            except Exception as err:
                logger.error("Job %s failed: %s", job_id, err)
                update_job_status(job_id, status="failed", error=str(err))
            finally:
                active_job_tasks.pop(job_id, None)

        task = asyncio.create_task(_run_job_wrapper())
        active_job_tasks[job_id] = task

        job_info = get_job(job_id)
        return JobStatusResponse(
            id=job_info["id"],
            status=job_info["status"],
            mode=job_info["mode"],
            quality_preset=job_info["quality_preset"],
            progress=job_info["progress"],
            total_steps=job_info["total_steps"],
            completed_steps=job_info["completed_steps"],
            eta_seconds=job_info["eta_seconds"],
            created_at=job_info["created_at"],
            updated_at=job_info["updated_at"],
            error=job_info["error"],
        )
    except Exception as e:
        logger.error("Failed creating job: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/pipeline-jobs/{job_id}", response_model=JobStatusResponse)
async def get_pipeline_job_status(job_id: str):
    """Poll progress, ETA, status, and output checkpoint for a pipeline job."""
    job_info = get_job(job_id)
    if not job_info:
        raise HTTPException(status_code=404, detail="Job not found")

    ckpt = get_checkpoint(job_id)
    return JobStatusResponse(
        id=job_info["id"],
        status=job_info["status"],
        mode=job_info["mode"],
        quality_preset=job_info["quality_preset"],
        progress=job_info["progress"],
        total_steps=job_info["total_steps"],
        completed_steps=job_info["completed_steps"],
        eta_seconds=job_info["eta_seconds"],
        created_at=job_info["created_at"],
        updated_at=job_info["updated_at"],
        error=job_info["error"],
        checkpoint=ckpt if ckpt else None,
    )


@app.post("/api/pipeline-jobs/{job_id}/cancel")
async def cancel_pipeline_job(job_id: str):
    """Cancel a running pipeline job."""
    job_info = get_job(job_id)
    if not job_info:
        raise HTTPException(status_code=404, detail="Job not found")

    if job_id in active_job_tasks:
        active_job_tasks[job_id].cancel()
        active_job_tasks.pop(job_id, None)

    update_job_status(job_id, status="cancelled", error="Cancelled by user")
    return {"success": True, "message": f"Job {job_id} cancelled"}


@app.post("/api/pipeline-jobs/{job_id}/resume", response_model=JobStatusResponse)
async def resume_pipeline_job(job_id: str):
    """Resume a paused or interrupted job from its SQLite checkpoint."""
    job_info = get_job(job_id)
    if not job_info:
        raise HTTPException(status_code=404, detail="Job not found")

    if job_id in active_job_tasks and not active_job_tasks[job_id].done():
        return await get_pipeline_job_status(job_id)

    update_job_status(job_id, status="running", error=None)

    async def _resume_wrapper():
        try:
            await execute_pipeline_job(
                job_id=job_id,
                storyboard=job_info["storyboard"],
                profile_ids=job_info["profile_ids"],
                mode=job_info["mode"],
                quality_preset=job_info["quality_preset"],
            )
        except Exception as err:
            logger.error("Resumed job %s failed: %s", job_id, err)
            update_job_status(job_id, status="failed", error=str(err))
        finally:
            active_job_tasks.pop(job_id, None)

    task = asyncio.create_task(_resume_wrapper())
    active_job_tasks[job_id] = task

    return await get_pipeline_job_status(job_id)


# --- Simplified Pipeline Endpoints ---

@app.get("/api/style-presets", response_model=List[ArtStylePreset])
async def get_style_presets():
    """Returns all available Art Style Presets."""
    return list(DEFAULT_STYLE_PRESETS.values())


@app.post("/api/assemble-storyboard", response_model=List[StandardizedShotData])
async def assemble_storyboard(req: PipelineRequest):
    """Parses standardized storyboard deterministically and assembles image and video prompts using selected Art Style Preset."""
    try:
        shots = parse_storyboard_to_standardized_shots(req.storyboard)
        assembled_shots = assemble_prompts(shots, style_preset_id=req.style_preset_id)
        return assembled_shots
    except Exception as e:
        logger.error("Error assembling storyboard prompts: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# --- Legacy Step Endpoints for Backwards Compatibility ---

@app.post("/api/analyze-story", response_model=StoryAnalysisResponse)
async def analyze_story(req: PipelineRequest):
    try:
        input_tokens_var.set(0)
        output_tokens_var.set(0)
        res = await run_story_analyzer(req.storyboard, raw_api_keys=req.api_keys, model=req.model)
        res.input_tokens = input_tokens_var.get()
        res.output_tokens = output_tokens_var.get()
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/extract-assets", response_model=AssetsResponse)
async def extract_assets(req: PipelineRequest):
    try:
        input_tokens_var.set(0)
        output_tokens_var.set(0)
        # The frontend already sends the result of Story Analyzer. Reusing it
        # removes an otherwise hidden, duplicate Gemini call.
        scenes = req.scenes
        if not scenes:
            scenes_res = await run_story_analyzer(req.storyboard, raw_api_keys=req.api_keys, model=req.model)
            scenes = scenes_res.scenes
        scenes_json = json.dumps([s.model_dump() for s in scenes], ensure_ascii=False)
        res = await run_assets_extractor(req.storyboard, scenes_json, raw_api_keys=req.api_keys, model=req.model)
        res.input_tokens = input_tokens_var.get()
        res.output_tokens = output_tokens_var.get()
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/plan-shots", response_model=ShotPlannerResponse)
async def plan_shots_legacy(req: PipelineRequest):
    """Compatibility endpoint used by the existing Electron/Next frontend."""
    try:
        input_tokens_var.set(0)
        output_tokens_var.set(0)
        
        # Check deterministic Regex parser first
        std_shots = parse_storyboard_to_standardized_shots(req.storyboard) if req.storyboard else []
        if std_shots:
            logger.info("Deterministic Regex parser matched %d shots! Skipping Gemini AI shot planner.", len(std_shots))
            shots = standardized_shots_to_shots(std_shots, style_preset_id=req.style_preset_id or "3d_pixar")
            return ShotPlannerResponse(shots=shots, input_tokens=0, output_tokens=0)

        scenes = req.scenes or []
        if not scenes:
            scenes = (await run_story_analyzer(req.storyboard, raw_api_keys=req.api_keys, model=req.model)).scenes
        batches = chunk_scenes_by_tokens(scenes, preset=req.quality_preset)
        valid_keys = [k for k in (req.api_keys or []) if k and k.strip()]

        async def run_batch(index: int, batch_scenes: List[SceneAnalysis]):
            s_start = batch_scenes[0].scene_number if batch_scenes else 0
            s_end = batch_scenes[-1].scene_number if batch_scenes else 0
            assigned_keys = [valid_keys[index % len(valid_keys)]] if valid_keys else req.api_keys
            key_tag = f"Key #{index % len(valid_keys) + 1}" if valid_keys else "Default Key"
            logger.info("▶ [Multi-Key Parallel: %s] Đang lập kế hoạch Shot Batch %d/%d (Scene %d -> Scene %d)...", key_tag, index + 1, len(batches), s_start, s_end)
            shots = await run_shot_planner_batch(
                batch_scenes,
                req.characters or [],
                req.environments or [],
                req.props or [],
                model=req.model,
                raw_api_keys=assigned_keys,
            )
            logger.info("✔ [Multi-Key Parallel: %s] Hoàn thành Batch %d/%d (Scenes %d-%d) -> Đã sinh %d Shots!", key_tag, index + 1, len(batches), s_start, s_end, len(shots))
            return index, shots

        # Scene state ledgers make these batches independent. The quota scheduler
        # still enforces the real per-group/model concurrency and rate limits.
        results = await asyncio.gather(*(run_batch(index, batch) for index, batch in enumerate(batches)))
        shots = [shot for _, batch_shots in sorted(results, key=lambda item: item[0]) for shot in batch_shots]
        for index, shot in enumerate(shots, start=1):
            shot.shot_id = f"Shot{index:03d}"
        return ShotPlannerResponse(
            shots=shots,
            input_tokens=input_tokens_var.get(),
            output_tokens=output_tokens_var.get(),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/stream-plan-shots")
async def stream_plan_shots(req: PipelineRequest):
    """Stream shot planning results batch-by-batch via NDJSON as soon as each batch finishes."""
    async def event_generator():
        try:
            input_tokens_var.set(0)
            output_tokens_var.set(0)

            # Check deterministic Regex parser first
            std_shots = parse_storyboard_to_standardized_shots(req.storyboard) if req.storyboard else []
            if std_shots:
                logger.info("Deterministic Regex parser matched %d shots! Skipping Gemini AI shot planner.", len(std_shots))
                shots = standardized_shots_to_shots(std_shots, style_preset_id=req.style_preset_id or "3d_pixar")
                yield json.dumps({"type": "init", "total_batches": 1, "total_scenes": len(shots), "is_regex": True}, ensure_ascii=False) + "\n"
                batch_payload = {
                    "type": "batch_complete",
                    "batch_index": 0,
                    "total_batches": 1,
                    "scene_range": f"Scene 1-{len(shots)}",
                    "shots": [s.model_dump() for s in shots],
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "is_regex": True
                }
                yield json.dumps(batch_payload, ensure_ascii=False) + "\n"
                final_payload = {
                    "type": "done",
                    "shots": [s.model_dump() for s in shots],
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "is_regex": True
                }
                yield json.dumps(final_payload, ensure_ascii=False) + "\n"
                return

            batches = chunk_scenes_by_tokens(scenes, preset=req.quality_preset)
            total_batches = len(batches)
            valid_keys = [k for k in (req.api_keys or []) if k and k.strip()]

            # 1. Send init metadata
            yield json.dumps({"type": "init", "total_batches": total_batches, "total_scenes": len(scenes)}, ensure_ascii=False) + "\n"

            all_batch_results: List[Tuple[int, List[Shot]]] = []

            async def process_batch(index: int, batch_scenes: List[SceneAnalysis]):
                s_start = batch_scenes[0].scene_number if batch_scenes else 0
                s_end = batch_scenes[-1].scene_number if batch_scenes else 0
                assigned_keys = [valid_keys[index % len(valid_keys)]] if valid_keys else req.api_keys
                key_tag = f"Key #{index % len(valid_keys) + 1}" if valid_keys else "Default Key"
                logger.info("▶ [Multi-Key Parallel: %s] Đang lập kế hoạch Shot Batch %d/%d (Scene %d -> Scene %d)...", key_tag, index + 1, total_batches, s_start, s_end)
                shots = await run_shot_planner_batch(
                    batch_scenes,
                    req.characters or [],
                    req.environments or [],
                    req.props or [],
                    model=req.model,
                    raw_api_keys=assigned_keys,
                )
                logger.info("✔ [Multi-Key Parallel: %s] Hoàn thành Batch %d/%d (Scenes %d-%d) -> Đã sinh %d Shots!", key_tag, index + 1, total_batches, s_start, s_end, len(shots))
                return index, shots, s_start, s_end

            tasks = [asyncio.create_task(process_batch(idx, b)) for idx, b in enumerate(batches)]

            for completed_task in asyncio.as_completed(tasks):
                idx, shots, s_start, s_end = await completed_task
                all_batch_results.append((idx, shots))
                batch_payload = {
                    "type": "batch_complete",
                    "batch_index": idx,
                    "total_batches": total_batches,
                    "scene_range": f"Scene {s_start}-{s_end}",
                    "shots": [s.model_dump() for s in shots],
                    "input_tokens": input_tokens_var.get(),
                    "output_tokens": output_tokens_var.get(),
                }
                yield json.dumps(batch_payload, ensure_ascii=False) + "\n"

            # 2. Final sorted list of all shots
            sorted_shots = [shot for _, batch_shots in sorted(all_batch_results, key=lambda item: item[0]) for shot in batch_shots]
            for index, shot in enumerate(sorted_shots, start=1):
                shot.shot_id = f"Shot{index:03d}"

            final_payload = {
                "type": "done",
                "shots": [s.model_dump() for s in sorted_shots],
                "input_tokens": input_tokens_var.get(),
                "output_tokens": output_tokens_var.get(),
            }
            yield json.dumps(final_payload, ensure_ascii=False) + "\n"

        except Exception as e:
            logger.error("Error streaming plan shots: %s", e)
            yield json.dumps({"type": "error", "message": str(e)}, ensure_ascii=False) + "\n"

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")


@app.post("/api/generate-keyframes", response_model=KeyframePromptResponse)
async def generate_keyframes_legacy(req: PipelineRequest):
    """Shot Planner already produces usable keyframes; do not spend duplicate quota."""
    keyframes = [
        ShotKeyframePrompt(shot_id=shot.shot_id, prompt=shot.keyframe_prompt)
        for shot in (req.shots or [])
    ]
    return KeyframePromptResponse(keyframes=keyframes, input_tokens=0, output_tokens=0)


@app.post("/api/generate-motion", response_model=MotionPromptResponse)
async def generate_motion_legacy(req: PipelineRequest):
    """Compile motion prompts according to structured spec."""
    character_map = {
        (character.canonical_name or character.name).lower(): character
        for character in (req.characters or [])
        if character.canonical_name or character.name
    }
    prompts = []
    for shot in req.shots or []:
        if shot.motion_prompt and "SCENE:" in shot.motion_prompt and "SPATIAL RULES:" in shot.motion_prompt:
            prompt = shot.motion_prompt
        else:
            prompt = compile_motion_prompt(shot, character_map)
            shot.motion_prompt = prompt
        prompts.append(ShotMotionPrompt(shot_id=shot.shot_id, prompt=prompt))
    return MotionPromptResponse(motion_prompts=prompts, input_tokens=0, output_tokens=0)


class ExportRequest(BaseModel):
    storyboard: str
    scenes: List[SceneAnalysis]
    characters: List[CharacterAsset]
    environments: List[EnvironmentAsset]
    props: List[PropAsset]
    shots: List[Shot]
    keyframes: List[ShotKeyframePrompt]
    motion_prompts: List[ShotMotionPrompt]
    model: str = "gemini-2.5-flash"


@app.post("/api/export-zip")
async def export_zip(req: ExportRequest):
    """Keep the existing ZIP export contract used by the frontend."""
    try:
        manifest = {
            "projectName": "AI Kids Animation Project",
            "exportTime": datetime.now().isoformat(),
            "modelUsed": req.model,
            "stats": {
                "numScenes": len(req.scenes),
                "numShots": len(req.shots),
                "numCharacters": len(req.characters),
                "numEnvironments": len(req.environments),
                "numProps": len(req.props),
                "totalDurationSeconds": sum(scene.duration_seconds for scene in req.scenes),
            },
        }
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("storyboard.txt", req.storyboard)
            archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
            archive.writestr("character_reference.json", json.dumps([item.model_dump() for item in req.characters], ensure_ascii=False, indent=2))
            archive.writestr("environment_reference.json", json.dumps([item.model_dump() for item in req.environments], ensure_ascii=False, indent=2))
            archive.writestr("prop_reference.json", json.dumps([item.model_dump() for item in req.props], ensure_ascii=False, indent=2))
            archive.writestr("shots.json", json.dumps([item.model_dump() for item in req.shots], ensure_ascii=False, indent=2))
            archive.writestr("keyframe_prompts.json", json.dumps([item.model_dump() for item in req.keyframes], ensure_ascii=False, indent=2))
            archive.writestr("motion_prompts.json", json.dumps([item.model_dump() for item in req.motion_prompts], ensure_ascii=False, indent=2))
        buffer.seek(0)
        return StreamingResponse(
            buffer,
            media_type="application/zip",
            headers={"Content-Disposition": "attachment; filename=AI_Kids_Animation_Project.zip"},
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
