# NDL OCR Proofer

日本語 | [English](README.en.md)

NDL OCR Proofer は、NDL古典籍OCRなどで生成された日本語縦書き史料のOCRテキストを、研究者が確認・訂正・記録するための校正支援アプリです。

古文書・古典籍・近世史料・旧字体を含む研究資料では、OCR結果をそのまま研究用テキストとして利用することはできません。文字の誤認識、地名・人名・史料語彙の誤読、縦書き資料に固有の表記ゆれなどを、原画像と照合しながら慎重に確認する必要があります。

このアプリは、Obsidian Vault 内の Markdown ノートを読み込み、OCRテキスト・画像・校正候補をブラウザ上で確認できるようにします。研究語彙辞書、字形混同ルール、固有名詞辞書、助詞表記の検出などを組み合わせ、疑義箇所をハイライトし、候補選択・手動訂正・スキップ・却下といった判断を記録します。

NDL OCR Proofer は、単にOCRテキストを「きれいに直す」ためのツールではありません。史料画像とOCRテキストを見比べながら、どの文字をどのように読むかという校正判断を蓄積し、史料OCRを研究可能なテキストへ育てるための作業環境です。

## 主な機能

- Obsidian Vault 内の Markdown ファイルを直接読み込み・保存
- ページ単位で史料画像とOCRテキストを確認
- NDL古典籍OCR / ndlkotenocr-lite によるOCR実行
- 研究語彙辞書に基づく疑義箇所のハイライト
- 字形混同・地名・固有名詞・助詞表記に基づく候補提示
- 候補選択、手動訂正、スキップ、却下の記録
- 校正ログ・評価ログの出力
- React + Vite frontend / FastAPI backend によるスタンドアロン構成
- 将来的な Obsidian plugin 連携を想定

## 想定する利用者

- NDL古典籍OCRやデジタルアーカイブ由来のOCRテキストを扱う研究者
- 日本史・国文学・史料学・デジタルヒューマニティーズの研究者
- Obsidian を研究ノートや史料整理に利用しているユーザー
- OCR結果を手動で検証し、訂正履歴や判断過程を記録したいユーザー

## アーキテクチャ

```text
ndl-ocr-proofer/
├── backend/          # FastAPI backend: Vault I/O, OCR execution, analysis
├── frontend/         # React + Vite frontend: proofreading UI
├── obsidian-plugin/  # Obsidian plugin prototype / future integration
├── data/             # dictionaries and rule files
└── evaluation/       # logs and evaluation scripts
```

現在のメインUIは、ブラウザで動作するスタンドアロンWebアプリです。Obsidian plugin は将来的な統合を見据えた構成であり、現時点ではスタンドアロン版の利用を前提としています。

## 必要環境

### 基本環境

- Python 3.11+
- Node.js 18+
- Obsidian
- Obsidian Vault
- ndlkotenocr-lite

### Python ライブラリ

バックエンドは FastAPI で動作します。必要なライブラリは `backend/requirements.txt` にまとめています。

```text
fastapi
uvicorn
pydantic
python-dotenv
PyYAML
```

### Frontend ライブラリ

フロントエンドは React + Vite で構成されています。依存関係は `frontend/package.json` に記載されています。

主な構成は次の通りです。

- React
- React DOM
- Vite
- ESLint

## Obsidian Vault の準備

このアプリは、Obsidian Vault 内の Markdown ファイルを対象に動作します。

Obsidian をまだ利用していない場合は、先に Obsidian をインストールし、任意の場所に Vault を作成してください。Vault は、研究ノート・OCR結果・画像参照情報を保存する作業ディレクトリとして利用します。

`.env` の `VAULT_ROOT` には、この Obsidian Vault のルートディレクトリを指定します。

```env
VAULT_ROOT=/path/to/your/obsidian/vault
```

既存の Obsidian Vault を利用する場合は、事前にバックアップを取ることを推奨します。このアプリは Markdown ファイルを直接保存するため、保存時にはバックアップを作成しますが、公開前・大量処理前には Vault 全体のバックアップを確認してください。

## OCR エンジンの準備

OCRを実行する場合は、NDL古典籍OCRの軽量実行環境である `ndlkotenocr-lite` を別途セットアップし、そのディレクトリを `OCR_ENGINE_PATH` に指定します。

```env
OCR_ENGINE_PATH=/path/to/ndlkotenocr-lite
```

OCRを実行せず、既存のOCRテキストを校正するだけの場合は、`OCR_ENGINE_PATH` を未設定のままでも利用できます。この場合、OCR実行機能のみ無効になります。

## Quick Start

### リポジトリを取得

```bash
git clone https://github.com/kazdonkai/ndl-ocr-proofer.git
cd ndl-ocr-proofer
```

### バックエンド設定を作成

```bash
cd backend
cp .env.example .env
```

