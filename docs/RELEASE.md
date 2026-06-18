# リリース手順

作成日: 2026-06-17  
対象: proofreading-app + Obsidian Bridge Plugin の同期リリース

> **このドキュメントがリリース時の唯一の参照先です。**  
> 他のドキュメント（obsidian-plugin/README.md 等）に分散した手順は参考情報です。
>
> **CI について:** GitHub Actions（`plugin-check.yml`）は整合・成果物の自動検査のみを行う。  
> 手動受け入れ確認（B1〜B7）の代替にはならない。リリース前に必ず Step 4 を実施すること。

---

## 方針

- proofreading-app 本体と Obsidian Bridge Plugin は **同じバージョン番号** でリリースする
- bridge API（`/api/bridge/open`）の変更は必ず本体リリースに含まれるため、バージョンを分離しない
- 配付成果物（`main.js` / `manifest.json` / `versions.json` / `styles.css`）は `obsidian-plugin/` に置き、`git` で追跡する

---

## チェックリスト

リリース時はこのチェックリストを上から順に実行してください。

### Step 1: バージョンを決める

- [ ] 新しいバージョン番号を決定する（例: `1.1.4`）
  - patch: バグ修正・軽微なドキュメント更新
  - minor: 新機能追加（後方互換あり）
  - major: 後方互換のない変更

### Step 2: ファイルを更新する

以下のファイルを **すべて同じバージョン番号** に更新する。

- [ ] `obsidian-plugin/manifest.json` — `"version"` フィールドを更新
- [ ] `obsidian-plugin/package.json` — `"version"` フィールドを更新
- [ ] `obsidian-plugin/versions.json` — 新バージョンのエントリを追加

  ```json
  {
    "0.1.0": "1.5.7",
    "1.1.3": "1.5.7",
    "1.1.4": "1.5.7"   ← 追加（minAppVersion は通常変更しない）
  }
  ```

- [ ] `CHANGELOG.md` — `[Unreleased]` セクションを `[X.Y.Z] — YYYY-MM-DD` に変更し、次の `[Unreleased]` セクションを追加する

### Step 3: ビルドと整合チェック

```bash
cd obsidian-plugin
npm run release:check
```

このコマンド 1 本で以下を実行する:

1. `npm run build` — `main.js` をビルド
2. `check:version` — manifest / package.json / versions.json / CHANGELOG の整合チェック
3. `check:dist` — 配付成果物 4 ファイルの存在・非空チェック

