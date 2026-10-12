"""Versioned LV01 framing and strict control schemas."""
import json
import struct
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)


class Header(Strict):
    schema_version: Literal['1.0']
    session_binding_id: str = Field(min_length=1, max_length=100)
    source_id: str = Field(min_length=1, max_length=100)
    epoch: int = Field(ge=1)
    seq: int = Field(ge=0)
    privacy_generation: int = Field(ge=1)
    captured_at_utc: str
    capture_monotonic_ms: float = Field(ge=0)
    width: int = Field(ge=1, le=1920)
    height: int = Field(ge=1, le=1080)
    mime_type: Literal['image/jpeg']
    jpeg_bytes: int = Field(ge=1, le=1048576)


class Policy(Strict):
    face: bool = False
    camera_condition: str = Field(min_length=64, max_length=64, pattern='^[a-f0-9]+$')


class Binding(Strict):
    owner: str = Field(min_length=1, max_length=200)


class Enrollment(Strict):
    consent: Literal[True]
    name: str = Field(min_length=1, max_length=64)


class Primary(Strict):
    track_id: str | None = None


class Find(Strict):
    labels: list[str] = Field(min_length=1, max_length=8)


class Conversation(Strict):
    text: str = Field(min_length=1, max_length=2000)
    track_id: str = Field(min_length=1, max_length=100)
    character: str = Field(min_length=1, max_length=100)
    event_id: str = Field(min_length=1, max_length=100)


class SocialEvent(Strict):
    track_id: str = Field(min_length=1, max_length=100)
    character: str = Field(min_length=1, max_length=100)
    ask_name: bool = False


def decode_frame(data, source):
    if len(data) < 10 or len(data) > 1048576 + 4104 or data[:4] != b'LV01':
        raise ValueError('Invalid LV01 frame')
    length = struct.unpack('>I', data[4:8])[0]
    if length > 4096 or length < 2 or length + 8 >= len(data):
        raise ValueError('Invalid metadata length')
    header = Header.model_validate(json.loads(data[8:8 + length]))
    datetime.fromisoformat(header.captured_at_utc.replace('Z', '+00:00'))
    if any(getattr(header, key) != source[key] for key in ('session_binding_id', 'source_id', 'epoch', 'privacy_generation')):
        raise ValueError('Frame ownership mismatch')
    if header.seq <= source['seq'] or header.width * header.height > 2073600:
        raise ValueError('Stale or oversized frame')
    jpeg = data[8 + length:]
    if len(jpeg) != header.jpeg_bytes or not jpeg.startswith(b'\xff\xd8'):
        raise ValueError('Invalid JPEG length or type')
    return header, jpeg
