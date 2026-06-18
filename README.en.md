# 影印校エディタ

*Japanese name: 影印校エディタ — a browser-based collation editor for historical OCR*

[日本語](README.md) | English

> **Platform: macOS only**
> This application runs on **macOS only**. `ndlkotenocr-lite`, the OCR engine used by this app, does not support Windows, so Windows is not a supported platform.

影印校エディタ is a proofreading assistant for researchers who need to review, correct, and record OCR text generated from Japanese vertical historical materials, including outputs from NDL Koten OCR.

OCR output from historical sources such as manuscripts, classical books, early modern documents, and vertically written research materials cannot usually be used as research-ready text without careful review. Character misrecognition, place names, personal names, historical terminology, old character forms, and vertical writing conventions all require comparison with the original images.

This application reads Markdown notes from a configured Obsidian Vault and provides a browser-based interface for checking OCR text, page images, and correction candidates. It combines research vocabulary dictionaries, character-shape confusion rules, proper noun hints, and particle-script detection to highlight suspicious spans and record decisions such as accepting a candidate, entering a manual correction, skipping, or rejecting a suggestion.

影印校エディタ is not intended to simply make OCR text look cleaner. It is a working environment for comparing source images with OCR text, accumulating proofreading decisions, and turning OCR output into research-usable textual data.

## Features

- Read and save Markdown files inside a configured Obsidian Vault
- Review page images and OCR text side by side (paged or seamless scroll mode)
- Run OCR through NDL Koten OCR / ndlkotenocr-lite
- Highlight suspicious spans using research vocabulary dictionaries
- Suggest candidates based on character-shape confusion, place names, proper nouns, and particle-script patterns
- Record accepted candidates, manual corrections, skipped spans, and rejected suggestions
- **Dictionary management GUI**: edit temporary and approval dictionaries directly in the browser
- **Manual promotion flow**: promote entries from temporary to approval dictionary via the GUI
- Export proofreading logs and evaluation logs
- Standalone architecture with a React + Vite frontend and FastAPI backend
- Designed with future Obsidian plugin integration in mind

### Dictionary Types

The application manages correction candidates using three dictionary concepts:

| Type | Description |
|------|-------------|
| **temporary** | Words registered manually during proofreading. Unverified; lower priority than approval. Editable and deletable via the GUI. |
| **approval** | Words confirmed as correct for the research domain. Primary source for candidate suggestions. Addable, editable, and deletable via the GUI. |
| **protect** | A flag on individual entries. Files containing `protect=true` entries cannot be deleted as a whole file. |

The dictionary management UI is available from the "辞書管理" (Dictionary) button in the header bar.

### Promotion Candidates (`is_promotion_candidate`)

When the same term is re-registered in the temporary dictionary, the re-registration count is tracked as `approval_count`. Once this count reaches the threshold (default: 3), the entry is highlighted as a promotion candidate in the dictionary management UI.

A promotion candidate is a **visual hint** suggesting the entry may be ready to promote to approval. It does not automatically move to the approval dictionary. You must manually perform the promotion through the dictionary management GUI.

### Dictionary Workflow

```
Manual correction during proofreading
    ↓
Optional prompt to register to temporary dictionary
    ↓
Accumulate evidence in temporary → highlighted as promotion candidate (approval_count ≥ 3)
    ↓
Manual promotion via dictionary management GUI (temporary → approval)
    ↓
Approval dictionary used for candidate suggestions
```

You can also add entries to the approval dictionary directly through the GUI without going through the promotion flow.

### Image Viewer UI

- **Paged / Seamless** display mode toggle
- **Zoom**: scroll wheel (paged mode) / Ctrl+scroll (seamless) · `+`/`-`/`0` keyboard shortcuts · double-click toggle (1× ↔ 2×) · header badge click to reset (range 0.3× – 4.0×)
- **Pan**: left-click drag to freely reposition the image (transform-based in paged mode, scroll-based in seamless mode)
- **Natural-size display**: at 100% zoom, small images are shown at their natural pixel dimensions rather than stretched to fill the container
- **Page position restore after save**: the current page is preserved after saving or changing document status (both paged and seamless modes)
- **Vertical-writing horizontal scroll**: in vertical writing mode, the mouse wheel is converted to horizontal scroll
- **Newline visualization in preview mode**: `\n` characters are displayed as ¶ marks and can be selected in the suspect-span check mode

## Intended Users

