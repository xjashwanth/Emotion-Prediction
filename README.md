# StoryPulse — a laptop webpage for story revision

StoryPulse extends your original text-emotion project into a working writing workspace. It analyzes full stories, plots an emotional timeline, compares two drafts, records your interpretation, and exports results. Predictions come from your original saved BiGRU and tokenizer. The model is not retrained or replaced.

## Open it on this laptop

1. Double-click **Start StoryPulse.cmd**.
2. Chrome or Edge opens the local page, normally **http://127.0.0.1:8000**. If another application uses that port, the launcher selects the next available port up to 8010.
3. Wait for **BiGRU model ready** at the bottom left.
4. Keep the launcher window open. Press **Ctrl+C** in that window to stop the server.

This laptop's isolated environment has already been prepared. On another laptop, or if the environment needs repair, run **Setup StoryPulse.cmd** first. Setup requires an installed Python launcher, internet for package downloads, and several hundred MB of disk space. It creates an isolated Python 3.11 environment and checks the actual model. Ordinary use after setup needs no internet. The source ZIP excludes the environment; run setup after extracting that ZIP.

## Use the workspace

- Write or paste in **Draft A**, or use the upload icon for `.txt` and `.docx` files. Uploads accept UTF-8/UTF-16 text; PDF is not supported. Each draft supports 60,000 characters and each upload supports 2 MB.
- Select **Analyze story**, or press **Ctrl+Enter**. The **Passages** view shows predictions beside the writing. **Write** returns to the editable text.
- The overview shows average model scores. The timeline can show paragraphs or sentences. Click a point to inspect that passage. The legend buttons show or hide individual emotion curves.
- Add **Your interpretation** and a note under **A closer reading**. These annotations are stored separately; the original predictions and chart remain intact. Editing a draft clears its old annotations because passage positions may have changed.
- Put a revision in **Draft B**, open **Compare drafts**, then run the comparison. Inspect both emotion profiles and timelines, added/removed paragraphs, and word-level changes. Selecting a comparison-chart point opens the corresponding passage in the editor.
- **Export** downloads a CSV or opens a printable report. Use the browser's **Save as PDF** destination if you want a PDF. **Save project** downloads a JSON project containing both texts and annotations. **Open project** restores it and recomputes any saved analyses using the actual model.
- The current workspace also autosaves in this browser's local storage. Use a JSON download for an explicit backup. Browser storage is tied to the browser and local address; it is not a cloud account.

## How it works

`Browser → local FastAPI API → saved tokenizer → 50-token windows → original stacked BiGRU → six scores → passage aggregation → visualization / comparison / exports`

The inference engine uses the trained tokenizer directly, matching the notebook rather than running an additional punctuation-stripping regex. It preserves the tokenizer's treatment of apostrophes and its vocabulary/OOV rules. Every sentence is divided into consecutive windows of at most 50 tokens, post-padded with zeroes. All windows are inferred in batches. Sentence, paragraph, and document scores are averaged by token count. No text is silently truncated to the first 50 tokens.

Text comparisons use Python's `difflib.SequenceMatcher`: paragraph-level alignment followed by word-level changes inside modified blocks. The resulting emotion-score differences do not grade a draft's writing quality. Manual annotations are not included in model-score changes.

The webpage uses plain HTML, CSS, JavaScript, and local SVG charts, with system fonts and no CDN dependencies. FastAPI serves the page, extracts Word text, runs inference, and produces comparisons. No account, external inference API, telemetry, or hosted database is required. Text is sent only to the local server bound to `127.0.0.1`.

## Interpretation and limitations

The labels are **sadness, joy, love, anger, fear, surprise**. There is **no trained neutral category**. A matter-of-fact passage may still receive an emotion. Uncertain is a separate flag, not a seventh prediction.

A reading is flagged uncertain when its top score is below 0.55, its lead over the second score is below 0.15, or fewer than 30% of tokens are recognized by the vocabulary. These are transparent heuristics, not calibrated error probabilities. Scores are model preferences among six classes, not accuracy or emotional intensity. Predictions describe expressed text and do not determine the author's mental state or how an audience will feel.

Your training notebook reports 92.1% on the split also used for early-stopping validation. That is not an independent test of this webpage or its performance on literature. The original corpus contains English short social-media text. Indirect emotion, sarcasm, scripts, literary context, and unfamiliar words can produce incorrect predictions. Use the passage text and your own judgment alongside the model.

The original artifact files are copied unchanged under `Artifacts/`. `training_reference.ipynb` is the original notebook retained for explanation, not a new training run. JSON project imports contain text and annotations, not trusted cached predictions; analyses are recomputed locally. CSV exports keep original scores and manual annotations in separate columns. Character offsets are zero-based Python Unicode code-point offsets, with the end exclusive.

## Developer commands

Run these from the project folder:

```powershell
.\.venv\Scripts\python.exe launch.py
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
node --check static\script.js
```

The primary API routes are `GET /health`, `POST /api/analyze` (`{"text":"..."}`), `POST /api/extract` (multipart `file`), and `POST /api/compare` (`{"before":"...","after":"..."}`). The original `/predict` route remains available, including its original `all_probabilites` response spelling. Browse `/docs` for the generated API documentation. Analysis errors produce messages instead of substitute predictions.

Use **PRESENTATION_GUIDE.md** for a short walkthrough and common evaluation questions.
