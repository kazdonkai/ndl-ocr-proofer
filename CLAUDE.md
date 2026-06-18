# proofreading-app — Claude 作業ルール

## プロジェクト概要

- 古典籍 OCR テキストの校正支援アプリ（macOS 専用）
- backend: FastAPI / frontend: React + Vite / plugin: Obsidian Bridge Plugin
- 起動: `./start.sh --prod`（production）/ `./start.sh`（dev）

---

## ドキュメント役割分担

| ドキュメント | 役割 |
|-------------|------|
| **CLAUDE.md**（本ファイル） | 日常開発での完了条件・発動条件の定義 |
| **docs/plugin-bridge-guide.md** | plugin/bridge 変更時の最短手順・CI failure 対応表 |
| **docs/RELEASE.md** | バージョンリリース時の手順書 |
| **docs/acceptance_scenarios.md** | 手動受け入れ確認の参照元（B シナリオ = plugin 確認） |
| **.github/workflows/plugin-check.yml** | push / PR の自動検査（整合・成果物チェック） |

---

## Obsidian Bridge Plugin — 完了条件ルール

`obsidian-plugin/` は **配付成果物を伴うサブパッケージ** であり、"実装を変えた" だけでは完了にならない。

### 完了条件（3 点セット）

| # | 必須 | 内容 |
|---|------|------|
| 1 | README 更新 | `obsidian-plugin/README.md` が現行仕様と一致していること |
| 2 | バージョン更新 | `manifest.json` / `package.json` / `versions.json` のバージョンが揃っていること |
| 3 | 配付 4 ファイル更新 | `main.js` / `manifest.json` / `versions.json` / `styles.css` が最新ビルドで揃っていること |

**完了前に必ず実行するコマンド:**

```bash
cd obsidian-plugin && npm run release:check
```

全項目 `✓` になるまで、その作業は完了とみなさない。  
push / PR 時は GitHub Actions でも同じ検査が自動実行される。

最短手順・CI failure 対応は **[docs/plugin-bridge-guide.md](docs/plugin-bridge-guide.md)** を参照。

---

### release:check が必須となる変更（発動条件）

以下のいずれかを変更した場合、作業完了前に `release:check` を通す。

#### ソースコード

- `obsidian-plugin/main.ts` / `resolver.ts` / `src/**`
- `obsidian-plugin/styles.css` / `manifest.json` / `package.json`
- `obsidian-plugin/esbuild.config.mjs` / `tsconfig.json`

#### API / 仕様

- backend `/api/bridge/*` の仕様変更
- frontend の bridge 連携仕様変更（`frontend/src/App.jsx`）
- 起動モード・Notice 文言・設定項目の追加・変更・削除

#### ドキュメント

- `obsidian-plugin/README.md` の仕様説明変更
- プロジェクト本体 `README.md` の plugin セクション変更
- `CHANGELOG.md`（バージョン整合チェックが参照する）

**迷った場合は安全側に倒して実行すること。**

---

### release:check が不要な変更

- plugin / bridge と無関係な OCR 辞書ロジックのみの変更
- plugin / bridge と無関係な UI 微修正（色、レイアウト、アイコンなど）
- plugin に言及しない docs 修正

---

## 作業報告テンプレート

plugin / bridge 関連変更を含む作業の完了報告に使う。

```
## 作業完了報告

### bridge plugin への影響
- この変更は bridge plugin に影響するか: [yes / no]

### ローカル確認（影響あり の場合のみ）
- 実行コマンド: cd obsidian-plugin && npm run release:check
- 実行結果: [pass / fail — 失敗内容を記載]
- 配付成果物（main.js / manifest.json / versions.json / styles.css）更新: [済 / 不要]
- obsidian-plugin/README.md 更新: [済 / 不要 / 要確認]
- プロジェクト本体 README 更新: [済 / 不要]

### 手動受け入れ確認
- 実施したか: [yes / no]
- yes の場合、確認済みシナリオ: [B1, B3 など]
- no の場合、実施しない理由: [ドキュメント変更のみ / CI のみで十分 / 別途実施予定 など]
```

---

## リリース手順

[docs/RELEASE.md](docs/RELEASE.md) を参照。  
plugin を含むリリースは必ず `release:check` をパスさせてから、手動受け入れ確認（B1〜B7）を実施してコミットする。

---

## Bridge Plugin 運用規約

1. `obsidian-plugin/` は配付成果物を伴うサブパッケージであり、通常の実装ファイルとは異なる完了条件が適用される。
2. plugin の機能・設定・API・動作に影響する変更は、実装・ドキュメント・配付成果物の 3 点セット完了をもって "変更完了" とする。
3. 完了確認には `cd obsidian-plugin && npm run release:check` を必ず実行し、全チェックが `✓` であることを確認する。
4. 発動条件に迷う場合は安全側に倒して `release:check` を実行する。
5. 日常開発の完了条件は本ファイル（CLAUDE.md）が定義する。リリース手順は `docs/RELEASE.md` に従う。
6. 手動受け入れ確認が必要な変更は `docs/acceptance_scenarios.md` の B シナリオ（B1〜B7）を確認する。
7. 実装変更・ドキュメント変更・配付成果物更新は同一コミットにまとめ、取りこぼしを防ぐ。

---

## バージョン方針

- plugin バージョン = proofreading-app 本体バージョン（常に同期）
- bridge API の変更は必ず本体リリースに含まれるため、独立バージョニングは行わない

---

## 主なコマンド

```bash
./start.sh --prod       # production 起動（推奨）
./start.sh              # dev 起動
./start.sh --stop       # 停止
./start.sh --status     # 状態確認

cd obsidian-plugin
npm run dev             # dev ビルド（Vault plugin dir に直接出力）
npm run build           # production ビルド（main.js を更新）
npm run release:check   # ビルド + バージョン整合 + 成果物確認（完了条件確認用）
```

### obsidian-plugin/package-lock.json の扱い

| 状況 | 対応 |
|------|------|
| `package.json` の依存を変更した | `npm install` を再実行 → `package-lock.json` をコミット対象に含める |
| ソース変更のみで依存は変わっていない | `package-lock.json` の変更はコミット不要 |
| lock ファイルが存在しない（初回） | `npm install --package-lock-only` を実行してコミット |

`package-lock.json` は `.gitignore` 対象外。CI の `npm ci` が参照するため、追跡・更新を維持すること。