**すべて `✓` になることを確認してください。**  
失敗した場合は [よくある失敗パターン](#よくある失敗パターン) を参照してください。

期待出力:

```
Plugin version check:
  manifest.json : 1.1.4
  package.json  : 1.1.4
  ✓ manifest.json == package.json
  ✓ versions.json has entry for 1.1.4 (minAppVersion: 1.5.7)
  ✓ CHANGELOG.md has entry for 1.1.4

All version checks passed.

Distribution artifact check:
  ✓ main.js          XX.X KB
  ✓ manifest.json    0.3 KB
  ✓ versions.json    0.1 KB
  ✓ styles.css       0.5 KB

All distribution artifacts present.
```

### Step 4: 手動受け入れ確認

#### 4-1. アプリ本体（production モード）

```bash
./start.sh --prod
```

`http://localhost:8000` で以下を確認する:

| # | 確認項目 | 期待結果 |
|---|---------|---------|
| A1 | アプリが表示される | React UI が `http://localhost:8000/` で表示される |
| A2 | 文書を開けること | サイドバーからノートを選択でき、OCR テキストが表示される |
| A3 | 保存できること | 校正後に保存し、ファイルに反映される |
| A4 | `./start.sh --status` | `prod` モードと表示される |

詳細なシナリオは [acceptance_scenarios.md](acceptance_scenarios.md) を参照。

#### 4-2. Obsidian Bridge Plugin

まず plugin ファイルを更新する:

```bash
# Vault の plugin ディレクトリに成果物をコピー（パスは環境に合わせて変更）
VAULT_PLUGIN="<Vault>/.obsidian/plugins/ocr-proofer"
cp obsidian-plugin/main.js      "$VAULT_PLUGIN/"
cp obsidian-plugin/manifest.json "$VAULT_PLUGIN/"
cp obsidian-plugin/styles.css   "$VAULT_PLUGIN/"
```

次に Obsidian でプラグインを **OFF → ON** する:
> 設定 → コミュニティプラグイン → OCR Proofer Bridge → トグルを OFF にしてから ON

以下を順番に確認する:

| # | 確認項目 | 操作 | 期待結果 |
|---|---------|------|---------|
| B1 | prod モード起動確認 | `./start.sh --prod` 起動後にブリッジ操作 | `http://localhost:8000/?note=...` が開く |
| B2 | reuse-existing: 初回（タブなし） | 影印校エディタを閉じた状態で「Open in OCR Proofer」 | 新しいブラウザタブが開く |
| B3 | reuse-existing: 既存タブあり | タブが開いている状態で **別のノート** を「Open in OCR Proofer」 | **既存タブ**でノートが切り替わる（新タブは開かない） |
| B4 | always-new: 毎回新タブ | 設定を `always-new` に変更して「Open in OCR Proofer」 | 毎回新しいタブが開く |
| B5 | same-note 重複防止 | 開いているノートと **同じノート** を再度「Open in OCR Proofer」 | エラー・クラッシュなしで動作する |
| B6 | サーバー停止時の fallback | `./start.sh --stop` 後に「Open in OCR Proofer」 | 新タブを開こうとし、接続エラーの Notice が出る |
| B7 | plugin OFF/ON 後の動作確認 | Obsidian でプラグインを OFF → ON して再度操作 | 正常に動作する（設定が引き継がれる） |

**B3 が最重要確認です。** SSE bridge の `delivered: true` パスが機能していることを確認してください。

### Step 5: コミットとタグ

```bash
git add obsidian-plugin/manifest.json \
        obsidian-plugin/package.json \
        obsidian-plugin/versions.json \
        obsidian-plugin/main.js \
        CHANGELOG.md
git commit -m "release: v1.1.4"
git tag v1.1.4
git push origin main --tags
```

### Step 6: GitHub Release（オプション）

GitHub Release を作成する場合:

1. Releases ページで「Draft a new release」→ タグ `v1.1.4` を選択
2. Release title: `v1.1.4`
3. Body: `CHANGELOG.md` の該当バージョンのセクションをコピー
4. Attach files（手動でアップロード）:
   - `obsidian-plugin/main.js`
   - `obsidian-plugin/manifest.json`
   - `obsidian-plugin/versions.json`
   - `obsidian-plugin/styles.css`

---

## よくある失敗パターン

| 症状 | 原因 | 対処 |
|------|------|------|
| `check:version` で MISMATCH | manifest.json と package.json のバージョンが揃っていない | 両方を同じバージョンに更新 |
| `check:version` で versions.json エラー | 新バージョンのエントリを追加し忘れた | `versions.json` に追加 |
| `check:version` で CHANGELOG エラー | CHANGELOG.md に `[X.Y.Z]` セクションがない | `[Unreleased]` を `[X.Y.Z] — YYYY-MM-DD` に変更 |
| `check:dist` で main.js MISSING | `npm run build` が完了していない | `obsidian-plugin/` で `npm run build` を実行 |
| B3 でノートが切り替わらない | 影印校エディタのタブが SSE 接続していない | タブを手動で `http://localhost:8000` に開いてから再試行 |
| B7 でプラグインが正常動作しない | Obsidian が古い `main.js` をキャッシュしている | OFF → ON を再度実行。それでも直らない場合は Obsidian を再起動 |

---

## 参照

- [obsidian-plugin/README.md](../obsidian-plugin/README.md) — プラグインの詳細仕様・設定リファレンス
- [docs/acceptance_scenarios.md](acceptance_scenarios.md) — アプリ本体の詳細受け入れシナリオ
- [CHANGELOG.md](../CHANGELOG.md) — 変更履歴