- Researchers working with OCR text from NDL Koten OCR or other digital archives
- Scholars in Japanese history, classical Japanese literature, textual studies, and digital humanities
- Obsidian users who manage research notes and transcriptions in Markdown
- Users who need to verify OCR results manually and preserve a record of editorial decisions

## Architecture

```text
ndl-ocr-proofer/
├── backend/          # FastAPI backend: Vault I/O, OCR execution, analysis
├── frontend/         # React + Vite frontend: proofreading UI
├── obsidian-plugin/  # Obsidian plugin prototype / future integration
├── data/             # dictionaries and rule files
└── evaluation/       # logs and evaluation scripts
```

The main user interface is currently a standalone web application that runs in the browser. The Obsidian plugin directory is included for future integration, but the current recommended workflow is to use the standalone frontend.

## Requirements

### Basic Environment

- **macOS** (Windows is not supported)
- Python 3.11+
- Node.js 18+
- Obsidian
- Obsidian Vault
- ndlkotenocr-lite

### Python Libraries

The backend runs on FastAPI. Required Python packages are listed in `backend/requirements.txt`.

```text
fastapi
uvicorn
pydantic
python-dotenv
PyYAML
```

### Frontend Libraries

The frontend is built with React and Vite. Dependencies are listed in `frontend/package.json`.

The main components are:

- React
- React DOM
- Vite
- ESLint

## Preparing an Obsidian Vault

This application works with Markdown files inside a configured Obsidian Vault.

If you do not already use Obsidian, install Obsidian first and create a Vault in any location. The Vault acts as the workspace for research notes, source images, and OCR-bearing Markdown files.

Set the root directory of your Obsidian Vault in `VAULT_ROOT` inside `.env`.

```env
VAULT_ROOT=/path/to/your/obsidian/vault
```

If you use an existing Vault, it is strongly recommended that you make a backup before running large-scale operations. The application creates backups before saving Markdown files, but you should still verify your Vault-level backup policy before using it on important research data.

## Preparing the OCR Engine

To run OCR from the application, set up `ndlkotenocr-lite` separately and specify its directory in `OCR_ENGINE_PATH`.

```env
OCR_ENGINE_PATH=/path/to/ndlkotenocr-lite
```

If you only want to proofread existing OCR text and do not need to run OCR, you can leave `OCR_ENGINE_PATH` unset. In that case, only OCR execution will be disabled.

## Quick Start

### Clone the Repository

```bash
git clone https://github.com/kazdonkai/ndl-ocr-proofer.git
cd ndl-ocr-proofer
```

### Create Backend Configuration

```bash
cd backend
cp .env.example .env
```

Edit `.env` for your local environment.

```env
VAULT_ROOT=/path/to/your/obsidian/vault
OCR_ENGINE_PATH=/path/to/ndlkotenocr-lite
OCR_TEMP_ROOT=/tmp/ocr_temp
BACKEND_HOST=127.0.0.1
BACKEND_PORT=8000
```

### Create Application Configuration

```bash
cp app.toml.example app.toml
```

`app.toml` holds operational settings for OCR behavior, dictionary use, and status handling. It contains no environment-specific paths and can be committed to version control.

### Start the Backend

