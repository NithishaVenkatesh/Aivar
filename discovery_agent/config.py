from __future__ import annotations
import os
import time
import uuid
import logging
from typing import List

from dotenv import load_dotenv

try:
    from langsmith import traceable as _traceable
except ImportError:
    def _traceable(fn=None, **kwargs):  # type: ignore[misc]
        """No-op shim when langsmith is not installed."""
        if fn is not None:
            return fn
        return lambda f: f

load_dotenv()

# PromptLayer decorator — initialized after load_dotenv so the API key is present.
def _pl_traceable(name=None, attributes=None):
    """No-op shim; replaced below if PromptLayer is configured."""
    return lambda f: f

_pl_api_key = os.getenv("PROMPTLAYER_API_KEY", "")
if _pl_api_key:
    try:
        from promptlayer import PromptLayer as _PromptLayer
        _pl_traceable = _PromptLayer(api_key=_pl_api_key).traceable  # type: ignore[assignment]
    except Exception:
        pass

logger = logging.getLogger(__name__)

TEXT_MODEL: str = os.getenv("TEXT_MODEL", "llama-3.3-70b-versatile")
VISION_MODEL: str = os.getenv("VISION_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct")

# Shared fuzzy-matching threshold for system name deduplication (Level 1)
# and inventory cross-check (Level 2). Both use token_sort_ratio; raise or
# lower this together so the behaviour stays consistent across the pipeline.
FUZZY_SIMILARITY_THRESHOLD: int = 88

# How long to wait (seconds) before retrying after all API keys are exhausted.
_RATE_LIMIT_RECOVERY_SECS: int = 60

# How many times to cycle through all keys before giving up (n * this).
_KEY_ROTATION_PASSES: int = 2

def _load_keys() -> List[str]:
    keys: List[str] = []
    # Single key
    if k := os.getenv("GROQ_API_KEY"):
        keys.append(k)
    # Comma-separated pool
    for k in os.getenv("GROQ_API_KEYS", "").split(","):
        k = k.strip()
        if k and k not in keys:
            keys.append(k)
    # Numbered keys GROQ_API_KEY_1 … GROQ_API_KEY_4
    for i in range(1, 5):
        if k := os.getenv(f"GROQ_API_KEY_{i}"):
            if k not in keys:
                keys.append(k)
    return keys


GROQ_API_KEYS: List[str] = _load_keys()

if not GROQ_API_KEYS:
    raise ValueError(
        "No Groq API keys found. "
        "Set GROQ_API_KEY or GROQ_API_KEYS (comma-separated) in your .env file."
    )


def generate_run_id() -> str:
    """8-character hex ID for correlating logs across a single pipeline run."""
    return uuid.uuid4().hex[:8]


def init_sentry() -> None:
    """Initialize Sentry error tracking if SENTRY_DSN is set. Silent no-op otherwise."""
    dsn = os.getenv("SENTRY_DSN", "").strip()
    if not dsn:
        return
    try:
        import sentry_sdk
        sentry_sdk.init(
            dsn=dsn,
            traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.05")),
            environment=os.getenv("APP_ENV", "development"),
        )
        logger.info("Sentry initialized.")
    except ImportError:
        logger.debug("sentry-sdk not installed — Sentry disabled.")
    except Exception as exc:
        logger.warning(f"Sentry init failed (non-fatal): {exc}")


def get_instructor_client(key: str):
    """Return an instructor-wrapped Groq client for the given key."""
    import instructor
    from groq import Groq
    # max_retries=0: disable the SDK's built-in exponential backoff so 429s
    # surface immediately to call_with_key_rotation instead of waiting 32s.
    return instructor.from_groq(Groq(api_key=key, max_retries=0), mode=instructor.Mode.JSON)


def get_raw_groq_client(key: str):
    """Return a plain Groq client (for vision calls that don't use instructor)."""
    from groq import Groq
    return Groq(api_key=key, max_retries=0)


def _is_rate_limit(exc: BaseException) -> bool:
    """
    Return True if exc is (or wraps) a Groq RateLimitError.

    instructor catches the raw RateLimitError inside its retry loop and re-raises
    an InstructorRetryException, so we must walk the cause chain and also check
    the string representation as a last resort.
    """
    from groq import RateLimitError

    candidate: BaseException | None = exc
    while candidate is not None:
        if isinstance(candidate, RateLimitError):
            return True
        candidate = getattr(candidate, "__cause__", None) or getattr(candidate, "__context__", None)

    # Fallback: instructor formats 429 errors into the exception message
    msg = str(exc)
    return "429" in msg or "rate_limit_exceeded" in msg


@_pl_traceable(name="llm_call_key_rotation")
@_traceable(name="llm_call_key_rotation")
def call_with_key_rotation(fn, *args, **kwargs):
    """
    Call fn(client, *args, **kwargs) rotating through all Groq keys on rate limits.
    fn receives an instructor-wrapped client as its first argument.

    instructor wraps RateLimitError inside InstructorRetryException — we detect
    both the raw and wrapped form so every key is tried before giving up.
    Waits 60 s and does one final attempt if all keys are exhausted.
    """
    n = len(GROQ_API_KEYS)
    for attempt in range(n * 2):
        key_idx = attempt % n
        key = GROQ_API_KEYS[key_idx]
        try:
            client = get_instructor_client(key)
            result = fn(client, *args, **kwargs)
            if attempt > 0:
                logger.info(f"Key {key_idx + 1}/{n} succeeded after rotation.")
            return result
        except Exception as exc:
            if _is_rate_limit(exc):
                next_idx = (key_idx + 1) % n
                logger.warning(
                    f"Key {key_idx + 1}/{n} rate limited — rotating to key {next_idx + 1}/{n}."
                )
                continue
            raise

    logger.warning("All Groq keys rate limited. Waiting 60 s for reset...")
    time.sleep(60)
    client = get_instructor_client(GROQ_API_KEYS[0])
    return fn(client, *args, **kwargs)


@_pl_traceable(name="vision_call_key_rotation")
@_traceable(name="vision_call_key_rotation")
def call_vision_with_key_rotation(fn, *args, **kwargs):
    """
    Same as call_with_key_rotation but passes a plain Groq client (for vision calls).
    """
    n = len(GROQ_API_KEYS)
    for attempt in range(n * 2):
        key_idx = attempt % n
        key = GROQ_API_KEYS[key_idx]
        try:
            client = get_raw_groq_client(key)
            result = fn(client, *args, **kwargs)
            if attempt > 0:
                logger.info(f"Vision key {key_idx + 1}/{n} succeeded after rotation.")
            return result
        except Exception as exc:
            if _is_rate_limit(exc):
                next_idx = (key_idx + 1) % n
                logger.warning(
                    f"Vision key {key_idx + 1}/{n} rate limited — rotating to key {next_idx + 1}/{n}."
                )
                continue
            raise

    logger.warning("All Groq vision keys rate limited. Waiting 60 s for reset...")
    time.sleep(60)
    client = get_raw_groq_client(GROQ_API_KEYS[0])
    return fn(client, *args, **kwargs)
