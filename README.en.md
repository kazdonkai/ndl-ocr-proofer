# NDL OCR Proofer

[日本語](README.md) | English

NDL OCR Proofer is a proofreading assistant for researchers who need to review, correct, and record OCR text generated from Japanese vertical historical materials, including outputs from NDL Koten OCR.

The application is designed to run outside the Obsidian Vault as a standalone web application. The Obsidian Vault is treated as the target workspace for research notes, input images, and OCR-bearing Markdown files. The application code, dictionaries, settings, evaluation logs, temporary files, and cache files should normally be kept outside the Vault.

OCR output from historical sources such as manuscripts, classical books, early modern documents, and vertically written research materials cannot usually be used as research-ready text without careful review. Character misrecognition, place names, personal names, historical terminology, old character forms, and vertical writing conventions all require comparison with the original images.

This application reads Markdown notes from a configured Obsidian Vault and provides a browser-based interface for checking OCR text, page images, and correction candidates. It combines research vocabulary dictionaries, character-shape confusion rules, proper noun hints, and particle-script detection to highlight suspicious spans and record decisions such as accepting a candidate, entering a manual correction, skipping, or rejecting a suggestion.

NDL OCR Proofer is not intended to simply make OCR text look cleaner. It is a working environment for comparing source images with OCR text, accumulating proofreading decisions, and turning OCR output into research-usable textual data.

## Important: Running Outside the Vault

Earlier development versions placed the application directory inside the Obsidian Vault. The current release-oriented workflow separates the application from the Vault for easier public distribution, cleaner maintenance, and reduced Obsidian Sync storage usage.

The recommended layout is:

```text
~/dev/proofreading-app/              # Application repository outside the Vault
├── backend/
├── frontend/
├── data/dictionaries/               # Dictionaries outside the Vault
├── evaluation/logs/                 # Evaluation logs outside the Vault
└── cache/ or tmp/                   # Temporary OCR/image output

/path/to/Obsidian/Vault/             # Research data selected by the app
├── notes/
├── images/
└── Markdown notes containing OCR results
```

The Vault should contain research notes, source images, and Markdown OCR results when needed. The application repository, development files, dictionaries, evaluation logs, temporary images, caches, and settings should normally live outside the Vault.

This separation prevents unnecessary development files, logs, and cache files from being synced through Obsidian Sync. It also makes it easier to publish and update the application repository without mixing it with private research data.

## Features

- Standalone web application that runs outside the Vault
- Read and save Markdown files inside a configured Obsidian Vault
- Review page images and OCR text side by side
- Run OCR through NDL Koten OCR / ndlkotenocr-lite
- Highlight suspicious spans using research vocabulary dictionaries
- Suggest candidates based on character-shape confusion, place names, proper nouns, and particle-script patterns
- Record accepted candidates, manual corrections, skipped spans, and rejected suggestions
- Export proofreading logs and evaluation logs
- Standalone architecture with a React + Vite frontend and FastAPI backend
- Designed with future Obsidian plugin integration in mind

## Intended Users

- Researchers working with OCR text from NDL Koten OCR or other digital archives
- Scholars in Japanese history, classical Japanese literature, textual studies, and digital humanities
- Obsidian users who manage research notes and transcriptions in Markdown
- Users who need to verify OCR results manually and preserve a record of editorial decisions
- Users who want to connect image sources with notes, transcriptions, and proofreading decisions

## Architecture

```text
proofreading-app/
├── backend/          # FastAPI backend: Vault I/O, OCR execution, analysis
├── frontend/         # React + Vite frontend: proofreading UI
├── obsidian-plugin/  # Obsidian plugin prototype / future integration
├── data/             # dictionaries and rule files
├── evaluation/       # logs and evaluation scripts
└── cache/ or tmp/    # recommended location for temporary OCR/image output
```

The main user interface is currently a standalone web application that runs in the browser. The Obsidian plugin directory is included for future integration, but the current recommended workflow is to use the standalone frontend.

## Requirements

### Basic Environment

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

This application works with Markdown files inside a configured Obsidian Vault. The application itself does not need to be placed inside the Vault.

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

## Recommended Configuration

When running outside the Vault, explicitly configure dictionaries, evaluation logs, and temporary files to stay outside the Vault.

```env
VAULT_ROOT=/path/to/your/obsidian/vault
OCR_ENGINE_PATH=/path/to/ndlkotenocr-lite
OCR_TEMP_ROOT=/path/to/proofreading-app/cache/ocr_temp
DICT_DIR=/path/to/proofreading-app/data/dictionaries
EVALUATION_DIR=/path/to/proofreading-app/evaluation/logs
BACKEND_HOST=127.0.0.1
BACKEND_PORT=8000
```

