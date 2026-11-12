"""StoryPulse: a local, offline-capable writing analysis webpage."""
from __future__ import annotations

import io
import json
import logging
import re
import threading
import zipfile
from contextlib import asynccontextmanager
from difflib import SequenceMatcher

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from engine import LABELS, MAX_TEXT, ROOT, engine

LOGGER = logging.getLogger("storypulse")
MAX_UPLOAD = 2 * 1024 * 1024


@asynccontextmanager
async def lifespan(app: FastAPI):
    threading.Thread(target=engine.load, name="storypulse-model-loader", daemon=True).start()
    yield


app = FastAPI(title="StoryPulse", version="1.0.0", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


@app.middleware("http")
async def local_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    if request.url.path.startswith("/api/") or request.url.path in ("/predict", "/health"):
        response.headers["Cache-Control"] = "no-store"
    return response


class DocumentInput(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT)


class CompareInput(BaseModel):
    before: str = Field(min_length=1, max_length=MAX_TEXT)
    after: str = Field(min_length=1, max_length=MAX_TEXT)


@app.get("/", include_in_schema=False)
def homepage():
    return FileResponse(ROOT / "static" / "index.html")


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return FileResponse(ROOT / "static" / "favicon.svg", media_type="image/svg+xml")


@app.get("/health")
def health():
    return {"app": "StoryPulse", "project_root": str(ROOT), "status": "ready" if engine.ready.is_set() else "error" if engine.error else "loading",
            "model_loaded": engine.ready.is_set(), "error": engine.error, "model": engine.metadata}


@app.get("/api/samples")
def samples():
    return json.loads((ROOT / "samples" / "story.json").read_text(encoding="utf-8"))


def analyzed(text):
    try:
        return engine.analyze(text)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        LOGGER.exception("Model inference failed")
        raise HTTPException(500, "Analysis failed. Check the local server window for details and try again.") from exc


@app.post("/api/analyze")
def analyze_document(document: DocumentInput):
    return analyzed(document.text)


@app.post("/predict")
def predict_legacy(document: DocumentInput):
    result = analyzed(document.text)
    return {"text": document.text, "predicted_emotion": result["overall"]["predicted_emotion"],
            "confidence": result["overall"]["score"], "all_probabilites": result["overall"]["probabilities"],
            "uncertain": result["overall"]["uncertain"]}


@app.post("/api/extract")
async def extract(file: UploadFile = File(...)):
    filename = file.filename or "document.txt"
    suffix = filename.rsplit(".", 1)[-1].lower()
    if suffix not in ("txt", "docx"):
        raise HTTPException(415, "Choose a .txt or .docx file. PDF and scanned documents are not supported.")
    data = await file.read(MAX_UPLOAD + 1)
    await file.close()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "The file is larger than 2 MB. Upload a smaller document.")
    try:
        if suffix == "txt":
            if data.startswith((b"\xff\xfe", b"\xfe\xff")):
                text = data.decode("utf-16")
            else:
                text = data.decode("utf-8-sig")
        else:
            from docx import Document
            from docx.table import Table
            from docx.text.paragraph import Paragraph
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                members = archive.infolist()
                if len(members) > 1000 or sum(m.file_size for m in members) > 15 * 1024 * 1024:
                    raise ValueError("This Word document expands beyond the 15 MB limit.")
                if "word/document.xml" not in archive.namelist():
                    raise ValueError("This file is not a valid Word document.")
            doc = Document(io.BytesIO(data))
            parts = []
            for element in doc.element.body:
                if element.tag.endswith("}p"):
                    parts.append(Paragraph(element, doc).text)
                elif element.tag.endswith("}tbl"):
                    parts.extend(" | ".join(cell.text for cell in row.cells) for row in Table(element, doc).rows)
            text = "\n\n".join(part for part in parts if part.strip())
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        from engine import validate_text
        validate_text(text)
    except UnicodeError as exc:
        raise HTTPException(422, "Save the text file as UTF-8 or UTF-16, then upload it again.") from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(422, "The file could not be read. Check that it is a valid .txt or .docx document.") from exc
    return {"text": text, "title": filename.rsplit(".", 1)[0], "filename": filename, "characters": len(text)}


def word_segments(left, right):
    a = re.findall(r"\s+|\S+", left)
    b = re.findall(r"\s+|\S+", right)
    parts_a, parts_b = [], []
    for tag, i, j, k, l in SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if i < j:
            parts_a.append({"text": "".join(a[i:j]), "changed": tag != "equal"})
        if k < l:
            parts_b.append({"text": "".join(b[k:l]), "changed": tag != "equal"})
    return parts_a, parts_b


def document_diff(before, after):
    left, right = before["paragraphs"], after["paragraphs"]
    a = [" ".join(p["text"].split()) for p in left]
    b = [" ".join(p["text"].split()) for p in right]
    blocks = []
    for tag, i, j, k, l in SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        count = max(j - i, l - k)
        for step in range(count):
            old = left[i + step] if i + step < j else None
            new = right[k + step] if k + step < l else None
            kind = "unchanged" if tag == "equal" else "removed" if new is None else "added" if old is None else "modified"
            sa, sb = word_segments(old["text"] if old else "", new["text"] if new else "")
            blocks.append({"kind": kind,
                           "before": {"id": old["id"], "segments": sa} if old else None,
                           "after": {"id": new["id"], "segments": sb} if new else None})
    return blocks


@app.post("/api/compare")
def compare_drafts(documents: CompareInput):
    before, after = analyzed(documents.before), analyzed(documents.after)
    blocks = document_diff(before, after)
    return {"before": before, "after": after, "blocks": blocks,
            "counts": {kind: sum(b["kind"] == kind for b in blocks) for kind in ("unchanged", "modified", "added", "removed")},
            "score_changes": {label: after["overall"]["probabilities"][label] - before["overall"]["probabilities"][label] for label in LABELS}}
