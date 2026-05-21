# Settings Schema Note

> 凍結日: 2026-05-21  
> 対象ファイル: `frontend/src/settings.js`  
> localStorage key: `ocr_app_settings`

---

## display

| key | デフォルト | UI | Obsidian plugin 対応予定 |
|---|---|---|---|
| `display.fontSize` | `1.3` (rem) | Settings サイドバー › フォントサイズスライダー | `PluginSettingTab` › Font size |
| `display.lineHeight` | `1.8` | Settings サイドバー › 行間スライダー | `PluginSettingTab` › Line height |
| `display.viewMode` | `'paged'` | Settings サイドバー › ページ別 / シームレス トグル | `PluginSettingTab` › View mode (paged / seamless) |

## vault

| key | デフォルト | UI | Obsidian plugin 対応予定 |
|---|---|---|---|
| `vault.showNotificationOnRescan` | `true` | Settings サイドバー › VAULT › Rescan 完了通知チェックボックス | `PluginSettingTab` › 通知オン/オフ（`Notice` API） |

## panel

| key | デフォルト | UI | Obsidian plugin 対応予定 |
|---|---|---|---|
| `panel.openOnStartup` | `false` | Settings サイドバー › VAULT FILES パネル › 起動時に開く | `PluginSettingTab` › Leaf auto-open on `onload` |
| `panel.autoCloseAfterSelect` | `true` | Settings サイドバー › ファイル選択後に自動で閉じる | `PluginSettingTab` › Leaf auto-collapse |
| `panel.initialWidth` | `280` (px) | Settings サイドバー › パネル幅スライダー | `PluginSettingTab` › Sidebar leaf width |

## import

| key | デフォルト | UI | Obsidian plugin 対応予定 |
|---|---|---|---|
| `import.defaultBehavior` | `'replace'` | Settings サイドバー › インポート › 上書き / 追記ラジオ | `PluginSettingTab` › Default import behavior |

## document

| key | デフォルト | UI | Obsidian plugin 対応予定 |
|---|---|---|---|
| `document.statusPropertyName` | `'minji_status'` | Settings サイドバー › DOCUMENT STATUS › テキスト入力 | `PluginSettingTab` › Frontmatter key name |
| `document.completionStatusValue` | `5` | Settings サイドバー › Completion status value スライダー | `PluginSettingTab` › 完了値（`fileManager.processFrontMatter`） |
| `document.statusOptions` | `[1,2,3,4,5]` | UI 未露出（内部専用） | plugin 側では dropdown 候補として使用予定 |

---

## 移植メモ

- `loadSettings()` → Obsidian `this.loadData()`
- `saveSettings()` → Obsidian `this.saveData()`
- `deepMerge` は plugin 側でも同じロジックを使うか、`Object.assign` ベースに簡略化可
- `historyLimit` と `keybindings` は現在 settings.js 外（`useKeybindings` フック管理）。plugin 化時は統合を検討

---

## 凍結宣言

この時点以降、新しい設定項目の追加は原則行わない。  
次フェーズは OCR 補正ロジック（DANGEROUS_CANDIDATE_VIS_MODE / 辞書ティア分離 / user_action ログ）の実装に集中する。
