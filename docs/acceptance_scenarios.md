# 受け入れ確認シナリオ

作成日: 2026-06-09  
最終更新: 2026-06-15  
対象: proofreading-app（temporary / approval 辞書フロー、production 起動モード）

---

## シナリオ 1: temporary 辞書の新規作成

**操作手順**
1. 辞書管理モーダルを開く（辞書管理ボタン）
2. 「新規辞書ファイル作成」セクションで種別 `temporary`、ファイル名（例: `project_a.csv`）を入力
3. 作成ボタンを押す

**期待結果**
- `data/dictionaries/temporary/project_a.csv` がヘッダー行のみで作成される
- ファイル一覧に `project_a.csv` が表示される
- 既存ファイルと同名で試みると 409 エラーが返る

**NG ケース**
- `../escape.csv` など `..` 含むファイル名 → バリデーションエラー
- 拡張子 `.csv` 以外 → バリデーションエラー

---

## シナリオ 2: 校正画面から temporary への登録

**操作手順**
1. 文書を開き、OCR テキスト上でテキストを選択して手動訂正ダイアログを開く
2. 訂正後の文字列を入力し確定する（元テキストと内容が変わること）
3. 表示される「temporary に登録」プロンプトで term・normalized・category・note を確認し「登録」

**期待結果**
- `user_manual_temporary.csv` に当該エントリが `approval_count=0`、`enabled=true` で追記される
- 登録成功メッセージが 1.5 秒後に消えダイアログが閉じる
- AI 解析辞書がリロードされ、次回校正から当該 term が候補に現れる

**スキップケース**
- 訂正前後のテキストが同一 → プロンプトは表示されない
- 空文字への削除 → プロンプトは表示されない

---

## シナリオ 3: temporary エントリの編集

**操作手順**
1. 辞書管理モーダル → temporary タブ → 対象エントリの行を選択し編集ボタン（または行クリック）
2. フィールドを変更して保存

**期待結果**
- 変更前の CSV がバックアップとして `archive/old_versions/` に保存される
- エントリが更新内容で上書きされる
- `approval_count` はリセットされない（編集では変化なし）

---

## シナリオ 4: 同一訂正の反復承認 → 昇格候補化

**操作手順**
1. シナリオ 2 の手順で、**同一 term** を合計 3 回以上登録する（別の文書・別ページで繰り返す）
2. 辞書管理モーダル → temporary タブを確認

**期待結果**
- 1 回目の登録: `approval_count=0`（新規エントリ）
- 2 回目の登録: 既存エントリが `enabled=true` に戻り `approval_count=1`
- 3 回目の登録: `approval_count=2`
- 4 回目の登録: `approval_count=3` → `is_promotion_candidate=true` となり **昇格候補バッジ** が表示される
- リスト上で昇格候補エントリが先頭にソートされる
- **この時点で approval への自動昇格は起きない**

**注意**
- `is_promotion_candidate` は `approval_count >= 3`（閾値 `PROMOTION_CANDIDATE_THRESHOLD = 3`）で立つ
- バッジのツールチップに「temporary 辞書上の注目表示。approval への昇格は ▲ 昇格ボタンから手動」と表示される

---

## シナリオ 5: temporary から approval への昇格

**操作手順**
1. 辞書管理モーダル → temporary タブ → 昇格対象エントリの「▲ 昇格」ボタンを押す
2. 昇格先の approval ファイルを選択する（例: `base.csv` または `入会研究.csv`）
3. 競合がある場合は上書き / スキップ を選択して確定

**期待結果（正常昇格）**
- 選択した approval ファイル（例: `base.csv`）に `source=promoted`、`approved=true` でエントリが追加される
- temporary から当該エントリが **物理削除** される
- AI 解析辞書がリロードされる

**競合ケース**
- `on_conflict=check`: 競合ありの場合は `status=conflict` が返り変更なし
- `on_conflict=overwrite`: approval を上書き、temporary から削除
- `on_conflict=skip`: approval をそのまま維持、temporary から削除

---

## シナリオ 6: approval 辞書の直接作成と追加

**操作手順**
1. 辞書管理モーダル → 「新規辞書ファイル作成」で種別 `approval`、ファイル名を入力して作成
   （例: 研究課題別なら `入会研究.csv`、基盤語彙なら `base.csv`）
2. approval タブで「エントリ追加」ボタンから term・normalized 等を入力して保存

**期待結果**
- `data/dictionaries/approved/` 以下に指定ファイルが作成される
- エントリが追記され AI 解析辞書にリロードされる

---

## シナリオ 7: protect=true を含む辞書ファイルの削除拒否

