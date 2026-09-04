# Vendored Tesseract language data

`eng.traineddata` — the English OCR model used by `src/server/documents/tesseractEngine.ts`.

It is committed to the repo (not fetched at runtime) so document extraction works
**fully offline** and tests are reproducible. This mirrors how `src/shared/visa-kb/data/`
ships as versioned source rather than runtime scratch.

| | |
|---|---|
| Source | <https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata> |
| Variant | `tessdata_fast` (the smaller integer-quantised LSTM model) |
| Retrieved | 2026-09-04 |
| Size | 4,113,088 bytes |
| SHA-256 | `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2` |
| Licence | Apache License 2.0 (see <https://github.com/tesseract-ocr/tessdata_fast/blob/main/LICENSE>) |

To update: download a fresh copy from the source URL, replace this file, and update
the size + SHA-256 above. Do not commit `tessdata` (standard, ~15 MB) or
`tessdata_best` (~12 MB) — `tessdata_fast` is the deliberate size/quality trade-off
for a local single-user tool.
