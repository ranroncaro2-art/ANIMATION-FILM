import sqlite3
import json
import os
import threading
from datetime import datetime
from typing import Dict, List, Optional, Any

DB_PATH = os.path.join(os.path.dirname(__file__), "scheduler.db")
_db_lock = threading.Lock()


def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _db_lock:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()

            # Profiles table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS api_profiles (
                    id TEXT PRIMARY KEY,
                    label TEXT NOT NULL,
                    api_key TEXT NOT NULL,
                    quota_group_id TEXT NOT NULL,
                    enabled_models TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    rpm INTEGER NOT NULL DEFAULT 5,
                    tpm INTEGER NOT NULL DEFAULT 250000,
                    rpd INTEGER NOT NULL DEFAULT 1500,
                    max_in_flight INTEGER NOT NULL DEFAULT 1
                )
            """)

            # Quota usage tracking
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS quota_usage (
                    group_id TEXT NOT NULL,
                    model TEXT NOT NULL,
                    day_key TEXT NOT NULL,
                    requests_today INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (group_id, model, day_key)
                )
            """)

            # Jobs table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS pipeline_jobs (
                    id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    mode TEXT NOT NULL DEFAULT 'fast',
                    quality_preset TEXT NOT NULL DEFAULT 'balanced',
                    storyboard TEXT NOT NULL,
                    profile_ids TEXT NOT NULL,
                    progress REAL NOT NULL DEFAULT 0.0,
                    total_steps INTEGER NOT NULL DEFAULT 0,
                    completed_steps INTEGER NOT NULL DEFAULT 0,
                    eta_seconds REAL NOT NULL DEFAULT 0.0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    error TEXT
                )
            """)

            # Checkpoints table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS job_checkpoints (
                    job_id TEXT PRIMARY KEY,
                    scenes_json TEXT,
                    characters_json TEXT,
                    environments_json TEXT,
                    props_json TEXT,
                    shots_json TEXT,
                    keyframes_json TEXT,
                    motion_prompts_json TEXT,
                    completed_batch_indices TEXT,
                    selective_repair_queue TEXT,
                    input_tokens INTEGER DEFAULT 0,
                    output_tokens INTEGER DEFAULT 0,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (job_id) REFERENCES pipeline_jobs (id) ON DELETE CASCADE
                )
            """)

            # Auto-migrate any existing legacy model strings in api_profiles
            cursor.execute("UPDATE api_profiles SET enabled_models = ? WHERE enabled_models LIKE '%gemini-2.0-flash%'", (json.dumps(["gemini-2.5-flash", "gemini-3.5-flash"]),))

            conn.commit()
        finally:
            conn.close()


# Init schema immediately on module import
init_db()


def save_profiles(profiles_data: List[Dict[str, Any]]) -> None:
    with _db_lock:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            for p in profiles_data:
                enabled_models_str = json.dumps(p.get("enabledModels") or p.get("enabled_models") or ["gemini-2.5-flash", "gemini-3.5-flash"])
                cursor.execute("""
                    INSERT INTO api_profiles (id, label, api_key, quota_group_id, enabled_models, enabled, rpm, tpm, rpd, max_in_flight)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        label = excluded.label,
                        api_key = excluded.api_key,
                        quota_group_id = excluded.quota_group_id,
                        enabled_models = excluded.enabled_models,
                        enabled = excluded.enabled,
                        rpm = excluded.rpm,
                        tpm = excluded.tpm,
                        rpd = excluded.rpd,
                        max_in_flight = excluded.max_in_flight
                """, (
                    p["id"],
                    p.get("label", p["id"]),
                    p["apiKey"] if "apiKey" in p else p.get("api_key", ""),
                    p.get("quotaGroupId") or p.get("quota_group_id") or "default",
                    enabled_models_str,
                    1 if p.get("enabled", True) else 0,
                    p.get("rpm", 5),
                    p.get("tpm", 250000),
                    p.get("rpd", 20),
                    p.get("maxInFlight", p.get("max_in_flight", 1))
                ))
            conn.commit()
        finally:
            conn.close()