**操作手順**
1. 任意の temporary または approval ファイルに `protect=true` のエントリが存在する状態にする
2. そのファイルをファイル削除ボタンで削除しようとする

**期待結果**
- HTTP 409 エラー：`"protect=true のエントリが含まれるため削除できません: <filename>"`
- ファイルは削除されない

**追加保護**
- `user_manual_temporary.csv` は protect 設定に関わらず削除不可（`ValueError` 直接返却）

---

## シナリオ 8: 不要辞書ファイルの削除

**操作手順**
1. protect=true エントリがないことを確認
2. ファイル削除ボタンを押す

**期待結果**
- 削除前に `archive/old_versions/` へバックアップが作成される
- ファイルがディレクトリから削除される
- ファイル一覧から消える
- AI 解析辞書がリロードされる

---

## production モード（`./start.sh --prod`）受け入れ確認

追加日: 2026-06-15  
対応バージョン: v1.1.3 以降

### 前提

```bash
./start.sh --prod   # npm run build → uvicorn 起動（port 8000、--reload なし）
```

### チェックリスト

| # | 確認項目 | 期待結果 |
|---|---------|---------|
| 1 | `http://localhost:8000/` にアクセス | アプリの UI（React）が表示される |
| 2 | `/api/config` など既存 API | 200 が返り、従来通り動作する |
| 3 | `/docs` にアクセス | FastAPI Swagger UI が表示される |
| 4 | `/openapi.json` にアクセス | OpenAPI スキーマ JSON が返る |
| 5 | 存在しない `/api/nonexistent` | `{"detail":"Not Found"}` の JSON 404 が返る（SPA に飲み込まれない） |
| 6 | `http://localhost:8000/some-spa-route` など client-side route | `index.html` が返り、React ルーターが処理する |
| 7 | `/favicon.svg` または `/icons.svg` | SVG ファイルが正しく配信される（Content-Type: `image/svg+xml`） |
| 8 | `./start.sh --status` | 「frontend: dev server 未使用 (prod mode)」と表示される |
| 9 | `./start.sh --stop` 後の `./start.sh`（開発モード） | port 5176 で Vite dev server が起動し、開発モードに戻れる |

### 範囲外（現バージョン非対応）

- `0.0.0.0` バインドによる LAN / 外部公開
- systemd / Docker / nginx によるサーバーデプロイ
- HTTPS 対応
- 認証・アクセス制御

---

## シナリオ 9: 基本校合フロー（手動修正のみ・temporary 登録なし）

対象: 影印校エディタの最も基本的な操作フロー。

**操作手順**
1. 起動後、左サイドバーから対象文書を選択する
2. 史料画像と OCR テキストを対照表示で確認する
3. OCR テキスト上で誤認識箇所を選択 → 手動訂正ダイアログを開く
4. 正しい表記を入力して「確定」を押す
5. **temporary 登録プロンプトが表示されたら「スキップ」または「キャンセル」を選んで登録しない**
6. 保存する

**期待結果**
- 訂正内容が Markdown ファイルに反映・保存される
- temporary 辞書は変化しない（登録なし）
- 保存後もページ表示位置が維持される

**確認観点**
- 「今回だけの修正」として辞書化しない選択肢が明確に取れること
- temporary 登録プロンプトをスキップしても保存は正常に完了すること
- AI 解析を再実行したとき、今回の訂正は辞書候補には現れないこと（登録していないため）

---

## シナリオ 10: 辞書ファイルの rename（名前変更）

**前提**
- 変更対象ファイルに protect=true のエントリが含まれていても rename は可能（protect はファイル削除にのみ適用）

**操作手順**
1. 辞書管理モーダルを開く
2. ファイルフィルタで対象ファイルを選択する（例: `project_a.csv`）
3. 「名前変更」ボタンを押す
4. 新しいファイル名を入力（例: `入会研究2`）して確定する（`.csv` は自動付与）

**期待結果**
- `project_a.csv` → `入会研究2.csv` にファイルが変更される
- フィルタセレクトが `入会研究2.csv` に自動的に切り替わる
- 変更前ファイルの全エントリが `入会研究2.csv` に正しく引き継がれる
- 変更前ファイル名のバックアップが `archive/old_versions/` に作成される
- `user_manual_temporary.csv` は rename 操作できない（バックエンドが拒否）

**NG ケース**
- `../escape.csv` など `..` を含む新名称 → バリデーションエラー
- 同名ファイルが既に存在する → 409 エラー
- `.csv` 以外の拡張子を明示的に指定 → バリデーションエラー
