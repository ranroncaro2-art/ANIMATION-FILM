import httpx
import json
import logging
import asyncio
import time
import contextvars
from typing import List, Optional, Type
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("GeminiClient")

# Context variables to track input/output tokens per request lifecycle
input_tokens_var = contextvars.ContextVar("input_tokens", default=0)
output_tokens_var = contextvars.ContextVar("output_tokens", default=0)

# Rate limit tracking variables
last_request_time = 0.0
request_lock = asyncio.Lock()

class PromptBlocked(Exception):
    """Exception raised when the Gemini API blocks a prompt or output due to safety settings."""
    def __init__(self, reason: str, details: Optional[dict] = None):
        self.reason = reason
        self.details = details
        msg = f"Gemini Safety Filter blocked this prompt. Reason: {reason}."
        if reason == "PROHIBITED_CONTENT":
            msg += " Please simplify the storyboard or rewrite/remove unsafe or sensitive content (e.g. references to weapons, violence, injury, abuse, or highly sensitive child actions)."
        super().__init__(msg)

async def enforce_rate_limit(rpm_limit: int = 5, num_keys: int = 1):
    """
    Blocks execution if the time since the last request is less than (60 / effective_rpm) seconds.
    This guarantees that requests are spaced out to conform to the Requests Per Minute (RPM) quota.
    When multiple API keys are provided, rate limits are distributed across keys.
    """
    global last_request_time
    if rpm_limit <= 0:
        return
        
    effective_rpm = rpm_limit * max(1, num_keys)
    delay_between_requests = 60.0 / effective_rpm
    
    async with request_lock:
        now = time.time()
        elapsed = now - last_request_time
        if elapsed < delay_between_requests:
            sleep_time = delay_between_requests - elapsed
            logger.info(f"Rate limiter: Sleeping for {sleep_time:.2f}s to respect the limit of {effective_rpm} RPM...")
            await asyncio.sleep(sleep_time)
        # Record the time immediately before returning to proceed with the request
        last_request_time = time.time()


def dereference_schema(schema: dict) -> dict:
    """
    Recursively replaces all $ref references with their actual definitions from $defs,
    and removes $defs from the schema. This is necessary because Gemini's schema parser
    does not support local references ($ref) under $defs.
    """
    defs = schema.get("$defs", {})
    
    def resolve(node):
        if isinstance(node, dict):
            if "$ref" in node:
                ref_path = node["$ref"]
                # e.g., "#/$defs/DialogueItem" -> "DialogueItem"
                ref_key = ref_path.split("/")[-1]
                if ref_key in defs:
                    # Recursively resolve the referenced definition
                    return resolve(defs[ref_key])
            return {k: resolve(v) for k, v in node.items() if k != "$defs"}
        elif isinstance(node, list):
            return [resolve(item) for item in node]
        return node
        
    resolved = resolve(schema)
    # Ensure any remaining $defs is purged
    if "$defs" in resolved:
        del resolved["$defs"]
    return resolved

