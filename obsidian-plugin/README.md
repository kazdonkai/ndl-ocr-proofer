# OCR Proofer Bridge（Obsidian プラグイン）

影印校エディタと Obsidian を接続する **Bridge Plugin** です。

> **このプラグインは単体では完結しません。**  
> [影印校エディタ](../README.md)（proofreading-app）の backend / frontend が起動していることが前提です。

---

## このプラグインの役割

Obsidian でノートを右クリック → 「**Open in OCR Proofer**」を実行すると、
起動中の影印校エディタ（ブラウザ上の Web アプリ）に対象ノートを受け渡します。

- **SSE bridge** 経由で既存タブにノートを切り替える（`reuse-existing` モード）
- または常に新しいタブで開く（`always-new` モード）

OCR の確認・候補選択・保存はすべてブラウザ側の影印校エディタで行います。  
Obsidian 内に OCR テキストや校正 UI を表示する機能はこのプラグインには含まれません。

---

## 必要なもの

| 依存 | バージョン |
|------|-----------|
| Obsidian | 1.5.7 以上 |
| 影印校エディタ backend | proofreading-app v1.1.3 以上 |
| macOS | 必須（影印校エディタ本体が macOS 専用） |

---

## 影印校エディタのセットアップと起動

プラグインを使用する前に、影印校エディタが起動している必要があります。

```bash
git clone <repo-url> proofreading-app
cd proofreading-app

# 初回: 設定ファイル作成
cp backend/.env.example backend/.env   # VAULT_ROOT を自分の Vault パスに設定
cp app.toml.example app.toml

# 初回: 依存インストール
cd backend && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt && cd ..
cd frontend && npm install && cd ..

# 推奨起動方法（production モード: 1 プロセス、port 8000）
./start.sh --prod
```

`http://localhost:8000` にアクセスして影印校エディタが表示されることを確認してから、このプラグインを使用してください。

### 起動モード早見表

| コマンド | アクセス URL | 用途 |
|----------|-------------|------|
| `./start.sh --prod` | `http://localhost:8000` | **推奨**。FastAPI が frontend をまとめて配信する 1 プロセス構成 |
| `./start.sh` | `http://localhost:5176` | 開発時。backend (8000) + Vite dev server (5176) の 2 プロセス |

プラグインの「サーバー URL」設定は起動モードに合わせて変更してください（既定値: `http://localhost:8000`）。

---

## インストール

### 手動インストール（推奨）

1. 最新リリースから以下のファイルをダウンロードします:
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. Vault の `.obsidian/plugins/ocr-proofer/` ディレクトリを作成し、3 ファイルをコピーします。
3. Obsidian → **設定 → コミュニティプラグイン** でプラグインリストを更新し、**OCR Proofer Bridge** を有効化します。

### ソースからビルドしてインストール（開発用）

proofreading-app リポジトリを clone した環境でビルドできます。

```bash
cd obsidian-plugin
npm install
npm run dev   # .obsidian/plugins/ocr-proofer/main.js に直接出力
```

`npm run dev` は `esbuild.config.mjs` に記載されているパスへ出力します。  
パスが自分の Vault と一致しているか確認してください。

---

## 設定

Obsidian の **設定 → OCR Proofer Bridge** から設定できます。

### 起動設定

| 設定 | 既定値 | 説明 |
|------|--------|------|
| サーバー URL | `http://localhost:8000` | 影印校エディタのベース URL |
| 起動モード | 既存タブを再利用 | ノートの受け渡し方法 |

### 起動モード詳細

| モード | 動作 |
|--------|------|
| **既存タブを再利用**（`reuse-existing`） | 既存の影印校エディタタブにノートを切り替えます。タブが初めて開かれる場合のみ確認なしで新しいタブを開きます。タブが既にある場合は **切り替え前に確認ダイアログ** を表示します。通常の校正作業に推奨。 |
| **常に新しいタブを開く**（`always-new`） | 基本的に毎回新しいタブでノートを開きます。ただし **同じノートが既にタブで開かれている場合は確認ダイアログ** を表示し、承認後に既存タブを再利用します（重複タブを防止）。 |

#### 確認ダイアログについて

未保存の作業を誤って失わないよう、既存タブに影響を与える操作の前に Obsidian 上で確認ダイアログを表示します。

| 操作 | ダイアログが出る条件 |
|------|---------------------|
| `reuse-existing` でノートを開く | 影印校エディタのタブが既に開いている場合 |
| `always-new` でノートを開く | **同じ**ノートが既にタブで開かれている場合 |

- **続ける** → 切り替え / 再読み込みを実行
- **キャンセル** / ESC / × → 操作を中止（タブは変更されない）

#### `reuse-existing` の動作フロー

```
1. Obsidian で「Open in OCR Proofer」を実行
2. Plugin が check-any で接続中タブの有無を確認
3. タブあり → 確認ダイアログを表示
   ├─ 続ける   → POST /api/bridge/open でノートを切り替え
   └─ キャンセル → 何もしない
4. タブなし（初回起動）→ 確認なしで新しいタブを開く
5. サーバー接続自体に失敗 → 新しいタブを開く
```

#### `always-new` の動作フロー

```
1. Obsidian で「Open in OCR Proofer」を実行
2. Plugin が check-same-note で同じノートのタブ有無を確認
3. 同じノートのタブあり → 確認ダイアログを表示
   ├─ 続ける   → そのタブを再利用（新タブは開かない）
   └─ キャンセル → 何もしない
4. 異なるノート / タブなし → 確認なしで新しいタブを開く
```

### RESOLVER 設定

ファイル解決戦略の設定です。通常はデフォルトのままで問題ありません。

