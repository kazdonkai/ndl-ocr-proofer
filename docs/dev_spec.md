# 現在仕様メモ（開発者向け）

作成日: 2026-06-09

---

## ディレクトリ構成（辞書関連）

```
data/dictionaries/
  temporary/           ← temporary 辞書 CSV（複数ファイル可）
    user_manual_temporary.csv   ← 基幹ファイル（削除・rename 不可）
  approved/            ← approval 辞書 CSV（複数ファイル可）
    base.csv           ← 研究課題非依存の基盤語彙（OCR 誤認識矯正を含む）
    入会研究.csv        ← ドメイン特化語彙の例（課題別に追加可）
  archive/
    old_versions/      ← 書き込み前バックアップ（自動）
```

---

## temporary 辞書 CSV カラム

| カラム | 型 | 説明 |
|-------|----|------|
| term | str | 元表記（検索キー） |
| normalized | str | 正規化表記 |
| variants | str | 異表記（`;` 区切り） |
| reading | str | 読み |
| category | str | カテゴリ（任意） |
| domain | str | ドメイン（任意） |
| priority | float | 優先度（0.0〜1.0、デフォルト 0.6） |
| protect | bool | true なら削除・ファイル削除不可 |
| source | str | 登録元（user-manual, promoted, 等） |
| approved | bool | 承認フラグ（現在は未使用の参照値） |
| enabled | bool | false なら辞書ロードから除外 |
| registered_at | ISO datetime | 初回登録日時 |
| last_seen_at | ISO datetime | 最終登録（再登録）日時 |
| note | str | メモ |
| approval_count | int | 再登録回数（初回登録時 0） |

---

## approval 辞書 CSV カラム（主要のみ）

| カラム | 型 | 説明 |
|-------|----|------|
| term | str | 元表記 |
| normalized | str | 正規化表記 |
| variants | str | 異表記 |
| reading | str | 読み |
| priority | float | 優先度（デフォルト 0.8） |
| protect | bool | true ならファイル削除不可 |
| source | str | 登録元（promoted の場合は "promoted"） |
| approved | bool | 常に true |

---

## 昇格候補の仕様

```
PROMOTION_CANDIDATE_THRESHOLD = 3  # backend/main.py:68
```

- `register()` が既存 term を見つけると `approval_count += 1`（初回登録時は 0）
- `is_promotion_candidate = (enabled and approval_count >= 3)` で算出（API レスポンス時のみ）
- **CSV には `is_promotion_candidate` カラムは存在しない**。毎回計算される
- 表示: DictionaryManager の temporary タブで昇格候補バッジ + リスト先頭ソート
- **自動昇格なし**。ユーザーが ▲ 昇格ボタンで手動実行

---

## 昇格（promote）の処理

`POST /api/dictionary/promote`

```json
{
  "source_file": "user_manual_temporary.csv",
  "term": "入会",
  "target_file": "my_approval.csv",
  "on_conflict": "check" | "overwrite" | "skip"
}
```

- 昇格成功・スキップ時は常に temporary から **物理削除**
- `on_conflict=check` のみ変更なしで競合情報を返す
- `source=promoted`、`approved=true` で approval に書き込み

---

## 削除保護の仕様

| 対象 | 保護条件 | エラー |
|------|---------|--------|
| ファイル（temporary） | `user_manual_temporary.csv` | 常に削除不可（ValueError） |
| ファイル（temporary/approval） | protect=true エントリ含む | HTTP 409 |
| エントリ（temporary） | なし（API で直接削除可） | - |
| エントリ（approval） | なし（API で直接削除可） | - |

---

## バックアップ

- `_write_rows_atomic()`: tempfile → `os.replace()` で原子的書き込み
- `backup()`: 書き込み前に `archive/old_versions/<filename>.<timestamp>.bak` へコピー
- 全 approval ファイル一括バックアップ: `POST /api/dictionary/backup`

---

## API エンドポイント一覧（辞書関連）

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/dictionary/temporary` | 全 temporary エントリ取得 |
| POST | `/api/dictionary/temporary` | temporary エントリ登録 |
| PATCH | `/api/dictionary/temporary/{term}` | enabled トグル |
| PUT | `/api/dictionary/temporary/{filename}/{term}` | エントリ部分更新 |
| DELETE | `/api/dictionary/temporary/{filename}/{term}` | エントリ物理削除 |
| GET | `/api/dictionary/entries` | 全 approval エントリ取得 |
| POST | `/api/dictionary/entries` | approval エントリ追加 |
| PUT | `/api/dictionary/entries/{filename}/{term}` | approval エントリ更新 |
| DELETE | `/api/dictionary/entries/{filename}/{term}` | approval エントリ削除 |
| POST | `/api/dictionary/promote` | temporary → approval 昇格 |
| POST | `/api/dictionary/files` | 辞書ファイル新規作成 |
| DELETE | `/api/dictionary/files/{dict_type}/{filename}` | 辞書ファイル削除 |
| PATCH | `/api/dictionary/files/{dict_type}/{filename}` | 辞書ファイル名変更（body: `{"new_filename": "新名称.csv"}`） |
| POST | `/api/dictionary/backup` | approval 全ファイルバックアップ |

---

## 既知の制約・未自動化の点

1. **昇格候補の自動昇格なし**: `approval_count >= 3` はバッジ表示のトリガーのみ。approval 移行は手動
2. **stale エントリの自動削除なし**: `last_seen_at` が 180 日以上前のエントリは `is_stale=true` になるが自動削除・自動無効化はしない
3. **temporary の登録先は `user_manual_temporary.csv` 固定**: 校正画面からの登録は常にデフォルトファイルへ。別ファイルへの直接登録は辞書管理モーダルから行う
4. **on_conflict の UI**: 昇格ボタン押下時の競合解決 UI が存在する前提だが、実装詳細は DictionaryManager.jsx 側に委ねる
5. **ファイル名制約**: `^[^/\\\.][^/\\]*\.csv$`（`..` 禁止、`.csv` 必須、ディレクトリ区切り禁止）
6. **approval の `approved` フラグ**: 常に `true` で登録されるが、現在はロード時の参照値として使われていない（将来の検証用）
7. **rename の保護制約**: `user_manual_temporary.csv` は rename 不可（バックエンドが `ValueError` を返す）。それ以外のファイルは protect=true エントリを含む場合でも rename は可能（protect はファイル削除のみに適用）。