async def generate_gemini_content(
    api_keys: List[str],
    model: str,
    prompt: str,
    system_instruction: Optional[str] = None,
    response_schema: Optional[Type[BaseModel]] = None,
    temperature: float = 0.2,
    rpm_limit: int = 5
) -> str:
    """
    Calls the Gemini API to generate content with fallback/rotation logic.
    Rotates to the next API key in the list if the current one fails (e.g. rate limit, quota, invalid key).
    Also supports falling back to other models (e.g., Flash models if Pro model quota is exhausted).
    """
    if not api_keys:
        raise ValueError("No API keys provided. Please supply at least one Gemini API key.")

    # Strip whitespace from keys
    api_keys = [k.strip() for k in api_keys if k.strip()]
    if not api_keys:
        raise ValueError("Provided API keys are empty or invalid.")

    # Clean up model name
    model = model.strip()
    model_mapping = {
        "2.5 flash": "gemini-2.5-flash",
        "2.5-flash": "gemini-2.5-flash",
        "3.5 flash": "gemini-3.5-flash", 
        "3.5-flash": "gemini-3.5-flash",
    }
    normalized_model = model_mapping.get(model.lower(), model)

    # Establish fallback chain for the model (only using 2.5-flash and 3.5-flash, removing all others)
    fallback_chain = [normalized_model]
    if normalized_model == "gemini-3.5-flash":
        fallback_chain.append("gemini-2.5-flash")
    elif normalized_model == "gemini-2.5-flash":
        fallback_chain.append("gemini-3.5-flash")
    else:
        # Default fallback to 2.5-flash if model is unrecognized or deprecated
        fallback_chain = ["gemini-2.5-flash", "gemini-3.5-flash"]

    # Remove duplicates preserving order
    unique_chain = []
    for m in fallback_chain:
        if m not in unique_chain:
            unique_chain.append(m)

    last_exception = None

    for current_model in unique_chain:
        if current_model != normalized_model:
            logger.warning(f"Fallback active: attempting request with fallback model '{current_model}' (primary: '{normalized_model}')...")

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{current_model}:generateContent"

        # Prepare request body
        contents = [
            {
                "parts": [
                    {"text": prompt}
                ]
            }
        ]
        
        payload = {
            "contents": contents
        }

        if system_instruction:
            payload["systemInstruction"] = {
                "parts": [
                    {"text": system_instruction}
                ]
            }

        # Configure safety settings to avoid false positives for children-related prompts
        payload["safetySettings"] = [
            {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
        ]

        # Configure generation config
        generation_config = {
            "temperature": temperature
        }
        
        if response_schema:
            raw_schema = response_schema.model_json_schema()
            clean_schema = dereference_schema(raw_schema)
            generation_config["responseMimeType"] = "application/json"
            generation_config["responseSchema"] = clean_schema
            
        payload["generationConfig"] = generation_config

        errors = []
        
        # Rotate through API keys
        for index, api_key in enumerate(api_keys):
            masked_key = f"{api_key[:8]}...{api_key[-4:]}" if len(api_key) > 12 else "INVALID_KEY_FORMAT"
            
            headers = {
                "Content-Type": "application/json",
                "x-goog-api-key": api_key
            }
            
            max_retries = 3
            backoff_factor = 2.0
            initial_delay = 3.0
            
            for retry in range(max_retries + 1):
                try:
                    # Enforce rate limits (Requests Per Minute), scaling with available API keys
                    await enforce_rate_limit(rpm_limit, len(api_keys))
                    
                    if retry > 0:
                        logger.info(f"Attempting API request (Retry {retry}/{max_retries}) using key index {index} ({masked_key}) with model '{current_model}'...")
                    else:
                        logger.info(f"Attempting API request using key index {index} ({masked_key}) with model '{current_model}'...")
                    
                    async with httpx.AsyncClient(timeout=60.0) as client:
                        response = await client.post(url, headers=headers, json=payload)
                        
                        if response.status_code == 200:
                            data = response.json()
                            
                            # Check for promptFeedback block (safety/prohibited content)
                            prompt_feedback = data.get("promptFeedback", {})
                            block_reason = prompt_feedback.get("blockReason")
                            if block_reason:
                                raise PromptBlocked(block_reason, data)
                            
                            candidates = data.get("candidates", [])
                            if candidates and len(candidates) > 0:
                                candidate = candidates[0]
                                finish_reason = candidate.get("finishReason")
                                if finish_reason and finish_reason not in ("STOP", "MAX_TOKENS"):
                                    raise PromptBlocked(finish_reason, data)
                                
                                parts = candidate.get("content", {}).get("parts", [])
                                if parts and len(parts) > 0:
                                    text = parts[0].get("text", "")
                                    
                                    # Parse token usage metadata
                                    usage = data.get("usageMetadata", {})
                                    prompt_tokens = usage.get("promptTokenCount", 0)
                                    candidates_tokens = usage.get("candidatesTokenCount", 0)
                                    input_tokens_var.set(input_tokens_var.get() + prompt_tokens)
                                    output_tokens_var.set(output_tokens_var.get() + candidates_tokens)
                                    
                                    logger.info(
                                        f"API request succeeded with key index {index} using model '{current_model}'. "
                                        f"Tokens this call: Input={prompt_tokens}, Output={candidates_tokens}. "
                                        f"Accumulated in lifecycle: Input={input_tokens_var.get()}, Output={output_tokens_var.get()}"
                                    )
                                    return text
                            raise ValueError(f"Gemini API returned 200 OK but structure was unexpected: {json.dumps(data)}")
                        
                        elif response.status_code == 429 or "resource_exhausted" in response.text.lower() or "quota" in response.text.lower():
                            if retry < max_retries:
                                delay = initial_delay * (backoff_factor ** (retry))
                                logger.warning(f"Rate limit or Quota error (HTTP {response.status_code}) hit on key index {index}. Retrying in {delay:.1f}s...")
                                await asyncio.sleep(delay)
                                continue
                            else:
                                error_msg = f"HTTP {response.status_code}: {response.text}"
                                logger.warning(f"Key index {index} failed after {max_retries} retries with model '{current_model}': {error_msg}")
                                errors.append(f"Key {index} ({masked_key}): {error_msg}")
                                break
                        else:
                            error_msg = f"HTTP {response.status_code}: {response.text}"
                            logger.warning(f"Key index {index} failed with HTTP code {response.status_code} on model '{current_model}': {error_msg}")
                            errors.append(f"Key {index} ({masked_key}): {error_msg}")
                            break
                            
                except PromptBlocked as pb:
                    logger.error(f"Safety block encountered: {pb}. Aborting key rotation.")
                    raise pb
                except ValueError as ve:
                    error_msg = str(ve)
                    logger.warning(f"Key index {index} encountered ValueError: {error_msg}")
                    errors.append(f"Key {index} ({masked_key}) error: {error_msg}")
                    break
                except Exception as e:
                    error_msg = str(e)
                    if retry < max_retries:
                        delay = initial_delay * (backoff_factor ** (retry))
                        logger.warning(f"Connection or timeout error: {error_msg}. Retrying in {delay:.1f}s...")
                        await asyncio.sleep(delay)
                        continue
                    else:
                        logger.warning(f"Key index {index} encountered exception with model '{current_model}' after {max_retries} retries: {error_msg}")
                        errors.append(f"Key {index} ({masked_key}) error: {error_msg}")
                        break
                
        # If we exited the key loop, all keys failed for this model
        all_errors_summary = " | ".join(errors)
        last_exception = RuntimeError(f"All provided API keys failed for model '{current_model}'. Details: {all_errors_summary}")
        
        # Check if errors indicate a quota/availability issue
        is_quota_or_availability_issue = any(
            any(indicator in err_msg.lower() for indicator in ["429", "resource_exhausted", "quota", "403", "404", "not enabled", "not found", "limit"])
            for err_msg in errors
        )
        
        if not is_quota_or_availability_issue:
            # If not a quota/availability issue (e.g. invalid key 401, bad request 400), don't bother falling back
            logger.info("Not a quota or availability issue. Aborting fallback chain.")
            raise last_exception

    # If we finished the fallback chain without returning, raise the last exception
    raise last_exception