def get_all_profiles() -> List[Dict[str, Any]]:
    with _db_lock:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM api_profiles")
            rows = cursor.fetchall()
            results = []
            for r in rows:
                results.append({
                    "id": r["id"],
                    "label": r["label"],
                    "apiKey": r["api_key"],
                    "quotaGroupId": r["quota_group_id"],
                    "enabledModels": json.loads(r["enabled_models"]),
                    "enabled": bool(r["enabled"]),
                    "rpm": r["rpm"],
                    "tpm": r["tpm"],
                    "rpd": r["rpd"],
                    "maxInFlight": r["max_in_flight"]
                })
            return results
        finally:
            conn.close()


def get_profile_by_id(profile_id: str) -> Optional[Dict[str, Any]]:
    profiles = get_all_profiles()
    for p in profiles:
        if p["id"] == profile_id:
            return p
    return None


def get_daily_requests(group_id: str, model: str, day_key: str) -> int:
    with _db_lock:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT requests_today FROM quota_usage
                WHERE group_id = ? AND model = ? AND day_key = ?
            """, (group_id, model, day_key))
            row = cursor.fetchone()
            return row["requests_today"] if row else 0
        finally:
            conn.close()


def update_daily_requests(group_id: str, model: str, day_key: str, count: int) -> None:
    with _db_lock:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO quota_usage (group_id, model, day_key, requests_today)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(group_id, model, day_key) DO UPDATE SET
                    requests_today = excluded.requests_today
            """, (group_id, model, day_key, count))
            conn.commit()
        finally:
            conn.close()


