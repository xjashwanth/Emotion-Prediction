"""Integration checks using the real saved model, not mocked predictions."""
import io
import json
import math
import unittest
import zipfile

import numpy as np
from docx import Document
from fastapi.testclient import TestClient

from engine import LABELS, ROOT, engine, text_ranges
from main import app, word_segments


class StoryPulseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.context = TestClient(app)
        cls.client = cls.context.__enter__()
        if not engine.ready.wait(55):
            raise RuntimeError(engine.error or "The real BiGRU did not become ready within 55 seconds.")
        cls.samples = json.loads((ROOT / "samples" / "story.json").read_text(encoding="utf-8"))

    @classmethod
    def tearDownClass(cls):
        cls.context.__exit__(None, None, None)

    def analyze(self, text):
        response = self.client.post("/api/analyze", json={"text": text})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_01_saved_model_is_loaded_and_unchanged(self):
        health = self.client.get("/health").json()
        self.assertTrue(health["model_loaded"])
        self.assertEqual(health["model"]["parameters"], 3454662)
        self.assertEqual(health["model"]["labels"], list(LABELS))
        self.assertFalse(health["model"]["neutral_trained"])
        self.assertEqual(len(health["model"]["artifact_sha256"]), 64)

    def test_02_results_match_direct_saved_model_and_training_tokenizer(self):
        text = "I can't feel happy about it."
        sequence = engine.tokenizer.texts_to_sequences([text])[0]
        matrix = np.zeros((1, 50), dtype=np.int32)
        matrix[0, :len(sequence)] = sequence
        direct = engine.model(matrix, training=False).numpy()[0]
        result = self.analyze(text)
        actual = np.array([result["sentences"][0]["probabilities"][label] for label in LABELS])
        np.testing.assert_allclose(actual, direct, atol=1e-6)
        self.assertEqual(result["token_count"], len(sequence))
        self.assertAlmostEqual(sum(actual), 1, places=5)

    def test_03_full_long_sentence_uses_every_window(self):
        text = ("I feel lonely and sad " * 24) + ("I feel happy and joyful " * 9)
        tokens = engine.tokenizer.texts_to_sequences([text])[0]
        windows = [tokens[i:i + 50] for i in range(0, len(tokens), 50)]
        matrix = np.zeros((len(windows), 50), dtype=np.int32)
        for i, window in enumerate(windows):
            matrix[i, :len(window)] = window
        direct = engine.model(matrix, training=False).numpy()
        expected = np.average(direct, axis=0, weights=[len(w) for w in windows])
        result = self.analyze(text)
        self.assertEqual(result["window_count"], math.ceil(len(tokens) / 50))
        self.assertEqual(result["token_count"], len(tokens))
        np.testing.assert_allclose(list(result["overall"]["probabilities"].values()), expected, atol=1e-6)
        self.assertGreater(result["window_count"], 1)

    def test_04_original_text_and_unicode_offsets_are_preserved(self):
        text = '  “I feel happy.” 😊 I love my family!\n\n  I feel afraid.\nI am scared.  '
        result = self.analyze(text)
        self.assertEqual(result["text"], text)
        self.assertEqual(len(result["paragraphs"]), 2)
        for level in ("paragraphs", "sentences"):
            for passage in result[level]:
                self.assertEqual(text[passage["start"]:passage["end"]], passage["text"])
        self.assertEqual(sum(p["token_count"] for p in result["paragraphs"]), result["token_count"])

    def test_05_real_sample_comparison_has_added_and_modified_passages(self):
        response = self.client.post("/api/compare", json={"before": self.samples["before"], "after": self.samples["after"]})
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data["counts"], {"unchanged": 5, "modified": 1, "added": 1, "removed": 0})
        self.assertEqual(len(data["before"]["paragraphs"]), 6)
        self.assertEqual(len(data["after"]["paragraphs"]), 7)
        self.assertTrue(any(abs(v) > .01 for v in data["score_changes"].values()))

    def test_06_comparison_handles_removed_and_identical_passages(self):
        one = "I feel sad and lonely."
        two = one + "\n\nI feel very happy."
        response = self.client.post("/api/compare", json={"before": two, "after": one})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["counts"]["removed"], 1)
        data = self.client.post("/api/compare", json={"before": one, "after": one}).json()
        self.assertEqual(data["counts"]["unchanged"], 1)
        self.assertTrue(all(value == 0 for value in data["score_changes"].values()))

    def test_07_text_and_word_uploads_preserve_reading_order(self):
        text = "I love my family.\n\nI feel happy."
        for encoded in (text.encode("utf-8-sig"), text.encode("utf-16")):
            response = self.client.post("/api/extract", files={"file": ("story.txt", encoded, "text/plain")})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["text"], text)
        doc = Document()
        doc.add_paragraph("I feel happy.")
        table = doc.add_table(rows=1, cols=1)
        table.cell(0, 0).text = "I love my sister."
        doc.add_paragraph("I am surprised.")
        buffer = io.BytesIO()
        doc.save(buffer)
        response = self.client.post("/api/extract", files={"file": ("story.docx", buffer.getvalue())})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["text"], "I feel happy.\n\nI love my sister.\n\nI am surprised.")

    def test_08_bad_and_oversized_files_fail_with_messages(self):
        cases = [("bad.pdf", b"%PDF", 415), ("bad.docx", b"not a zip", 422),
                 ("big.txt", b"a" * (2 * 1024 * 1024 + 1), 413), ("binary.txt", b"hello\x00", 422),
                 ("empty.txt", b"   ", 422)]
        for filename, content, status in cases:
            with self.subTest(filename=filename):
                response = self.client.post("/api/extract", files={"file": (filename, content)})
                self.assertEqual(response.status_code, status, response.text)
                self.assertIsInstance(response.json()["detail"], str)
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as z:
            z.writestr("word/document.xml", b"x" * (16 * 1024 * 1024))
        self.assertEqual(self.client.post("/api/extract", files={"file": ("expanded.docx", archive.getvalue())}).status_code, 422)

    def test_09_invalid_text_is_rejected_and_oov_is_uncertain(self):
        for text in (" ", "1234 !!!", "नमस्ते दुनिया", "x" * 60001):
            with self.subTest(length=len(text)):
                response = self.client.post("/api/analyze", json={"text": text})
                self.assertEqual(response.status_code, 422)
        result = self.analyze("zzqvvxx ppqzzvv xqzvvoo")
        self.assertTrue(result["overall"]["uncertain"])
        self.assertIn("Limited vocabulary coverage", result["overall"]["uncertainty_reasons"])
        self.assertNotEqual(result["overall"]["predicted_emotion"], "neutral")

    def test_10_cached_analysis_and_legacy_api_use_real_results(self):
        text = "I feel happy and excited today."
        self.analyze(text)
        again = self.analyze(text)
        self.assertTrue(again["cached"])
        legacy = self.client.post("/predict", json={"text": text}).json()
        self.assertEqual(legacy["all_probabilites"], again["overall"]["probabilities"])
        self.assertEqual(legacy["predicted_emotion"], again["overall"]["predicted_emotion"])

    def test_11_interface_and_assets_are_available_without_remote_dependencies(self):
        home = self.client.get("/")
        self.assertEqual(home.status_code, 200)
        self.assertNotIn("fonts.googleapis.com", home.text)
        self.assertNotIn("cdn.", home.text)
        for asset in ("style.css", "script.js", "favicon.svg"):
            self.assertEqual(self.client.get("/static/" + asset).status_code, 200)

    def test_12_diff_segments_preserve_both_texts(self):
        left, right = "I was afraid. I feel sad.", "I was surprised. I feel happy!"
        a, b = word_segments(left, right)
        self.assertEqual("".join(segment["text"] for segment in a), left)
        self.assertEqual("".join(segment["text"] for segment in b), right)
        self.assertTrue(any(segment["changed"] for segment in a))
        self.assertEqual(text_ranges(" A \n\n B ", paragraphs=True), [(1, 2), (6, 7)])


if __name__ == "__main__":
    unittest.main(verbosity=2)
