from __future__ import annotations
import base64
import io
import logging
from pathlib import Path
from typing import List

from ..models import Chunk
from ..config import VISION_MODEL, call_vision_with_key_rotation

logger = logging.getLogger(__name__)

MAX_IMAGE_PX = 1568  # longest side limit before sending to Groq

_VISION_PROMPT = """You are analyzing an enterprise document or architecture diagram.

List every software system, tool, or platform visible in this image.
For each system:
- its name (use the full official product name, expand abbreviations)
- what it connects to (follow arrows or lines if present)
- any label on the connection

If this is not a technical diagram (e.g., a photo or logo), describe any
software system names you can read as text.

Only describe what is visually present. Do not invent anything."""


def parse_image(path: str) -> List[Chunk]:
    """Send image to Groq vision model and return a description chunk."""
    try:
        image_b64 = _load_and_encode(path)
        description = _describe(image_b64)
        if not description.strip():
            logger.warning(f"Vision model returned empty description for {path}")
            return []
        return [Chunk(
            chunk_id=f"{Path(path).stem}_vision",
            source_document=Path(path).name,
            text=description,
            chunk_type="vision_description",
        )]
    except Exception as exc:
        logger.error(f"Failed to process image {path}: {exc}")
        return []


def _load_and_encode(path: str) -> str:
    """Load image, resize to fit MAX_IMAGE_PX on longest side, return base64."""
    from PIL import Image

    img = Image.open(path)
    w, h = img.size
    if max(w, h) > MAX_IMAGE_PX:
        ratio = MAX_IMAGE_PX / max(w, h)
        img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)

    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def _describe(image_b64: str) -> str:
    def _call(client, b64: str) -> str:
        response = client.chat.completions.create(
            model=VISION_MODEL,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": _VISION_PROMPT},
                    {"type": "image_url", "image_url": {
                        "url": f"data:image/jpeg;base64,{b64}"
                    }},
                ],
            }],
            max_tokens=1024,
        )
        return response.choices[0].message.content or ""

    return call_vision_with_key_rotation(_call, image_b64)