`OCR_TEMP_ROOT` is the location for temporary OCR images and intermediate files. To avoid unnecessary Obsidian Sync storage usage, point it to the application cache directory or an OS-level temporary directory, not to the Vault.

`EVALUATION_DIR` should also normally live outside the Vault. Evaluation logs may contain research text, local paths, or unpublished transcription work, so keep them out of Obsidian Sync and public GitHub repositories unless you intentionally sanitize and publish them.

## Quick Start

### Clone the Repository

Clone the repository outside the Vault.

```bash
mkdir -p ~/dev
cd ~/dev
git clone https://github.com/kazdonkai/ndl-ocr-proofer.git proofreading-app
cd proofreading-app
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
OCR_TEMP_ROOT=/path/to/proofreading-app/cache/ocr_temp
DICT_DIR=/path/to/proofreading-app/data/dictionaries
EVALUATION_DIR=/path/to/proofreading-app/evaluation/logs
BACKEND_HOST=127.0.0.1
BACKEND_PORT=8000
```

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
2. Configure the target Vault through `.env` or the settings UI.
3. Start the backend and frontend.
4. Open a target note from the file list or search interface.
5. Review OCR text and page images in the browser.
6. Accept candidates, enter manual corrections, skip spans, or reject suggestions.
7. Save the corrected result back to the Markdown file inside the Vault.
8. Review evaluation logs outside the Vault to improve dictionaries and rules.

## Logs and Evaluation Data

The application records not only final corrections but also the decision-making process during proofreading.

- `correction_events.jsonl`: Basic correction event log
- `span_accepted.jsonl`: Log of accepted candidate spans
- `user_actions.jsonl`: Log of user actions such as skip and reject
- `learning_candidates.jsonl`: Candidate log for future dictionary and rule improvements

The log output directory can be changed through `EVALUATION_DIR` in `.env`. In the outside-Vault workflow, configure it to point to a directory such as `evaluation/logs` under the application directory.

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
- [x] Dangerous candidate visualization
- [x] Accepted candidate logging
- [x] User action logging for skip and reject operations
- [x] Observation logs for experimental dictionary candidates
- [x] Aggregation script for accepted spans: `aggregate_span_accepted.py`
- [x] Aggregation script for experimental dictionary logs: `aggregate_experimental.py`
- [x] Settings UI and localStorage persistence
- [x] Settings specification in `SETTINGS_SCHEMA.md`

### In Migration

- [ ] Move the application repository outside the Obsidian Vault
- [ ] Keep dictionaries, evaluation logs, and temporary files outside the Vault by default
- [ ] Unify the workflow around selecting a target Vault at startup or in settings
- [ ] Exclude cache, logs, and development files from Obsidian Sync

### Under Observation

- [ ] Experimental observation phase V2
  - Observe experimental dictionary behavior on 20 to 30 production-like historical documents
  - Compare accept / reject / skip distributions
  - Review false positives in dangerous candidate detection
  - Check the impact of legal terms being treated as proper noun terms

### Designed / Deferred

- [ ] Type filter for `proper_noun_terms`
  - Exclude `type: legal_term` entries from proper noun treatment
  - Implementation decision will be based on V2 observation results
- [ ] AUTO_DOWNWEIGHT semi mode
  - Automatically downweight candidates repeatedly rejected for the same span
  - Planned after enough user action logs are collected
- [ ] UI improvements around OCR execution buttons
- [ ] Full Obsidian plugin integration

## Current Limitations

- The main UI is currently a standalone web application. Embedded use as an Obsidian plugin is planned for a future version.
- OCR execution requires a separate `ndlkotenocr-lite` setup.
- Existing OCR text can be proofread without OCR execution, but image and OCR file conventions depend on each user's Vault structure.
- Saving corrections modifies Markdown files inside the target Vault. Even if the application itself lives outside the Vault, you should still back up the target Vault.
- Logs and cache files may contain research data, local file paths, or unpublished transcription content. Review them carefully before publishing or sharing.

## Notes on Public Sharing

This project assumes a local research environment. Before publishing logs, evaluation data, dictionaries, or sample materials, make sure that they do not include unpublished sources, personal information, local file paths, or work-in-progress transcriptions.

After the outside-Vault migration, keep the public application repository clearly separated from private research data stored in the Obsidian Vault.

## Version

The current public release is `v1.0.0`.

See [CHANGELOG.md](CHANGELOG.md) for detailed changes.

## License

MIT License
