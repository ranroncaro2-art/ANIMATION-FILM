import asyncio
import contextvars
import json
import logging
import random
import time
import hashlib
from typing import Dict, List, Optional, Type, Any
from pydantic import BaseModel
import httpx

from quota_scheduler import (
    global_scheduler,
    ApiKeyProfileInternal,
    QuotaGroupModelPool,
    DEFAULT_MODELS,
)
from database import save_profiles

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("GeminiClient")

input_tokens_var = contextvars.ContextVar("input_tokens", default=0)
output_tokens_var = contextvars.ContextVar("output_tokens", default=0)


class PromptBlocked(Exception):
    def __init__(self, reason: str, details: Optional[dict] = None, prompt_snippet: str = ""):
        self.reason = reason
        self.details = details
        self.prompt_snippet = prompt_snippet
        message = f"Gemini Safety Filter blocked this prompt. Reason: {reason}."
        if prompt_snippet:
            clean_snippet = prompt_snippet[:350].replace('\n', ' ')
            message += f" [Blocked Snippet: '{clean_snippet}...']"
        if reason == "PROHIBITED_CONTENT":
            message += " Simplify or rewrite sensitive storyboard content before retrying."
        super().__init__(message)


class OutputTruncated(Exception):
    """The model stopped because its output limit was reached; retrying unchanged is unsafe."""


_http_client: Optional[httpx.AsyncClient] = None
_http_client_lock = asyncio.Lock()


async def get_http_client() -> httpx.AsyncClient:
    global _http_client
    async with _http_client_lock:
        if _http_client is None or _http_client.is_closed:
            _http_client = httpx.AsyncClient(
                timeout=httpx.Timeout(240.0, connect=30.0, read=180.0, write=60.0),
                limits=httpx.Limits(max_keepalive_connections=30, max_connections=100, keepalive_expiry=30.0),
                follow_redirects=True,
                trust_env=True,
            )
        return _http_client


async def close_gemini_client() -> None:
    global _http_client
    if _http_client is not None:
        await _http_client.aclose()
        _http_client = None


def dereference_schema(schema: dict) -> dict:
    defs = schema.get("$defs", {})

    def resolve(node):
        if isinstance(node, dict):
            if "$ref" in node:
                ref_key = node["$ref"].split("/")[-1]
                if ref_key in defs:
                    return resolve(defs[ref_key])
            return {key: resolve(value) for key, value in node.items() if key != "$defs"}
        if isinstance(node, list):
            return [resolve(item) for item in node]
        return node

    return resolve(schema)


def clean_schema_for_gemini(node: Any) -> Any:
    """Removes OpenAPI keywords unsupported by Gemini REST API (e.g. title, default, anyOf, additionalProperties) and converts type strings to uppercase as required by Gemini REST API."""
    if isinstance(node, dict):
        if "anyOf" in node:
            non_null = [item for item in node["anyOf"] if isinstance(item, dict) and item.get("type") != "null"]
            if non_null:
                return clean_schema_for_gemini(non_null[0])

        cleaned = {}
        for key, val in node.items():
            if key in ("title", "default", "additionalProperties", "$defs", "$schema"):
                continue
            if key == "type" and isinstance(val, str):
                cleaned[key] = val.upper()
            else:
                cleaned[key] = clean_schema_for_gemini(val)
        return cleaned
    elif isinstance(node, list):
        return [clean_schema_for_gemini(item) for item in node]
    return node



def resolve_model_chain(model: str) -> List[str]:
    normalized = model.strip().lower()
    aliases = {
        "2.5 flash": "gemini-2.5-flash",
        "2.5-flash": "gemini-2.5-flash",
        "3.5 flash": "gemini-3.5-flash",
        "3.5-flash": "gemini-3.5-flash",
    }
    normalized = aliases.get(normalized, normalized)
    if normalized in {"auto", "auto-flash", "gemini-auto-flash"}:
        return list(DEFAULT_MODELS)
    if normalized == "gemini-2.5-flash":
        return ["gemini-2.5-flash", "gemini-3.5-flash"]
    if normalized == "gemini-3.5-flash":
        return ["gemini-3.5-flash", "gemini-2.5-flash"]
    return [normalized, "gemini-2.5-flash", "gemini-3.5-flash"]



def parse_retry_after(response: httpx.Response, attempt: int) -> float:
    header = response.headers.get("retry-after")
    try:
        if header:
            return min(300.0, max(1.0, float(header)))
    except ValueError:
        pass
    return min(60.0, 3.0 * (2 ** attempt) + random.uniform(0.5, 2.0))


