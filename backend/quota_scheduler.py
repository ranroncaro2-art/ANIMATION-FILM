import asyncio
import logging
import random
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from typing import Deque, Dict, List, Optional, Set, Tuple
from zoneinfo import ZoneInfo

from database import (
    get_all_profiles,
    get_daily_requests,
    update_daily_requests,
    save_profiles,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("QuotaScheduler")

DEFAULT_MODELS = ("gemini-2.5-flash", "gemini-3.5-flash")
TIMEZONE_LA = ZoneInfo("America/Los_Angeles")


@dataclass
class ApiKeyProfileInternal:
    id: str
    label: str
    key: str
    group_id: str
    enabled_models: Tuple[str, ...] = DEFAULT_MODELS
    enabled: bool = True
    rpm: int = 5
    tpm: int = 250000
    rpd: int = 1500
    max_in_flight: int = 1


@dataclass
class QuotaGroupModelPool:
    group_id: str
    model: str
    rpm_limit: int = 5
    tpm_limit: int = 250000
    rpd_limit: int = 1500
    max_in_flight: int = 1
    request_starts: Deque[float] = field(default_factory=deque)
    token_events: Deque[Tuple[float, int]] = field(default_factory=deque)
    requests_today: int = 0
    day_key: str = ""
    cooldown_until: float = 0.0
    in_flight: int = 0
    round_robin_index: int = 0
    invalid_key_ids: Set[str] = field(default_factory=set)
    last_error: Optional[str] = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class GeminiQuotaScheduler:
    """Quota-aware job scheduler supporting multi-group, multi-model parallel execution.

    Enforces RPM/TPM sliding windows and daily RPD limits based on America/Los_Angeles timezone.
    Groups keys by quota_group_id so multiple keys in the same group serve only as failovers.
    """

    def __init__(self) -> None:
        self._pools: Dict[Tuple[str, str], QuotaGroupModelPool] = {}
        self._pools_lock = asyncio.Lock()
        self._model_rr_counter = 0

    @staticmethod
    def current_la_day_key() -> str:
        return datetime.now(TIMEZONE_LA).date().isoformat()

    def load_profiles_from_db_or_list(self, profile_ids: Optional[List[str]] = None) -> List[ApiKeyProfileInternal]:
        raw_list = get_all_profiles()
        profiles: List[ApiKeyProfileInternal] = []

        for p in raw_list:
            if not p.get("enabled", True):
                continue
            if profile_ids and p["id"] not in profile_ids:
                continue

            key_val = (p.get("apiKey") or p.get("api_key") or "").strip()
            if not key_val:
                continue

            models = tuple(p.get("enabledModels") or ["gemini-2.5-flash", "gemini-3.5-flash"])
            rpd_val = int(p.get("rpd", 1500))
            if rpd_val <= 20:
                rpd_val = 1500
            profiles.append(ApiKeyProfileInternal(
                id=p["id"],
                label=p.get("label", p["id"]),
                key=key_val,
                group_id=p.get("quotaGroupId") or "default",
                enabled_models=models,
                enabled=bool(p.get("enabled", True)),
                rpm=int(p.get("rpm", 5)),
                tpm=int(p.get("tpm", 250000)),
                rpd=rpd_val,
                max_in_flight=int(p.get("maxInFlight", 1)),
            ))
        return profiles

    async def _get_pool(self, group_id: str, model: str, rpm: int, tpm: int, rpd: int, max_in_flight: int) -> QuotaGroupModelPool:
        pool_key = (group_id, model)
        async with self._pools_lock:
            if pool_key not in self._pools:
                pool = QuotaGroupModelPool(
                    group_id=group_id,
                    model=model,
                    rpm_limit=rpm,
                    tpm_limit=tpm,
                    rpd_limit=rpd,
                    max_in_flight=max_in_flight,
                )
                today = self.current_la_day_key()
                pool.day_key = today
                pool.requests_today = get_daily_requests(group_id, model, today)
                self._pools[pool_key] = pool
            else:
                # Update limits dynamically if changed
                pool = self._pools[pool_key]
                pool.rpm_limit = rpm
                pool.tpm_limit = tpm
                pool.rpd_limit = rpd
                pool.max_in_flight = max_in_flight
            return pool

    @staticmethod
    def _trim_window(pool: QuotaGroupModelPool, now: float) -> None:
        while pool.request_starts and now - pool.request_starts[0] >= 60.0:
            pool.request_starts.popleft()
        while pool.token_events and now - pool.token_events[0][0] >= 60.0:
            pool.token_events.popleft()

    async def acquire_worker(
        self,
        profiles: List[ApiKeyProfileInternal],
        preferred_models: List[str],
        estimated_input_tokens: int = 0,
    ) -> Tuple[ApiKeyProfileInternal, str, QuotaGroupModelPool]:
        """Finds and reserves an available worker pool & API key. Sleeps if necessary to stay under rate limits."""
        if not profiles:
            raise ValueError("No active API key profiles provided or available.")

        # Find usable (profile, model) candidates
        candidates: List[Tuple[ApiKeyProfileInternal, str]] = []
        for profile in profiles:
            for model in preferred_models:
                if model in profile.enabled_models:
                    candidates.append((profile, model))

        if not candidates:
            raise ValueError(f"No API key profile supports the requested models: {preferred_models}")

        start_time = time.monotonic()
        max_wait_seconds = 600.0  # 10 minutes timeout for queueing

        while True:
            now = time.monotonic()
            if now - start_time > max_wait_seconds:
                raise RuntimeError("Timed out waiting for an available Gemini quota pool slot.")

            today = self.current_la_day_key()
            ranked_pools: List[Tuple[float, ApiKeyProfileInternal, str, QuotaGroupModelPool]] = []

            # Calculate aggregate RPD limit for group
            group_rpd_totals: Dict[str, int] = {}
            for pr in profiles:
                group_rpd_totals[pr.group_id] = group_rpd_totals.get(pr.group_id, 0) + pr.rpd

            for profile, model in candidates:
                eff_rpd = max(profile.rpd, group_rpd_totals.get(profile.group_id, 1500))
                pool = await self._get_pool(
                    profile.group_id, model, profile.rpm, profile.tpm, eff_rpd, profile.max_in_flight
                )
                async with pool.lock:
                    if pool.day_key != today:
                        pool.day_key = today
                        pool.requests_today = get_daily_requests(profile.group_id, model, today)

                    self._trim_window(pool, now)

                    # Skip if daily quota is exhausted
                    if pool.requests_today >= pool.rpd_limit:
                        continue

                    # Skip if in-flight count reached max
                    if pool.in_flight >= pool.max_in_flight:
                        continue

                    # Skip if profile key is invalidated
                    if profile.id in pool.invalid_key_ids:
                        continue

                    # Calculate wait time for RPM limit
                    rpm_wait = 0.0
                    if pool.request_starts and len(pool.request_starts) >= pool.rpm_limit:
                        earliest = pool.request_starts[0]
                        rpm_wait = max(0.0, 60.0 - (now - earliest))
                    elif pool.request_starts:
                        # Spacing out requests slightly
                        rpm_wait = max(0.0, (60.0 / max(1, pool.rpm_limit)) - (now - pool.request_starts[-1]))

                    # Calculate wait time for TPM limit
                    token_wait = 0.0
                    recent_tokens = sum(tok for _, tok in pool.token_events)
                    if estimated_input_tokens and (recent_tokens + estimated_input_tokens > pool.tpm_limit) and pool.token_events:
                        token_wait = max(0.0, 60.0 - (now - pool.token_events[0][0]))

                    cooldown_wait = max(0.0, pool.cooldown_until - now)
                    ready_at = now + max(rpm_wait, token_wait, cooldown_wait)

                    ranked_pools.append((ready_at, profile, model, pool))

            if not ranked_pools:
                # Check if all pools are RPD exhausted
                all_exhausted = True
                for profile, model in candidates:
                    p = await self._get_pool(profile.group_id, model, profile.rpm, profile.tpm, profile.rpd, profile.max_in_flight)
                    if p.requests_today < p.rpd_limit:
                        all_exhausted = False
                        break
                if all_exhausted:
                    raise RuntimeError("All configured Gemini quota groups have reached their daily request limit (RPD).")

                # Pools are busy, sleep briefly and retry
                await asyncio.sleep(1.0)
                continue

            # Sort pools by earliest ready_at
            ranked_pools.sort(key=lambda x: x[0])
            first_ready_time = ranked_pools[0][0]

            # Collect pools ready around the same time (+/- 10ms)
            equal_pools = [item for item in ranked_pools if abs(item[0] - first_ready_time) < 0.01]

            # Alternate models (2.5-flash vs 3.5-flash) using round robin counter
            choice = equal_pools[self._model_rr_counter % len(equal_pools)]
            self._model_rr_counter += 1

            ready_at, selected_profile, selected_model, selected_pool = choice
            delay = ready_at - now

            if delay > 0.05:
                await asyncio.sleep(min(delay, 2.0))
                continue

            # Re-lock pool and verify slot is still valid
            async with selected_pool.lock:
                cur_now = time.monotonic()
                self._trim_window(selected_pool, cur_now)

                if selected_pool.in_flight >= selected_pool.max_in_flight or selected_pool.requests_today >= selected_pool.rpd_limit:
                    continue

                # Lock acquired!
                selected_pool.request_starts.append(cur_now)
                if estimated_input_tokens:
                    selected_pool.token_events.append((cur_now, estimated_input_tokens))

                selected_pool.requests_today += 1
                selected_pool.in_flight += 1
                update_daily_requests(selected_pool.group_id, selected_model, selected_pool.day_key, selected_pool.requests_today)

                logger.info(
                    "Quota worker slot acquired: group=%s model=%s key_id=%s in_flight=%d rpd=%d/%d",
                    selected_pool.group_id,
                    selected_model,
                    selected_profile.id,
                    selected_pool.in_flight,
                    selected_pool.requests_today,
                    selected_pool.rpd_limit,
                )
                return selected_profile, selected_model, selected_pool

    async def release_worker(
        self,
        pool: QuotaGroupModelPool,
        *,
        cooldown_seconds: float = 0.0,
        invalid_key_id: Optional[str] = None,
        error_message: Optional[str] = None,
    ) -> None:
        async with pool.lock:
            pool.in_flight = max(0, pool.in_flight - 1)
            if cooldown_seconds > 0:
                pool.cooldown_until = max(pool.cooldown_until, time.monotonic() + cooldown_seconds)
                logger.warning("Pool cooldown set for group=%s model=%s: %.1fs", pool.group_id, pool.model, cooldown_seconds)
            if invalid_key_id:
                pool.invalid_key_ids.add(invalid_key_id)
                logger.error("Disabled key_id=%s in pool group=%s model=%s due to auth error", invalid_key_id, pool.group_id, pool.model)
            if error_message:
                pool.last_error = error_message

    def estimate_eta_seconds(self, remaining_tasks: int, estimated_tokens_per_task: int = 25000) -> float:
        """Estimates completion time in seconds based on combined throughput of active pools."""
        if remaining_tasks <= 0:
            return 0.0

        total_effective_rpm = 0.0
        now = time.monotonic()

        for (group_id, model), pool in self._pools.items():
            if pool.requests_today >= pool.rpd_limit:
                continue
            if pool.cooldown_until > now + 30.0:
                continue
            total_effective_rpm += max(1.0, float(pool.rpm_limit))

        if total_effective_rpm <= 0:
            total_effective_rpm = 5.0  # Fallback default assumption

        # Tasks per minute = total_effective_rpm
        minutes_needed = remaining_tasks / total_effective_rpm
        return round(minutes_needed * 60.0, 1)

    async def get_quota_status(self) -> List[dict]:
        now = time.monotonic()
        result = []
        today = self.current_la_day_key()

        async with self._pools_lock:
            for (group_id, model), pool in self._pools.items():
                async with pool.lock:
                    if pool.day_key != today:
                        pool.day_key = today
                        pool.requests_today = get_daily_requests(group_id, model, today)

                    self._trim_window(pool, now)
                    cooldown_rem = max(0.0, round(pool.cooldown_until - now, 1))

                    result.append({
                        "groupId": group_id,
                        "model": model,
                        "requestsLastMinute": len(pool.request_starts),
                        "inputTokensLastMinute": sum(tok for _, tok in pool.token_events),
                        "requestsToday": pool.requests_today,
                        "rpdLimit": pool.rpd_limit,
                        "rpmLimit": pool.rpm_limit,
                        "tpmLimit": pool.tpm_limit,
                        "cooldownSeconds": cooldown_rem,
                        "inFlight": pool.in_flight,
                        "maxInFlight": pool.max_in_flight,
                        "invalidKeys": list(pool.invalid_key_ids),
                        "lastError": pool.last_error,
                    })
        return result


global_scheduler = GeminiQuotaScheduler()