| 設定 | 既定値 | 説明 |
|------|--------|------|
| Image frontmatter key | `ocr_image` | 画像ファイルパスを持つ frontmatter キー |
| OCR data frontmatter key | `ocr_data` | OCR データファイルパスを持つ frontmatter キー |
| Correction log frontmatter key | `correction_log` | 校正ログファイルパスを持つ frontmatter キー |
| Resolution priority | `body-callout, frontmatter, basename, folder-scan` | 解決ステップの優先順位 |

---

## 使い方

影印校エディタが起動している状態で:

- **ファイルエクスプローラーで右クリック** → 「Open in OCR Proofer」
- **エディタ上で右クリック** → 「Open current file in OCR Proofer」
- **コマンドパレット**（`Cmd+P`）→ 「Open active file in OCR Proofer」
- **リボンアイコン**（scan-text）→ プラグインパネルを開く

対応ファイル形式: `.md` / `.txt` / `.json`

---

## 更新後の注意

プラグインファイル（`main.js` 等）を更新した後は、Obsidian の **設定 → コミュニティプラグイン** で
プラグインを一度 **OFF → ON** してください。

Obsidian はプラグインを起動時にロードするため、ファイルを差し替えるだけでは新バージョンが反映されません。

---

## バージョン対応

このプラグインのバージョンは **proofreading-app 本体のバージョンと合わせています**。

| Plugin バージョン | proofreading-app バージョン | 主な内容 |
|------------------|---------------------------|----------|
| 1.1.4 | 1.1.4 | always-new 同一ノート再利用・切り替え確認ダイアログ・SSE 切断バグ修正。 |
| 1.1.3 | 1.1.3 | Bridge plugin 正式リリース。SSE bridge・reuse-existing モード実装。 |
| 0.1.0 | — | 初期プロトタイプ（プレースホルダー UI のみ、動作しない） |

bridge API（`/api/bridge/open`）の仕様は proofreading-app backend に依存します。  
**plugin のバージョンと backend のバージョンは一致させて使用してください。**

---

## 開発・ビルド手順

```bash
cd obsidian-plugin
npm install

# 開発ビルド（.obsidian/plugins/ocr-proofer/main.js に直接出力、inline sourcemap 付き）
npm run dev

# 配付用ビルド（このディレクトリの main.js を更新、sourcemap なし）
npm run build
```

### 配付成果物

`npm run build` 実行後、以下のファイルが配付成果物の全体です:

```
obsidian-plugin/
├── main.js          ← npm run build で生成（ここに上書きされる）
├── manifest.json
├── versions.json
└── styles.css
```

これら 4 ファイルを Vault の `.obsidian/plugins/ocr-proofer/` にコピーすれば
プラグインを導入できます。

---

## ファイル構成

```
obsidian-plugin/
├── main.ts              # Plugin エントリポイント
├── resolver.ts          # Re-export facade（src/ への窓口）
├── src/
│   ├── core/            # Obsidian 非依存のコアロジック（型・設定・解決戦略）
│   └── obsidian/        # Obsidian API を使用するアダプター
├── esbuild.config.mjs   # ビルド設定
├── manifest.json        # Obsidian plugin マニフェスト
├── versions.json        # plugin バージョンと Obsidian 最低バージョンの対応表
├── styles.css           # プラグインスタイル（サイドパネル用）
├── tsconfig.json
├── package.json
└── main.js              # 配付成果物（npm run build で生成）
```

---

## プロジェクト内での位置づけ

このプラグインは [proofreading-app](../README.md) リポジトリに同梱されています。

| 項目 | 内容 |
|------|------|
| 開発の正本 | proofreading-app リポジトリ（この `obsidian-plugin/` ディレクトリ） |
| メイン UI | proofreading-app の standalone web app（`frontend/`） |
| このプラグインの役割 | bridge のみ（Obsidian → web app へのノート受け渡し） |
| 別リポジトリ化 | 現時点では未実施。将来切り出せるようにビルド・配付は独立して完結する設計にしています |

---

## トラブルシューティング

### 「Open in OCR Proofer」を実行しても何も起きない / 該当ノートが開かない

#### 症状

- ファイルを右クリックして「Open in OCR Proofer」を実行したが、ブラウザが開かない
- ブラウザは開くが、別のノートが表示される、または空のエディタになる

#### 原因候補 ①：影印校エディタが起動していない

まず `http://localhost:8000` にアクセスして、影印校エディタが表示されることを確認してください。  
表示されない場合は `./start.sh --prod` で起動してから再試行してください。

#### 原因候補 ②：Vault 名の設定ミス

plugin がノートのパスを組み立てる際に **Obsidian の Vault 名** を使用します。  
設定の Vault 名が実際の Vault 名と一致していないと、ノートを正しく受け渡せません。

**正しい Vault 名の確認手順**

1. Obsidian を開き、左下の **Vault 選択アイコン**（保管庫のアイコン）をクリックします。
2. 表示された保管庫リストに、自分の Vault の名前が表示されます。  
   この名称が Obsidian が認識している正式な Vault 名です。
3. あるいは Obsidian の **設定 → 情報** に表示されるパスの末尾フォルダ名でも確認できます。

**設定の修正手順**

1. Obsidian の **設定 → OCR Proofer Bridge** を開きます。
2. **「Vault 名」** 欄に、上で確認した Vault 名を **そのまま正確に** 入力します。  
   （大文字・小文字・スペースを含め一字一句一致させてください）
3. 設定を保存します。

**修正後の再起動手順**

設定変更後は、プラグインを一度 OFF → ON してください。

1. **設定 → コミュニティプラグイン** を開きます。
2. **OCR Proofer Bridge** のトグルを OFF にします。
3. 数秒待ってから再度 ON にします。
4. 再び「Open in OCR Proofer」を実行して動作を確認します。

---

## License

[MIT](LICENSE)