```bash
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python3 -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

After startup, the API documentation is available at:

```text
http://127.0.0.1:8000/docs
```

### Start the Frontend

Open a separate terminal and run:

```bash
cd frontend
npm install
npm run dev
```

Open the local URL shown by Vite in your browser.

## Basic Workflow

1. Prepare Markdown notes with embedded images inside your Obsidian Vault.
2. Start the backend and frontend.
3. Open a target note from the file list or search interface.
4. Review OCR text and page images in the browser.
5. Accept candidates, enter manual corrections, skip spans, or reject suggestions.
6. After a manual correction, use the registration prompt to optionally add the term to the temporary dictionary.
7. Use the "Dictionary" button in the header to review, edit, and promote dictionary entries.
8. Save the corrected result back to the Markdown file inside the Vault.

## Logs and Evaluation Data

The application records not only final corrections but also the decision-making process during proofreading.

- `correction_events.jsonl`: Basic correction event log
- `span_accepted.jsonl`: Log of accepted candidate spans
- `user_actions.jsonl`: Log of user actions such as skip and reject
- `learning_candidates.jsonl`: Candidate log for future dictionary and rule improvements

The log output directory can be changed through `EVALUATION_DIR` in `.env`.

## Roadmap

This roadmap summarizes the current development status.

### Implemented

- [x] Read and save Markdown files inside an Obsidian Vault
- [x] Create backups before saving
- [x] Display page-level OCR text
- [x] Run OCR per page and insert OCR callouts
- [x] Standalone proofreading UI built with React + Vite
- [x] FastAPI backend API
- [x] Candidate suggestions from research vocabulary dictionaries
- [x] Stable / experimental dictionary tier separation
- [x] UI toggle for experimental dictionaries
- [x] Character-shape confusion detection
- [x] Auxiliary scoring for place names and proper nouns
- [x] Suppression of noisy short place-name aliases
- [x] Particle-script candidate detection for katakana-dominant documents
- [x] File-level bulk katakana conversion support
- [x] Dangerous candidate visualization (rank-1 is proper noun and not from shape pairs)
- [x] Accepted candidate logging
- [x] User action logging for skip and reject operations
- [x] Observation logs for experimental dictionary candidates
- [x] Aggregation script for accepted spans: `aggregate_span_accepted.py`
- [x] Aggregation script for experimental dictionary logs: `aggregate_experimental.py`
- [x] Settings UI and localStorage persistence
- [x] Settings specification in `SETTINGS_SCHEMA.md`
- [x] Paged / Seamless display mode toggle
- [x] Image zoom (scroll wheel, Ctrl+scroll, keyboard shortcuts, double-click)
- [x] Left-click drag image pan (transform in paged mode, container scroll in seamless mode)
- [x] Natural-size display at 100% zoom (small images not stretched)
- [x] Page position restore after save and status change (paged and seamless)
- [x] Vertical-writing horizontal scroll conversion
- [x] Newline visualization and selection in suspect-span check mode (¶ marks)
- [x] Temporary dictionary registration (including post-manual-correction prompt)
- [x] Temporary dictionary GUI editing (enable/disable, field editing, physical deletion)
- [x] Multi-file management for temporary dictionaries (create / delete files)
- [x] Approval dictionary GUI management (add, edit, delete entries)
- [x] Direct entry creation in approval dictionary (without going through promotion)
- [x] Manual promotion flow (temporary → approval, with conflict check, overwrite, and skip)
- [x] Promotion candidate display (`approval_count` ≥ 3 highlighted in the GUI)
- [x] protect flag for file-level deletion protection
- [x] `app.toml` based application configuration
- [x] `PATCH /api/config` for partial config updates (type validation, atomic writes)

### Under Observation

- [ ] Experimental observation phase V2
  - Observe experimental dictionary behavior on 20 to 30 production-like historical documents
  - Compare accept / reject / skip distributions
  - Review false positives in dangerous candidate detection
  - Check the impact of legal terms being treated as proper noun terms

### Designed / Deferred

- [ ] Automatic promotion from temporary to approval (not implemented; `approval_count` ≥ threshold only triggers a visual hint — promotion remains manual)
- [ ] Type filter for `proper_noun_terms` (exclude `type: legal_term` from proper noun treatment)
- [ ] AUTO_DOWNWEIGHT semi mode (automatically downweight candidates repeatedly rejected for the same span)
- [ ] UI improvements around OCR execution buttons
- [ ] Full Obsidian plugin integration

## Current Limitations

- **This application runs on macOS only.** `ndlkotenocr-lite` does not support Windows, so Windows is not a supported platform.
- The main UI is currently a standalone web application. Embedded use as an Obsidian plugin is planned for a future version.
- OCR execution requires a separate `ndlkotenocr-lite` setup.
- Existing OCR text can be proofread without OCR execution, but image and OCR file conventions depend on each user's Vault structure.
- Logs and cache files may contain research data, local file paths, or unpublished transcription content. Review them carefully before publishing or sharing.
- Automatic promotion from temporary to approval is not implemented. Entries marked as promotion candidates must be promoted manually through the dictionary management GUI.
- After promoting an entry, the approval dictionary takes effect based on the `app.toml` settings. If changes are not reflected, restart the backend.

## Notes on Public Sharing

This project assumes a local research environment. Before publishing logs, evaluation data, dictionaries, or sample materials, make sure that they do not include unpublished sources, personal information, local file paths, or work-in-progress transcriptions.

## Version

The current public release is `v1.1.0`.

See [CHANGELOG.md](CHANGELOG.md) for detailed changes.

## License

MIT License
