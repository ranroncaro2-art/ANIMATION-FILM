import io
import zipfile
import json
from datetime import datetime
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException
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
    DialogueItem,
    SceneAnalysis,
    CharacterAsset,
    EnvironmentAsset,
    PropAsset,
    Shot,
    ShotKeyframePrompt,
    ShotMotionPrompt
)
from pipeline import (
    run_story_analyzer,
    run_assets_extractor,
    run_shot_planner,
    run_keyframe_prompt_generator,
    run_motion_prompt_generator
)

# AI Kids Animation Studio API Startup Reloaded Final V2
app = FastAPI(title="AI Kids Animation Studio API")

# Enable CORS for Next.js frontend running on localhost:3000
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Additional schemas for step-by-step endpoints ---

class AssetsRequest(BaseModel):
    storyboard: str
    scenes: List[SceneAnalysis]
    api_keys: List[str]
    model: str
    rpm_limit: int = 5
    chunk_size: int = 3

class ShotsRequest(BaseModel):
    storyboard: Optional[str] = None
    scenes: List[SceneAnalysis]
    characters: List[CharacterAsset]
    environments: List[EnvironmentAsset]
    props: List[PropAsset]
    api_keys: List[str]
    model: str
    rpm_limit: int = 5
    chunk_size: int = 3

class KeyframesRequest(BaseModel):
    shots: List[Shot]
    characters: List[CharacterAsset]
    environments: List[EnvironmentAsset]
    props: List[PropAsset]
    api_keys: List[str]
    model: str
    rpm_limit: int = 5
    chunk_size: int = 3

class MotionRequest(BaseModel):
    storyboard: str
    shots: List[Shot]
    characters: List[CharacterAsset]
    environments: List[EnvironmentAsset]
    props: List[PropAsset]
    keyframes: Optional[List[ShotKeyframePrompt]] = None
    api_keys: List[str]
    model: str
    rpm_limit: int = 5
    chunk_size: int = 3
    custom_instructions: Optional[str] = None

class ExportRequest(BaseModel):
    storyboard: str
    scenes: List[SceneAnalysis]
    characters: List[CharacterAsset]
    environments: List[EnvironmentAsset]
    props: List[PropAsset]
    shots: List[Shot]
    keyframes: List[ShotKeyframePrompt]
    motion_prompts: List[ShotMotionPrompt]
    model: str

# --- Endpoints ---

@app.get("/")
def read_root():
    return {"status": "AI Kids Animation Studio API is running"}