def create_job(job_data: Dict[str, Any]) -> None:
    with _db_lock:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            now = datetime.now().isoformat()
            cursor.execute("""
                INSERT INTO pipeline_jobs (
                    id, status, mode, quality_preset, storyboard, profile_ids,
                    progress, total_steps, completed_steps, eta_seconds, created_at, updated_at, error
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                job_data["id"],
                job_data.get("status", "pending"),
                job_data.get("mode", "fast"),
                job_data.get("quality_preset", "balanced"),
                job_data.get("storyboard", ""),
                json.dumps(job_data.get("profile_ids", [])),
                job_data.get("progress", 0.0),
                job_data.get("total_steps", 0),
                job_data.get("completed_steps", 0),
                job_data.get("eta_seconds", 0.0),
                now,
                now,
                job_data.get("error", None)
            ))
            conn.commit()
        finally:
            conn.close()


def update_job_status(
    job_id: str,
    status: Optional[str] = None,
    progress: Optional[float] = None,
    completed_steps: Optional[int] = None,
    total_steps: Optional[int] = None,
    eta_seconds: Optional[float] = None,
    error: Optional[str] = None
) -> None:
    with _db_lock:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            now = datetime.now().isoformat()
            updates = ["updated_at = ?"]
            params = [now]
            if status is not None:
                updates.append("status = ?")
                params.append(status)
            if progress is not None:
                updates.append("progress = ?")
                params.append(progress)
            if completed_steps is not None:
                updates.append("completed_steps = ?")
                params.append(completed_steps)
            if total_steps is not None:
                updates.append("total_steps = ?")
                params.append(total_steps)
            if eta_seconds is not None:
                updates.append("eta_seconds = ?")
                params.append(eta_seconds)
            if error is not None:
                updates.append("error = ?")
                params.append(error)
            params.append(job_id)
            query = f"UPDATE pipeline_jobs SET {', '.join(updates)} WHERE id = ?"
            cursor.execute(query, params)
            conn.commit()
        finally:
            conn.close()


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    with _db_lock:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM pipeline_jobs WHERE id = ?", (job_id,))
            row = cursor.fetchone()
            if not row:
                return None
            return {
                "id": row["id"],
                "status": row["status"],
                "mode": row["mode"],
                "quality_preset": row["quality_preset"],
                "storyboard": row["storyboard"],
                "profile_ids": json.loads(row["profile_ids"]),
                "progress": row["progress"],
                "total_steps": row["total_steps"],
                "completed_steps": row["completed_steps"],
                "eta_seconds": row["eta_seconds"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "error": row["error"]
            }
        finally:
            conn.close()


def save_checkpoint(
    job_id: str,
    scenes: Optional[List[Dict[str, Any]]] = None,
    characters: Optional[List[Dict[str, Any]]] = None,
    environments: Optional[List[Dict[str, Any]]] = None,
    props: Optional[List[Dict[str, Any]]] = None,
    shots: Optional[List[Dict[str, Any]]] = None,
    keyframes: Optional[List[Dict[str, Any]]] = None,
    motion_prompts: Optional[List[Dict[str, Any]]] = None,
    completed_batch_indices: Optional[List[int]] = None,
    selective_repair_queue: Optional[List[Dict[str, Any]]] = None,
    input_tokens: Optional[int] = None,
    output_tokens: Optional[int] = None
) -> None:
    with _db_lock:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            now = datetime.now().isoformat()

            cursor.execute("SELECT * FROM job_checkpoints WHERE job_id = ?", (job_id,))
            existing = cursor.fetchone()

            scenes_str = json.dumps(scenes) if scenes is not None else (existing["scenes_json"] if existing else None)
            chars_str = json.dumps(characters) if characters is not None else (existing["characters_json"] if existing else None)
            envs_str = json.dumps(environments) if environments is not None else (existing["environments_json"] if existing else None)
            props_str = json.dumps(props) if props is not None else (existing["props_json"] if existing else None)
            shots_str = json.dumps(shots) if shots is not None else (existing["shots_json"] if existing else None)
            kf_str = json.dumps(keyframes) if keyframes is not None else (existing["keyframes_json"] if existing else None)
            mp_str = json.dumps(motion_prompts) if motion_prompts is not None else (existing["motion_prompts_json"] if existing else None)
            batches_str = json.dumps(completed_batch_indices) if completed_batch_indices is not None else (existing["completed_batch_indices"] if existing else None)
            repair_str = json.dumps(selective_repair_queue) if selective_repair_queue is not None else (existing["selective_repair_queue"] if existing else None)
            in_tok = input_tokens if input_tokens is not None else (existing["input_tokens"] if existing else 0)
            out_tok = output_tokens if output_tokens is not None else (existing["output_tokens"] if existing else 0)

            cursor.execute("""
                INSERT INTO job_checkpoints (
                    job_id, scenes_json, characters_json, environments_json, props_json,
                    shots_json, keyframes_json, motion_prompts_json, completed_batch_indices,
                    selective_repair_queue, input_tokens, output_tokens, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(job_id) DO UPDATE SET
                    scenes_json = excluded.scenes_json,
                    characters_json = excluded.characters_json,
                    environments_json = excluded.environments_json,
                    props_json = excluded.props_json,
                    shots_json = excluded.shots_json,
                    keyframes_json = excluded.keyframes_json,
                    motion_prompts_json = excluded.motion_prompts_json,
                    completed_batch_indices = excluded.completed_batch_indices,
                    selective_repair_queue = excluded.selective_repair_queue,
                    input_tokens = excluded.input_tokens,
                    output_tokens = excluded.output_tokens,
                    updated_at = excluded.updated_at
            """, (
                job_id, scenes_str, chars_str, envs_str, props_str,
                shots_str, kf_str, mp_str, batches_str, repair_str,
                in_tok, out_tok, now
            ))
            conn.commit()
        finally:
            conn.close()


def get_checkpoint(job_id: str) -> Optional[Dict[str, Any]]:
    with _db_lock:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM job_checkpoints WHERE job_id = ?", (job_id,))
            row = cursor.fetchone()
            if not row:
                return None
            return {
                "job_id": row["job_id"],
                "scenes": json.loads(row["scenes_json"]) if row["scenes_json"] else [],
                "characters": json.loads(row["characters_json"]) if row["characters_json"] else [],
                "environments": json.loads(row["environments_json"]) if row["environments_json"] else [],
                "props": json.loads(row["props_json"]) if row["props_json"] else [],
                "shots": json.loads(row["shots_json"]) if row["shots_json"] else [],
                "keyframes": json.loads(row["keyframes_json"]) if row["keyframes_json"] else [],
                "motion_prompts": json.loads(row["motion_prompts_json"]) if row["motion_prompts_json"] else [],
                "completed_batch_indices": json.loads(row["completed_batch_indices"]) if row["completed_batch_indices"] else [],
                "selective_repair_queue": json.loads(row["selective_repair_queue"]) if row["selective_repair_queue"] else [],
                "input_tokens": row["input_tokens"] or 0,
                "output_tokens": row["output_tokens"] or 0,
                "updated_at": row["updated_at"]
            }
        finally:
            conn.close()
