# OCR Proofer（Obsidian プラグイン / Plugin）

古典籍 OCR テキストを Obsidian 内から校正するためのプラグインです。  
An [Obsidian](https://obsidian.md) plugin for proofreading OCR-transcribed historical Japanese documents.

> **開発状況 / Status**: このプラグインは **v1.5+** での正式対応を予定しています。現バージョン (v1.0) のメイン UI はスタンドアロン Web フロントエンド (`frontend/`) です。  
> This plugin is planned for **v1.5+**. The primary UI in v1.0 is the standalone web frontend (`frontend/`).

## Overview / 概要

OCR Proofer provides a side-panel view that links a source document (Markdown, plain text, or JSON) with its associated scan image and OCR data files, allowing you to proofread transcriptions without switching tabs.

**Current status: v0.1.0 — placeholder UI.** The file resolver and settings are fully implemented. The proofreading panel currently shows a placeholder; side-by-side document/image display will be added in a future release when the React UI is mounted.

## Features

- Resolves related files (source document, scan image, OCR data, correction log) via three configurable strategies: frontmatter keys, basename matching, or folder scan
- File-explorer and editor context-menu entries: **Open in OCR Proofer**
- Command palette: **Open OCR Proofer** / **Open active file in OCR Proofer**
- Configurable resolution priority and per-slot required-file warnings

## Supported File Types

| Role | Extensions |
|---|---|
| Source document | `.md`, `.txt`, `.json` |
| Scan image | `.png`, `.jpg`, `.jpeg`, `.tif`, `.tiff`, `.webp`, `.gif` |
| OCR data | `.json` |
| Correction log | `.csv`, `.log` |

> **Note on `.json`:** `.json` appears in both the source-document list and the OCR-data list. When you open a `.json` file directly, OCR Proofer treats it as the source document and looks for a paired image alongside it.

## Installation

### Manual (recommended for now)

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Copy them into `<your-vault>/.obsidian/plugins/ocr-proofer/`.
3. Enable **OCR Proofer** under **Settings → Community Plugins**.

### BRAT

Add this repository in [BRAT](https://github.com/TfTHacker/obsidian42-brat) for automatic updates once the repository is published.

## Configuration

Open **Settings → OCR Proofer** to configure the resolver.

| Setting | Default | Description |
|---|---|---|
| Image frontmatter key | `ocr_image` | Front matter key pointing to the scan image path |
| OCR data frontmatter key | `ocr_data` | Front matter key pointing to the OCR JSON file path |
| Correction log frontmatter key | `correction_log` | Front matter key pointing to the correction log path |
| Resolution priority | `frontmatter, basename, folder-scan` | Ordered list of strategies to try |
| Image required | on | Warn when no image file is found |
| OCR data required | on | Warn when no OCR data file is found |
| Correction log required | off | Warn when no correction log is found |

## Resolution Strategies

1. **frontmatter** — reads file paths from the document's YAML front matter using the configured keys
2. **basename** — looks for sibling files sharing the same stem (e.g. `page01.md` → `page01.png`)
3. **folder-scan** — scans the document's folder for any file with a matching extension

## Known Limitations

- **Placeholder UI:** The proofreading panel does not yet display the document or image. This is the primary missing feature in v0.1.0.
- **Desktop only:** `isDesktopOnly: true`. Mobile support is not planned for the current milestone.
- **Not yet listed** in the Obsidian Community Plugins directory.

## Requirements

- Obsidian **1.5.7** or later

## License

[MIT](LICENSE)