@app.post("/api/analyze-story", response_model=StoryAnalysisResponse)
async def analyze_story(req: PipelineRequest):
    try:
        return await run_story_analyzer(req.storyboard, req.api_keys, req.model, req.rpm_limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/extract-assets", response_model=AssetsResponse)
async def extract_assets(req: AssetsRequest):
    try:
        scenes_json = json.dumps([s.model_dump() for s in req.scenes], ensure_ascii=False)
        return await run_assets_extractor(
            req.storyboard, scenes_json, req.api_keys, req.model, req.rpm_limit, req.chunk_size
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/plan-shots", response_model=ShotPlannerResponse)
async def plan_shots(req: ShotsRequest):
    try:
        scenes_json = json.dumps([s.model_dump() for s in req.scenes], ensure_ascii=False)
        characters_json = json.dumps([c.model_dump() for c in req.characters], ensure_ascii=False)
        environments_json = json.dumps([e.model_dump() for e in req.environments], ensure_ascii=False)
        props_json = json.dumps([p.model_dump() for p in req.props], ensure_ascii=False)
        
        return await run_shot_planner(
            scenes_json, characters_json, environments_json, props_json, req.api_keys, req.model, req.rpm_limit, req.chunk_size, req.storyboard
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/generate-keyframes", response_model=KeyframePromptResponse)
async def generate_keyframes(req: KeyframesRequest):
    try:
        shots_json = json.dumps([s.model_dump() for s in req.shots], ensure_ascii=False)
        characters_json = json.dumps([c.model_dump() for c in req.characters], ensure_ascii=False)
        environments_json = json.dumps([e.model_dump() for e in req.environments], ensure_ascii=False)
        props_json = json.dumps([p.model_dump() for p in req.props], ensure_ascii=False)
        
        return await run_keyframe_prompt_generator(
            shots_json, characters_json, environments_json, props_json, req.api_keys, req.model, req.rpm_limit, req.chunk_size
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/generate-motion", response_model=MotionPromptResponse)
async def generate_motion(req: MotionRequest):
    try:
        shots_json = json.dumps([s.model_dump() for s in req.shots], ensure_ascii=False)
        characters_json = json.dumps([c.model_dump() for c in req.characters], ensure_ascii=False)
        environments_json = json.dumps([e.model_dump() for e in req.environments], ensure_ascii=False)
        props_json = json.dumps([p.model_dump() for p in req.props], ensure_ascii=False)
        
        return await run_motion_prompt_generator(
            req.storyboard, shots_json, characters_json, environments_json, props_json, req.api_keys, req.model, req.rpm_limit, req.chunk_size, req.custom_instructions
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Full auto run endpoint ---

class FullPipelineResponse(BaseModel):
    storyboard: str
    scenes: List[SceneAnalysis]
    characters: List[CharacterAsset]
    environments: List[EnvironmentAsset]
    props: List[PropAsset]
    shots: List[Shot]
    keyframes: List[ShotKeyframePrompt]
    motion_prompts: List[ShotMotionPrompt]

@app.post("/api/run-full-pipeline", response_model=FullPipelineResponse)
async def run_full_pipeline(req: PipelineRequest):
    try:
        # Step 1: Story Analyzer
        storyboard = req.storyboard
        scenes_resp = await run_story_analyzer(storyboard, req.api_keys, req.model, req.rpm_limit)
        scenes = scenes_resp.scenes
        scenes_json = json.dumps([s.model_dump() for s in scenes], ensure_ascii=False)
        
        # Step 2: Assets Extractor
        assets_resp = await run_assets_extractor(
            storyboard, scenes_json, req.api_keys, req.model, req.rpm_limit, req.chunk_size
        )
        characters = assets_resp.characters
        environments = assets_resp.environments
        props = assets_resp.props
        
        characters_json = json.dumps([c.model_dump() for c in characters], ensure_ascii=False)
        environments_json = json.dumps([e.model_dump() for e in environments], ensure_ascii=False)
        props_json = json.dumps([p.model_dump() for p in props], ensure_ascii=False)
        
        # Step 3: Shot Planner (Shot Prompt Generator)
        shots_resp = await run_shot_planner(
            scenes_json, characters_json, environments_json, props_json, req.api_keys, req.model, req.rpm_limit, req.chunk_size, storyboard
        )
        shots = shots_resp.shots
        
        # Extract keyframes and motion prompts directly from shots
        keyframes = [
            ShotKeyframePrompt(shot_id=s.shot_id, prompt=s.keyframe_prompt)
            for s in shots
        ]
        
        motion_prompts = [
            ShotMotionPrompt(shot_id=s.shot_id, prompt=s.motion_prompt)
            for s in shots
        ]
        
        return FullPipelineResponse(
            storyboard=storyboard,
            scenes=scenes,
            characters=characters,
            environments=environments,
            props=props,
            shots=shots,
            keyframes=keyframes,
            motion_prompts=motion_prompts
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Zip Export Endpoint ---

@app.post("/api/export-zip")
async def export_zip(req: ExportRequest):
    try:
        # Calculate statistics
        total_duration = sum(s.duration_seconds for s in req.scenes)
        
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
                "totalDurationSeconds": total_duration
            }
        }
        
        # Create Zip file in-memory
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
            # Write storyboard.txt
            zip_file.writestr("storyboard.txt", req.storyboard)
            
            # Write manifest.json
            zip_file.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))
            
            # Helper to write formatted JSONs
            def add_json_file(filename: str, data: Any):
                formatted_data = json.dumps(data, indent=2, ensure_ascii=False)
                zip_file.writestr(filename, formatted_data)
                
            add_json_file("character_reference.json", [c.model_dump() for c in req.characters])
            add_json_file("environment_reference.json", [e.model_dump() for e in req.environments])
            add_json_file("prop_reference.json", [p.model_dump() for p in req.props])
            add_json_file("shots.json", [s.model_dump() for s in req.shots])
            add_json_file("keyframe_prompts.json", [k.model_dump() for k in req.keyframes])
            add_json_file("motion_prompts.json", [m.model_dump() for m in req.motion_prompts])
            
        zip_buffer.seek(0)
        
        headers = {
            'Content-Disposition': 'attachment; filename="AI_Kids_Animation_Project.zip"'
        }
        return StreamingResponse(zip_buffer, media_type="application/zip", headers=headers)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
