# Presenting StoryPulse

## Before presenting

Open **Start StoryPulse.cmd** and wait for the green model status. Use Chrome or Edge at 100% zoom; the layout is designed for a laptop. Keep the server window open. Downloaded packages, the model, and all webpage assets are local, so the demonstration can run without internet.

## A four-minute live demonstration

1. **Explain the problem:** “A sentence classifier returns a label, but writers need to inspect how emotion develops through a whole story and whether a revision changes it. StoryPulse turns my trained classifier into a writing and revision tool.”
2. Select **Try a sample story**. It loads two authored versions of *The letter from home*. The original moves toward reconciliation; the revision changes the ending. Loading the story does not load predictions.
3. Select **Analyze story**. Explain that the actual saved BiGRU runs locally. Read the overview as model scores, not accuracy. Open **Write** to show the document is editable, then **Passages** to show its predictions.
4. Scroll to **The emotional arc**, select a paragraph point, and inspect **A closer reading**. Switch the timeline to sentences. Point out any uncertain reading honestly.
5. Add an interpretation and a short note. Explain that this preserves human judgment separately; it does not secretly change the model's scores or retrain the model.
6. Open **Compare drafts** and select **Compare drafts**. Show the emotion profiles, two real timelines, and the changed ending. Use **Show changes only**. Explain that the difference is a change in model output, not proof of improved writing.
7. Return to the story workspace. Use **Export → Download results (.csv)** and **Save project**. Open the saved JSON project to demonstrate that both drafts and annotations return and analysis runs again. Open **Export → Print / save report as PDF** to preview the report; cancel or save it using the browser's print controls.

If asked to prove that predictions are live, change a sentence, select **Analyze story**, and inspect the new result. Outputs are always real; do not promise that any particular emotional phrase will be classified correctly.

## What is new compared with the original project?

The original project analyzed one input string, truncated it to 50 tokens, and returned one of six labels. StoryPulse adds full-document coverage, sentence and paragraph results, selectable timelines, two-draft alignment and word differences, human annotations, local project persistence, document uploads, reports, and a reliable local launcher. It also matches inference tokenization to the training notebook.

## Common questions

**Did you train a new model?** No. This version uses my original stacked BiGRU with its original weights and tokenizer. The new work is the inference pipeline and the complete writing workflow. Retraining with narrative-domain examples and neutral labels is a future improvement.

**Why a BiGRU?** A GRU models sequences with gates. Bidirectional processing uses both directions within each input window. The saved architecture uses an embedding layer, two bidirectional GRU layers, dropout, and a six-way softmax output.

**How do you handle long stories?** Each sentence is split into consecutive 50-token windows. All windows are processed in batches, and scores are aggregated by token count. Context beyond each window is not modeled directly.

**What does 80% mean?** It is the model's score among its six classes, not an 80% guarantee of correctness or a measure of emotional intensity.

**Can it detect neutral or sarcasm?** Neutral is not a trained class, and sarcasm can be difficult. Uncertain is only a heuristic flag. A broader, independently evaluated dataset would be needed for stronger claims.

**What is the accuracy?** The notebook reports 92.1%, but reused the evaluation split for training validation. I do not claim that number as independent accuracy on stories. The webpage's software workflow has been tested separately from model quality.

**Who benefits?** Writers, literature students, and script creators can inspect passages, discuss emotional tone, and compare their revisions. Their interpretation remains central.

**Where is the data stored?** In the laptop's browser and explicitly downloaded JSON files. Analysis goes only to the local Python server. No cloud deployment is involved.

**How is this different from the other teams?** Its central task is narrative revision across passages and drafts. It does not perform lost-and-found matching, multilingual intent extraction, product-aspect sentiment analysis, consumer-complaint routing, or news categorization.
