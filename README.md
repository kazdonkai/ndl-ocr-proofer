# README

日本語 | [English](README.en.md)

NDL OCR Proofer は、NDL古典籍OCRなどで生成された日本語縦書き史料のOCRテキストを、研究者が確認・訂正・記録するための校正支援アプリです。

古文書・古典籍・近世史料・旧字体を含む研究資料では、OCR結果をそのまま研究用テキストとして利用することはできません。文字の誤認識、地名・人名・史料語彙の誤読、縦書き資料に固有の表記ゆれなどを、原画像と照合しながら慎重に確認する必要があります。

このアプリは、Obsidian Vault 内の Markdown ノートを読み込み、OCRテキスト・画像・校正候補をブラウザ上で確認できるようにします。研究語彙辞書、字形混同ルール、固有名詞辞書、助詞表記の検出などを組み合わせ、疑義箇所をハイライトし、候補選択・手動訂正・スキップ・却下といった判断を記録します。

NDL OCR Proofer は、単にOCRテキストを「きれいに直す」ためのツールではありません。史料画像とOCRテキストを見比べながら、どの文字をどのように読むかという校正判断を蓄積し、史料OCRを研究可能なテキストへ育てるための作業環境です。

## 主な機能

- Obsidian Vault 内の Markdown ファイルを直接読み込み・保存
- ページ単位で史料画像とOCRテキストを確認（ページ別 / シームレス表示切替）
- NDL古典籍OCR / ndlkotenocr-lite によるOCR実行
- 研究語彙辞書に基づく疑義箇所のハイライト
- 字形混同・地名・固有名詞・助詞表記に基づく候補提示
- 候補選択、手動訂正、スキップ、却下の記録
- **辞書管理GUI**: temporary / approval 辞書をブラウザ上で直接編集
- **手動昇格フロー**: temporary → approval 辞書への昇格を GUI から実行
- 校正ログ・評価ログの出力
- React + Vite frontend / FastAPI backend によるスタンドアロン構成
- 将来的な Obsidian plugin 連携を想定

### 辞書の種類

このアプリは、校正候補の精度に応じて辞書を3種類に分けて管理します。

| 種類 | 説明 |
|------|------|
| **temporary** | 校正中に手動登録した語。未確認のため approval より優先度は低い。GUI から直接編集・削除できる。 |
| **approval** | 研究上確認済みとして登録した語。候補提示の主力。GUI から直接追加・編集・削除できる。 |
| **protect** | 各辞書エントリに設定できるフラグ。`protect=true` のエントリを含むファイルは、ファイルごとの削除から保護される。 |

辞書管理UIはヘッダーバーの「辞書管理」ボタンから開けます。

### 昇格候補（`is_promotion_candidate`）

temporary辞書のエントリに対して、手動登録が繰り返されるとその回数が `approval_count` としてカウントされます。登録回数が閾値（デフォルト: 3回）を超えると、辞書管理GUI上で昇格候補として強調表示されます。

昇格候補は「approval に移してよいかもしれない」という**注目表示**であり、自動的に approval に昇格するわけではありません。手動で昇格操作を行うまでは temporary 上のエントリとして動作します。

### 辞書運用フロー

```
校正中に手動訂正
    ↓
temporary辞書への登録プロンプト（任意）
    ↓
temporary辞書で実績を蓄積 → 昇格候補として表示（approval_count ≥ 3）
    ↓
辞書管理GUI から手動昇格（temporary → approval）
    ↓
approval辞書で候補提示に利用
```

approval辞書には、昇格を経由せずに GUI から直接エントリを追加することもできます。

### 画像表示 UI

