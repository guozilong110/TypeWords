#!/usr/bin/env python3
"""Local Kokoro TTS sidecar for TypeWords. Audio is generated in memory only."""

from __future__ import annotations

import io
import os
import threading
from functools import lru_cache
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from huggingface_hub import snapshot_download
from kokoro import KModel, KPipeline

REPO_ID = "hexgrad/Kokoro-82M"
SAMPLE_RATE = 24_000
MODEL_CACHE = Path(
    os.environ.get(
        "KOKORO_MODEL_DIR",
        Path.home() / ".cache/huggingface/hub/models--hexgrad--Kokoro-82M",
    )
).expanduser()


REQUIRED_FILES = ("config.json", "kokoro-v1_0.pth", "voices/af_heart.pt")


def snapshot_is_complete(snapshot: Path) -> bool:
    return snapshot.is_dir() and all((snapshot / filename).is_file() for filename in REQUIRED_FILES)


def resolve_snapshot() -> Path:
    ref = MODEL_CACHE / "refs/main"
    if ref.is_file():
        snapshot = MODEL_CACHE / "snapshots" / ref.read_text().strip()
        if snapshot_is_complete(snapshot):
            return snapshot

    snapshots = sorted((MODEL_CACHE / "snapshots").glob("*"), reverse=True)
    complete_snapshot = next((snapshot for snapshot in snapshots if snapshot_is_complete(snapshot)), None)
    if complete_snapshot:
        return complete_snapshot

    print(f"Kokoro model is missing or incomplete; downloading {REPO_ID}...")
    downloaded = Path(
        snapshot_download(
            repo_id=REPO_ID,
            allow_patterns=list(REQUIRED_FILES),
            cache_dir=str(MODEL_CACHE.parent),
        )
    )
    if not snapshot_is_complete(downloaded):
        raise RuntimeError(f"Downloaded Kokoro snapshot is incomplete: {downloaded}")
    return downloaded


SNAPSHOT = resolve_snapshot()
CONFIG_PATH = SNAPSHOT / REQUIRED_FILES[0]
MODEL_PATH = SNAPSHOT / REQUIRED_FILES[1]
VOICE_PATH = SNAPSHOT / REQUIRED_FILES[2]

# Load one model and share it between American and British phoneme pipelines.
model = KModel(repo_id=REPO_ID, config=str(CONFIG_PATH), model=str(MODEL_PATH)).to("cpu").eval()
pipelines = {
    "en-US": KPipeline(lang_code="a", repo_id=REPO_ID, model=model),
    "en-GB": KPipeline(lang_code="b", repo_id=REPO_ID, model=model),
}
model_lock = threading.Lock()

app = FastAPI(title="TypeWords Local Kokoro TTS")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5567", "http://localhost:5567"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@lru_cache(maxsize=512)
def synthesize(text: str, lang: str) -> bytes:
    pipeline = pipelines[lang]
    with model_lock:
        chunks = [
            result.audio.detach().cpu().numpy()
            for result in pipeline(text, voice=str(VOICE_PATH), speed=1.0)
            if result.audio is not None
        ]
    if not chunks:
        raise RuntimeError("Kokoro produced no audio")

    output = io.BytesIO()
    sf.write(output, np.concatenate(chunks), SAMPLE_RATE, format="WAV", subtype="PCM_16")
    return output.getvalue()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model": str(SNAPSHOT)}


@app.get("/tts")
def tts(
    text: str = Query(min_length=1, max_length=300),
    lang: str = Query(default="en-US", pattern="^en-(US|GB)$"),
) -> Response:
    normalized_text = " ".join(text.split())
    if not normalized_text:
        raise HTTPException(status_code=400, detail="Text cannot be blank")
    try:
        audio = synthesize(normalized_text, lang)
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Synthesis failed: {error}") from error
    return Response(audio, media_type="audio/wav", headers={"Cache-Control": "no-store"})
