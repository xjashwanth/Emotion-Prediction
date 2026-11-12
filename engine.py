"""Inference and document analysis using the original, unmodified BiGRU artifacts."""
from __future__ import annotations

import copy
import hashlib
import os
import pickle
import re
import threading
import time
from collections import OrderedDict
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")
os.environ.setdefault("TF_NUM_INTRAOP_THREADS", "4")
os.environ.setdefault("TF_NUM_INTEROP_THREADS", "2")

import numpy as np

ROOT = Path(__file__).resolve().parent
LABELS = ("sadness", "joy", "love", "anger", "fear", "surprise")
MAX_LENGTH = 50
MAX_TEXT = 60_000
MAX_WINDOWS = 2500
MODEL_NAME = "Original stacked BiGRU · six emotions"


def text_ranges(text: str, start: int = 0, end: int | None = None, *, paragraphs=False):
    """Return nonempty, exact Python character offsets into the original text."""
    end = len(text) if end is None else end
    expression = r"\r?\n[ \t]*\r?\n+" if paragraphs else r"(?<=[.!?])\s+|(?<=[.!?][\"'”’])\s+|\r?\n+"
    cursor = start
    spans = []
    for match in re.finditer(expression, text[start:end]):
        spans.append((cursor, start + match.start()))
        cursor = start + match.end()
    spans.append((cursor, end))
    result = []
    for left, right in spans:
        raw = text[left:right]
        if raw.strip():
            result.append((left + len(raw) - len(raw.lstrip()), right - len(raw) + len(raw.rstrip())))
    return result


def validate_text(text: str):
    if not text.strip():
        raise ValueError("Add a story or script before analyzing.")
    if len(text) > MAX_TEXT:
        raise ValueError(f"Use up to {MAX_TEXT:,} characters per draft. Split a longer story into chapters.")
    if not re.search(r"[A-Za-z]", text):
        raise ValueError("This model needs English words. Symbols, numbers, and other languages cannot be analyzed reliably.")
    if "\x00" in text:
        raise ValueError("The document contains binary data. Please upload a plain-text or Word document.")


def score_summary(scores, coverage=1.0):
    if scores is None:
        return {"predicted_emotion": None, "score": 0.0, "probabilities": None,
                "uncertain": True, "uncertainty_reasons": ["No recognizable words"], "coverage": 0.0}
    order = np.argsort(scores)[::-1]
    top = float(scores[order[0]])
    reasons = []
    if top < .55:
        reasons.append("Low leading score")
    if top - float(scores[order[1]]) < .15:
        reasons.append("Close leading scores")
    if coverage < .30:
        reasons.append("Limited vocabulary coverage")
    return {"predicted_emotion": LABELS[int(order[0])], "score": top,
            "probabilities": dict(zip(LABELS, map(float, scores))), "uncertain": bool(reasons),
            "uncertainty_reasons": reasons, "coverage": float(coverage)}