`.env` を開き、自分の環境に合わせて編集します。

```env
VAULT_ROOT=/path/to/your/obsidian/vault
OCR_ENGINE_PATH=/path/to/ndlkotenocr-lite
OCR_TEMP_ROOT=/tmp/ocr_temp
BACKEND_HOST=127.0.0.1
BACKEND_PORT=8000
```

### バックエンドを起動

```bash
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python3 -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

起動後、以下のURLでAPIドキュメントを確認できます。

```text
http://127.0.0.1:8000/docs
```

### フロントエンドを起動

別のターミナルで実行します。

```bash
cd frontend
npm install
npm run dev
```

ターミナルに表示される `Local:` のURLをブラウザで開いてください。

## 基本的な使い方

1. Obsidian Vault 内にOCR結果を含む Markdown ノートを用意します。
2. バックエンドとフロントエンドを起動します。
3. ブラウザ上のファイル一覧または検索から対象ノートを開きます。
4. OCRテキストと画像を確認し、疑義箇所の候補を選択します。
5. 必要に応じて手動訂正、スキップ、却下を行います。
6. 校正結果を保存します。
7. 校正ログ・評価ログを確認し、辞書やルールの改善に利用します。

## ログと評価データ

このアプリは、校正結果だけでなく、校正中の判断過程も記録します。

- `correction_events.jsonl`: 校正イベントの基本ログ
- `span_accepted.jsonl`: 候補を採用したスパンのログ
- `user_actions.jsonl`: スキップ・却下などのユーザー操作ログ
- `learning_candidates.jsonl`: 将来的な辞書・ルール改善に利用する候補ログ

ログの出力先は `.env` の `EVALUATION_DIR` で変更できます。未設定の場合は、Vault 内の `proofreading-app/evaluation/logs` が既定値として利用されます。

## Roadmap

このRoadmapは、現在の開発版の進捗に基づく概要です。

### 実装済み

- [x] Obsidian Vault 内 Markdown ファイルの読み込み・保存
- [x] 保存前バックアップの作成
- [x] ページ単位のOCRテキスト表示
- [x] ページ単位のOCR実行とOCR callout挿入
- [x] React + Vite によるスタンドアロン校正UI
- [x] FastAPI によるバックエンドAPI
- [x] 研究語彙辞書による候補提示
- [x] stable / experimental 辞書ティア分離
- [x] 実験的辞書のON/OFF設定UI
- [x] 字形混同候補の検出
- [x] 地名・固有名詞候補の補助スコアリング
- [x] 短い地名aliasによる過剰候補の抑制
- [x] カタカナ優勢文書における助詞表記候補の検出
- [x] 全ページ一括カタカナ化支援
- [x] dangerous candidate の可視化
- [x] 候補採用ログの記録
- [x] スキップ・却下などのユーザー操作ログの記録
- [x] experimental辞書候補の観測用ログ
- [x] `aggregate_span_accepted.py` による採用候補集計
- [x] `aggregate_experimental.py` による実験辞書ログ集計
- [x] 設定UIと localStorage 永続化
- [x] `SETTINGS_SCHEMA.md` による設定仕様の整理

### 観測中

- [ ] 実験観測フェーズ V2
  - 本番史料20〜30件を対象に experimental 辞書候補の挙動を観測
  - accept / reject / skip の分布を確認
  - dangerous flag の false positive を確認
  - legal_term が proper noun として扱われる問題の影響範囲を確認

### 設計済み・実装保留

- [ ] `proper_noun_terms` の type filter
  - `type: legal_term` を proper noun 扱いから除外する案
  - V2観測結果に基づいて実装判断
- [ ] AUTO_DOWNWEIGHT semi mode
  - 同一スパンを繰り返し却下した場合に候補スコアを自動的に減衰させる仕組み
  - user action log の蓄積後に設計・実装予定
- [ ] OCR実行ボタン周辺のUI改善
- [ ] Obsidian plugin としての統合

## 現在の制限

- 現時点の主UIはスタンドアロンWebアプリです。Obsidian plugin としての埋め込み利用は将来対応予定です。
- OCR実行には外部の `ndlkotenocr-lite` セットアップが必要です。
- OCRなしでも既存OCRテキストの校正は可能ですが、画像・OCRファイルの構成は利用者のVault設計に依存します。
- 校正ログには研究資料の内容やローカルパスが含まれる場合があります。公開・共有前にはログの内容を確認してください。

## 公開・共有時の注意

このアプリはローカルの研究環境での利用を前提としています。公開リポジトリにログ、評価データ、辞書、サンプル史料を含める場合は、未公開史料・個人情報・ローカルファイルパス・研究途中の翻刻データが含まれていないか確認してください。

## Version

現在の公開リリースは `v1.0.0` です。

詳細な変更履歴は [CHANGELOG.md](CHANGELOG.md) を参照してください。

## License

MIT License
