# Verification — 12 November 2026

The finished webpage is installed directly in `C:\Users\Jashwanth S\Downloads\Resume_Projects\Emotion-Prediction-main\Emotion-Prediction-main`. Its Python 3.11 runtime and virtual environment are inside that project. The original source and artifacts were backed up in `Original_Project_Backup_2026-11-12_191016` before the webpage files were installed. The majorproject folder was not modified.

## Completed checks

- All 12 real-model integration tests passed (52.669 seconds). They cover saved-model metadata, prediction parity with the original tokenizer/model, full long-text coverage, Unicode offsets, draft differences, valid and invalid uploads, vocabulary uncertainty, cache behavior, the legacy endpoint, and local assets.
- Python files compile, JavaScript passes Node's syntax check, element IDs are unique, and all literal JavaScript element references exist in the HTML.
- Browser checks confirmed sample loading, live inference, passage selection, independent manual annotations, paragraph/sentence timelines, emotion-curve filtering, two-draft profiles and charts, linked chart navigation, and changed-text filtering.
- The browser downloaded a real 28-row CSV for Draft B and a JSON project containing both drafts and the independent annotation. The webpage's actual format validator restored both texts and annotations from that downloaded JSON, requested genuine reanalysis, and rejected malformed and oversized projects.
- After installation in Resume_Projects, the local server's health response identified the destination folder correctly and loaded all 3,454,662 model parameters. Live comparison from that installed copy found five unchanged paragraphs, one modified paragraph, and one added paragraph. Fresh analysis took approximately 1.21 seconds for Draft A and 1.17 seconds for Draft B on this laptop in that run.
- The installed model and tokenizer match the original artifacts byte for byte. Model SHA-256: `d01fa32055cb8bb9404544983feeeefb850a2f4f493883007271afe763cb9645`. Tokenizer SHA-256: `2904bd67882f0aa18264ec38280886a5b3e0045f93533fba97b96c3d233bd884`.
- All 25 copied application/source/sample files matched the prepared version before this verification note was added. The destination launcher successfully recognized the running destination server.

## Verification limits

The user stopped Computer Use with Escape. Native browser project reopening and the print-preview dialog were not fully verified end to end. The JSON format and restoration logic were checked separately as described above. No further browser control was performed after that stop.

All required webpage assets are local and real inference was verified without a cloud API. Physical Wi-Fi disconnection was not performed. These software checks do not establish model accuracy on literature; the model's data and uncertainty limitations are documented in README.md and in the webpage.
