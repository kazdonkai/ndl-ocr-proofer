# plugin/bridge 変更 — 最短手順ガイド

> **入口ガイドです。** 詳細ルールは [../CLAUDE.md](../CLAUDE.md)、リリース手順は [RELEASE.md](RELEASE.md) を参照。

---

## Step 0: 発動条件の確認（5 秒で判断）

以下のいずれかを変更したら、このガイドの手順が必要です。

```
obsidian-plugin/main.ts         obsidian-plugin/resolver.ts
obsidian-plugin/src/**          obsidian-plugin/styles.css
obsidian-plugin/manifest.json   obsidian-plugin/package.json
obsidian-plugin/esbuild.config.mjs
backend/main.py（/api/bridge/* の変更）
frontend/src/App.jsx（bridge 連携の変更）
obsidian-plugin/README.md       README.md（plugin セクション）
```

**迷ったら実行する。** コストは 10 秒以内。

---

## Step 1: ローカル確認（コミット前に必ず通す）

```bash
cd obsidian-plugin && npm run release:check
```

期待出力（全項目 ✓）:

```
Plugin version check:
  manifest.json : 1.1.x
  package.json  : 1.1.x
  ✓ manifest.json == package.json
  ✓ versions.json has entry for 1.1.x
  ✓ CHANGELOG.md has entry for 1.1.x

All version checks passed.

Distribution artifact check:
  ✓ main.js           XX.X KB
  ✓ manifest.json     0.3 KB
  ✓ versions.json     0.1 KB
  ✓ styles.css        0.5 KB

All distribution artifacts present.
```

全 ✓ になるまでコミットしない。

---

## Step 2: コミット対象ファイル

plugin 関連変更を含むコミットには、以下を必ずセットで含める。

```bash
git add obsidian-plugin/main.js       # ビルド成果物
git add obsidian-plugin/manifest.json # バージョン定義 + 配付成果物
git add obsidian-plugin/versions.json # バージョン履歴
git add obsidian-plugin/styles.css    # 配付成果物（変更があれば）
git add obsidian-plugin/*.ts          # ソース変更分
git add obsidian-plugin/README.md     # 仕様変更を反映した場合
```

変更がないファイルは含めなくてよい。`main.js` は必ず含める（`release:check` がビルドするため常に更新される）。

### package-lock.json の扱い

| 状況 | 対応 |
|------|------|
| `package.json` の依存を変更した | `npm install` を再実行 → `package-lock.json` をコミット対象に含める |
| ソース変更のみで依存は変わっていない | `package-lock.json` の変更はコミット不要 |
| 初回セットアップ（lock ファイルが存在しない） | `npm install --package-lock-only` を実行してコミット |

---

## Step 3: CI が自動で行うこと

push / PR の対象ファイル変更が検出されると、GitHub Actions が以下を自動実行する。

| ステップ | 内容 |
|---------|------|
| [1/3] Build main.js | TypeScript → main.js ビルド |
| [2/3] Version consistency | manifest / package.json / versions.json / CHANGELOG の整合チェック |
| [3/3] Distribution artifacts | 配付 4 ファイルの存在・非空チェック |

CI は **ローカル `release:check` と同じ検査** を行う。ローカルで通過していれば CI も通る。

**CI は手動受け入れ確認（B1〜B7）の代替ではない。** 動作確認は人が行う。

---

## CI failure 対応表

| 失敗ステップ | まず見るべき場所 | よくある原因 |
|------------|----------------|------------|
| **[1/3] Build main.js** | TypeScript コンパイルエラーのログ | 型エラー / import パスミス / `obsidian` API の破壊的変更 |
| **[2/3] Version consistency** | `manifest.json` と `package.json` のバージョン欄 | バージョン更新漏れ / `versions.json` へのエントリ追加漏れ / CHANGELOG に `[X.Y.Z]` セクションなし |
| **[3/3] Distribution artifacts** | `obsidian-plugin/main.js` の存在確認 | `npm run build` を実行せずにコミット / `main.js` が `.gitignore` に入っている（確認: `git ls-files obsidian-plugin/main.js`） |

### 復旧の最短手順

```bash
cd obsidian-plugin

# [1/3] 失敗: TypeScript エラーを修正してから
npm run build

# [2/3] 失敗: バージョンを揃えてから
# manifest.json / package.json / versions.json を編集
# CHANGELOG.md に [X.Y.Z] セクションを追加
npm run check:version

# [3/3] 失敗: ビルド後に再チェック
npm run build && npm run check:dist

# 全部まとめて再確認
npm run release:check
```

---

## release 前だけ追加で行うこと

日常の変更とは別に、**バージョンを上げてリリースするとき** だけ追加で行う。

1. `manifest.json` / `package.json` / `versions.json` のバージョンを新バージョンに更新
2. `CHANGELOG.md` の `[Unreleased]` を `[X.Y.Z] — YYYY-MM-DD` に変更
3. `release:check` を通す
4. 手動受け入れ確認（B1〜B7）を実施 → [acceptance_scenarios.md](acceptance_scenarios.md)
5. コミット・タグ・push

詳細手順: [RELEASE.md](RELEASE.md)

---

## ドキュメント案内図

```
変更が plugin/bridge に影響するかわからない
    ↓
[CLAUDE.md] — 発動条件の完全一覧・完了条件ルール
    ↓
[このファイル] — 最短手順・CI failure 対応
    ↓
   ┌─────────────────────────────────┐
   │ 日常変更     │ release するとき │
   │ release:check │ [RELEASE.md]   │
   │ コミット      │ + 手動確認      │
   └─────────────────────────────────┘
        ↓ 手動確認が必要なとき
   [acceptance_scenarios.md] — B1〜B7 シナリオ
        ↓ CI で整合チェック
   [.github/workflows/plugin-check.yml] — 自動検査
```