- **ページ別 / シームレス** 表示モード切替
- **拡大縮小**: スクロールホイール（ページ別）/ Ctrl+ホイール（シームレス）・`+`/`-`/`0` キー・ダブルクリック（1× ↔ 2×）・ヘッダーバッジクリックでリセット（0.3× 〜 4.0× 範囲）
- **パン（画像移動）**: 左クリックドラッグで画像を自由移動（ページ別は transform、シームレスはコンテナスクロール）
- **自然サイズ表示**: 100% 時は小さい画像を引き伸ばさず自然サイズで中央表示
- **保存後ページ位置復元**: 保存・ステータス変更後も表示中のページ位置を維持
- **縦書きモードのホイール横スクロール**: 縦書き表示でホイール操作を横スクロールに変換
- **疑義箇所の改行可視化**: プレビューモードで `\n` を ¶ マーク付きで表示・選択可能

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

### アプリ設定を作成

```bash
cp app.toml.example app.toml
```

`app.toml` は OCR・辞書・ステータス等の動作設定をまとめたファイルです。環境固有のパス情報は含まれないため、そのままコミットできます。

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
6. 手動訂正後のプロンプトから、temporary辞書に語を登録できます。
7. ヘッダーの「辞書管理」ボタンから、辞書エントリの確認・編集・昇格を行います。
8. 校正結果を保存します。

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
- [x] dangerous candidate の可視化（rank1 が固有名詞かつ字形ペア由来でない場合）
- [x] 候補採用ログの記録
- [x] スキップ・却下などのユーザー操作ログの記録
- [x] experimental辞書候補の観測用ログ
- [x] `aggregate_span_accepted.py` による採用候補集計
- [x] `aggregate_experimental.py` による実験辞書ログ集計
- [x] 設定UIと localStorage 永続化
- [x] `SETTINGS_SCHEMA.md` による設定仕様の整理
- [x] ページ別 / シームレス 表示モード切替
- [x] 画像拡大縮小（スクロールホイール・Ctrl+ホイール・キーボードショートカット・ダブルクリック）
- [x] 左クリックドラッグによる画像パン（ページ別: transform、シームレス: コンテナスクロール）
- [x] 100% 表示時の自然サイズ表示（小さい画像を引き伸ばさない）
- [x] 保存・ステータス変更後のページ位置復元（ページ別・シームレス両対応）
- [x] 縦書きモードのホイール横スクロール変換
- [x] 疑義箇所チェックモードの改行可視化・選択対応（¶ マーク）
- [x] temporary辞書登録（手動訂正後の登録プロンプト含む）
- [x] temporary辞書の GUI 編集（有効/無効・フィールド編集・物理削除）
- [x] temporary辞書の複数ファイル管理（新規ファイル作成・削除）
- [x] approval辞書の GUI 管理（エントリ追加・編集・削除）
- [x] approval辞書の直接作成（昇格を経由せず GUI から追加可能）
- [x] temporary → approval 手動昇格フロー（競合チェック・上書き・スキップ対応）
- [x] 昇格候補表示（`approval_count` ≥ 3 で強調表示）
- [x] protect フラグによるファイル削除保護
- [x] `app.toml` による設定ファイル管理
- [x] `PATCH /api/config` による設定の部分更新（型バリデーション・原子的書き込み）

### 観測中

- [ ] 実験観測フェーズ V2
  - 本番史料20〜30件を対象に experimental 辞書候補の挙動を観測
  - accept / reject / skip の分布を確認
  - dangerous flag の false positive を確認
  - legal_term が proper noun として扱われる問題の影響範囲を確認

### 設計済み・実装保留

- [ ] temporary → approval の自動昇格（未実装。`approval_count` ≥ 閾値でも昇格は手動のみ）
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
- `approval_count` による自動昇格は未実装です。昇格候補として表示された語は、手動で昇格操作を行う必要があります。
- temporary → approval の昇格後は、`app.toml` の辞書設定に依存して候補提示に反映されます。反映されない場合はバックエンドを再起動してください。

## 公開・共有時の注意

このアプリはローカルの研究環境での利用を前提としています。公開リポジトリにログ、評価データ、辞書、サンプル史料を含める場合は、未公開史料・個人情報・ローカルファイルパス・研究途中の翻刻データが含まれていないか確認してください。

## Version

現在の公開リリースは `v1.1.0` です。

詳細な変更履歴は [CHANGELOG.md](CHANGELOG.md) を参照してください。

## License

MIT License