class EmotionEngine:
    def __init__(self):
        self.model = None
        self.tokenizer = None
        self.error = None
        self.ready = threading.Event()
        self.lock = threading.RLock()
        self.cache = OrderedDict()
        self.metadata = {"name": MODEL_NAME, "labels": list(LABELS), "window_tokens": MAX_LENGTH,
                         "neutral_trained": False, "score_note": "Model scores are not calibrated accuracy or emotional intensity."}

    def load(self):
        try:
            import keras
            import tensorflow as tf
            model_path = ROOT / "Artifacts" / "BiGRU_Model.keras"
            model = keras.models.load_model(model_path, compile=False, safe_mode=True)
            # This is the project's trusted local tokenizer, not an uploaded pickle.
            with (ROOT / "Artifacts" / "tokenizer.pkl").open("rb") as stream:
                tokenizer = pickle.load(stream)
            warm = model(np.zeros((1, MAX_LENGTH), dtype=np.int32), training=False).numpy()
            if warm.shape != (1, 6) or not np.isfinite(warm).all():
                raise RuntimeError("The saved model did not return six finite emotion scores.")
            if not np.isclose(warm.sum(), 1.0, atol=1e-4):
                raise RuntimeError("The saved classifier returned an invalid score distribution.")
            digest = hashlib.sha256(model_path.read_bytes()).hexdigest()
            self.metadata.update({"artifact_sha256": digest, "parameters": model.count_params(),
                                  "keras_version": keras.__version__, "tensorflow_version": tf.__version__,
                                  "vocabulary_limit": tokenizer.num_words})
            with self.lock:
                self.model, self.tokenizer = model, tokenizer
            self.ready.set()
            print(f"StoryPulse: original BiGRU loaded ({model.count_params():,} parameters).", flush=True)
        except Exception as exc:
            self.error = f"{type(exc).__name__}: {exc}"
            import traceback
            traceback.print_exc()

    def analyze(self, text: str):
        validate_text(text)
        if not self.ready.is_set():
            raise RuntimeError(self.error or "The BiGRU is still loading. Please try again in a moment.")
        started = time.perf_counter()
        key = hashlib.sha256(text.encode("utf-8")).hexdigest()
        with self.lock:
            if key in self.cache:
                result = copy.deepcopy(self.cache[key])
                self.cache.move_to_end(key)
                result["cached"] = True
                result["elapsed_seconds"] = round(time.perf_counter() - started, 3)
                return result

        paragraphs, sentences = [], []
        for p_index, (start, end) in enumerate(text_ranges(text, paragraphs=True)):
            paragraph_id = f"p{p_index + 1}"
            paragraph = {"id": paragraph_id, "index": p_index, "start": start, "end": end,
                         "text": text[start:end], "sentence_ids": []}
            for left, right in text_ranges(text, start, end):
                sentence_id = f"s{len(sentences) + 1}"
                sentences.append({"id": sentence_id, "index": len(sentences), "paragraph_id": paragraph_id,
                                  "start": left, "end": right, "text": text[left:right]})
                paragraph["sentence_ids"].append(sentence_id)
            paragraphs.append(paragraph)
        if len(sentences) > 2000:
            raise ValueError("This draft has over 2,000 sentences. Analyze a smaller section.")

        # Use the very same Tokenizer normalization used in training. In particular,
        # apostrophes are preserved rather than removed by a second cleaning regex.
        sequences = self.tokenizer.texts_to_sequences([s["text"] for s in sentences])
        unknown_id = self.tokenizer.word_index.get(self.tokenizer.oov_token)
        windows, owners, weights = [], [], []
        for index, (sentence, sequence) in enumerate(zip(sentences, sequences)):
            known = sum(token != unknown_id for token in sequence)
            sentence["token_count"] = len(sequence)
            sentence["coverage"] = known / max(len(sequence), 1)
            sentence["window_count"] = (len(sequence) + MAX_LENGTH - 1) // MAX_LENGTH
            for position in range(0, len(sequence), MAX_LENGTH):
                window = sequence[position:position + MAX_LENGTH]
                windows.append(window)
                owners.append(index)
                weights.append(len(window))
        if not windows:
            raise ValueError("No words could be analyzed. Add an English sentence.")
        if len(windows) > MAX_WINDOWS:
            raise ValueError("Too many text windows. Analyze a smaller section of the story.")

        matrix = np.zeros((len(windows), MAX_LENGTH), dtype=np.int32)
        for i, window in enumerate(windows):
            matrix[i, :len(window)] = window
        predictions = []
        with self.lock:
            for offset in range(0, len(matrix), 32):
                predictions.append(self.model(matrix[offset:offset + 32], training=False).numpy())
        predictions = np.concatenate(predictions, axis=0)
        if not np.isfinite(predictions).all() or not np.allclose(predictions.sum(axis=1), 1, atol=1e-4):
            raise RuntimeError("The model returned invalid scores; analysis was stopped.")

        sums = np.zeros((len(sentences), 6), dtype=np.float64)
        lengths = np.zeros(len(sentences), dtype=np.float64)
        for row, owner, weight in zip(predictions, owners, weights):
            sums[owner] += row * weight
            lengths[owner] += weight
        for i, sentence in enumerate(sentences):
            vector = sums[i] / lengths[i] if lengths[i] else None
            sentence.update(score_summary(vector, sentence["coverage"]))

        sentence_map = {s["id"]: s for s in sentences}
        for paragraph in paragraphs:
            members = [sentence_map[sid] for sid in paragraph["sentence_ids"]]
            total = sum(s["token_count"] for s in members)
            scorable = [s for s in members if s["probabilities"]]
            vector = sum((np.array(list(s["probabilities"].values())) * s["token_count"] for s in scorable), np.zeros(6)) / total if total else None
            coverage = sum(s["coverage"] * s["token_count"] for s in members) / max(total, 1)
            paragraph.update(score_summary(vector, coverage))
            paragraph["token_count"] = total
            paragraph["window_count"] = sum(s["window_count"] for s in members)

        total_tokens = int(lengths.sum())
        overall_vector = sums.sum(axis=0) / max(total_tokens, 1)
        overall_coverage = sum(s["coverage"] * s["token_count"] for s in sentences) / max(total_tokens, 1)
        overall = score_summary(overall_vector, overall_coverage)
        result = {"text": text, "text_hash": key, "paragraphs": paragraphs, "sentences": sentences,
                  "overall": overall, "word_count": len(re.findall(r"\b[\w’'-]+\b", text)),
                  "token_count": total_tokens, "window_count": len(windows),
                  "uncertain_sentences": sum(s["uncertain"] for s in sentences),
                  "elapsed_seconds": round(time.perf_counter() - started, 3), "cached": False,
                  "model": dict(self.metadata), "analyzed_at": __import__("datetime").datetime.now().astimezone().isoformat(timespec="seconds")}
        with self.lock:
            self.cache[key] = copy.deepcopy(result)
            while len(self.cache) > 12:
                self.cache.popitem(last=False)
        return result


engine = EmotionEngine()