def estimate_tokens(prompt: str, system_instruction: Optional[str] = None) -> int:
    combined_len = len(prompt) + len(system_instruction or "")
    return max(1, combined_len // 3)


async def generate_gemini_content(
    prompt: str,
    system_instruction: Optional[str] = None,
    response_schema: Optional[Type[BaseModel]] = None,
    model: str = "gemini-2.5-flash",
    profile_ids: Optional[List[str]] = None,
    raw_api_keys: Optional[List[str]] = None,
    temperature: float = 0.2,
    max_retries: int = 5,
) -> str:
    # Handle raw api keys for legacy callers
    if raw_api_keys:
        legacy_profiles = []
        for idx, k in enumerate(raw_api_keys):
            if not k or not k.strip():
                continue
            key_val = k.strip()
            group_id = "default"
            if "|" in key_val:
                g, key_clean = key_val.split("|", 1)
                group_id, key_val = g.strip(), key_clean.strip()
            # Keep legacy profile IDs stable across Python restarts so repeated
            # requests update the same local profile instead of duplicating it.
            digest = hashlib.sha256(key_val.encode("utf-8")).hexdigest()[:12]
            pid = f"legacy_key_{idx}_{digest}"
            legacy_profiles.append({
                "id": pid,
                "label": f"Legacy Key {idx + 1}",
                "apiKey": key_val,
                "quotaGroupId": group_id,
                "enabledModels": ["gemini-2.5-flash", "gemini-3.5-flash"],
                "enabled": True,
            })
        if legacy_profiles:
            save_profiles(legacy_profiles)

    profiles = global_scheduler.load_profiles_from_db_or_list(profile_ids)
    if not profiles:
        raise ValueError("No valid or active Gemini API key profiles available.")

    preferred_models = resolve_model_chain(model)
    payload: dict = {"contents": [{"parts": [{"text": prompt}]}]}
    if system_instruction:
        payload["systemInstruction"] = {"parts": [{"text": system_instruction}]}

    payload["safetySettings"] = [
        {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
        {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
        {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
        {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
        {"category": "HARM_CATEGORY_CIVIC_INTEGRITY", "threshold": "BLOCK_NONE"},
    ]

    generation_config: dict = {"temperature": temperature}
    if response_schema:
        generation_config["responseMimeType"] = "application/json"
        raw_schema = response_schema.model_json_schema()
        deref_schema = dereference_schema(raw_schema)
        generation_config["responseSchema"] = clean_schema_for_gemini(deref_schema)
    payload["generationConfig"] = generation_config

    est_tokens = estimate_tokens(prompt, system_instruction)
    errors: List[str] = []
    effective_max_retries = max(max_retries, len(profiles) * len(preferred_models) * 2)

    for attempt in range(effective_max_retries):
        try:
            profile, selected_model, pool = await global_scheduler.acquire_worker(
                profiles, preferred_models, estimated_input_tokens=est_tokens
            )
        except Exception as err:
            logger.error("Failed acquiring quota worker slot: %s", err)
            raise

        cooldown = 0.0
        invalid_key_id = None
        err_msg = None
        non_retryable = False

        try:
            client = await get_http_client()
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{selected_model}:generateContent"
            headers = {
                "Content-Type": "application/json",
                "x-goog-api-key": profile.key,
            }

            response = await client.post(url, headers=headers, json=payload)

            if response.status_code == 200:
                data = response.json()
                candidate = (data.get("candidates") or [{}])[0]
                finish_reason = candidate.get("finishReason")
                parts = candidate.get("content", {}).get("parts", [])
                text = parts[0].get("text", "") if parts else ""

                if finish_reason == "MAX_TOKENS":
                    raise OutputTruncated("Gemini output reached MAX_TOKENS; please reduce chunk size.")
                
                # If content text exists despite finish_reason SAFETY, return text safely.
                if text:
                    usage = data.get("usageMetadata", {})
                    in_count = usage.get("promptTokenCount", 0)
                    out_count = usage.get("candidatesTokenCount", 0)
                    input_tokens_var.set(input_tokens_var.get() + in_count)
                    output_tokens_var.set(output_tokens_var.get() + out_count)
                    logger.info("Gemini API success (text present, finish_reason=%s): profile=%s model=%s", finish_reason, profile.id, selected_model)
                    return text

                block_reason = data.get("promptFeedback", {}).get("blockReason") or finish_reason
                if block_reason and block_reason not in ("STOP", None):
                    if attempt < len(preferred_models) - 1:
                        logger.warning("Gemini safety block (%s) on model %s. Trying model fallback retry...", block_reason, selected_model)
                        cooldown = 1.0
                        err_msg = f"Safety block {block_reason} on {selected_model}"
                        errors.append(err_msg)
                        continue
                    logger.error("Gemini Safety Filter blocked prompt on model %s for reason: %s. Prompt snippet: %s", selected_model, block_reason, prompt[:500])
                    raise PromptBlocked(str(block_reason), data, prompt_snippet=prompt)

                if not text:
                    raise ValueError("Gemini API returned 200 OK without content text.")

                usage = data.get("usageMetadata", {})
                in_count = usage.get("promptTokenCount", 0)
                out_count = usage.get("candidatesTokenCount", 0)

                input_tokens_var.set(input_tokens_var.get() + in_count)
                output_tokens_var.set(output_tokens_var.get() + out_count)

                logger.info(
                    "Gemini API success: profile=%s group=%s model=%s input_tokens=%d output_tokens=%d",
                    profile.id,
                    pool.group_id,
                    selected_model,
                    in_count,
                    out_count,
                )
                return text

            # Handle 400 Bad Request (Invalid Schema or Payload)
            if response.status_code == 400:
                logger.error("Gemini 400 Bad Request for profile=%s model=%s: %s", profile.id, selected_model, response.text)
                err_msg = f"HTTP 400 Bad Request: {response.text[:150]}"
                errors.append(f"{selected_model}/{profile.group_id}: HTTP 400 Bad Request ({response.text[:100]})")
                non_retryable = True

            # Handle 429 Quota / Rate limit
            elif response.status_code == 429 or "resource_exhausted" in response.text.lower() or "quota" in response.text.lower():
                cooldown = parse_retry_after(response, attempt)
                err_msg = f"Quota 429 on {selected_model}/{profile.group_id}"
                errors.append(f"{selected_model}/{profile.group_id}: quota limit 429 (cooldown {cooldown:.1f}s)")
                logger.warning("429 Rate limit encountered for profile=%s pool=%s model=%s. Cooldown: %.1fs", profile.id, pool.group_id, selected_model, cooldown)

            # Handle 401/403 Auth error -> disable key
            elif response.status_code in (401, 403):
                invalid_key_id = profile.id
                err_msg = f"Auth error {response.status_code} on profile {profile.id}"
                errors.append(f"{selected_model}/{profile.id}: authentication failed ({response.status_code})")
                logger.error("Auth failure %d for key profile=%s. Key disabled.", response.status_code, profile.id)

            # Handle 5xx server errors
            else:
                cooldown = min(30.0, 2.0 * (2 ** attempt) + random.uniform(0.5, 1.5))
                err_msg = f"HTTP {response.status_code} on {selected_model}"
                errors.append(f"{selected_model}/{profile.group_id}: HTTP {response.status_code}")
                logger.warning("HTTP %d error for profile=%s model=%s", response.status_code, profile.id, selected_model)

        except (PromptBlocked, OutputTruncated):
            await global_scheduler.release_worker(pool)
            raise
        except (httpx.TimeoutException, httpx.NetworkError, httpx.RequestError) as net_err:
            cooldown = min(5.0, 1.0 + random.uniform(0.2, 1.0))
            err_desc = str(net_err).strip() or repr(net_err) or type(net_err).__name__
            err_msg = f"Network error: {err_desc}"
            errors.append(f"{selected_model}/{profile.group_id}: network error ({err_desc})")
            logger.warning("Network error for profile=%s model=%s: %s", profile.id, selected_model, err_desc)
        except Exception as gen_err:
            err_desc = str(gen_err).strip() or repr(gen_err) or type(gen_err).__name__
            err_msg = err_desc
            errors.append(f"{selected_model}/{profile.group_id}: unexpected error ({err_desc})")
            logger.error("Error executing Gemini call: %s", gen_err)
        finally:
            await global_scheduler.release_worker(
                pool,
                cooldown_seconds=cooldown,
                invalid_key_id=invalid_key_id,
                error_message=err_msg,
            )

        if non_retryable:
            break
        if cooldown > 0:
            await asyncio.sleep(min(cooldown, 5.0))

    raise RuntimeError("Gemini request failed after all retries: " + " | ".join(errors))
