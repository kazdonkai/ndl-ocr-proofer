#!/usr/bin/env bash
# check_patch_callers.sh — 旧 PATCH API / 旧フロントエンド関数の参照確認スクリプト
#
# 目的:
#   Phase 4B（旧 PATCH API 削除）着手前に、以下の参照が本当にゼロであることを確認する。
#   - backend  : PATCH /api/settings/ocr, PATCH /api/settings/dictionary
#   - frontend : updateOcrSettings(), updateDictionarySettings()
#   - obsidian-plugin: 上記 API エンドポイントへの直接参照
#   - docs / scratch : 参照記述（情報収集のみ、削除判断はしない）
#
# 使い方:
#   cd proofreading-app
#   bash scripts/check_patch_callers.sh
#
# 出力:
#   各ターゲットごとに "FOUND" / "NOT FOUND" を表示。
#   FOUND がある場合は Phase 4B 着手前に要確認。
#
# CI 組み込み: 現時点では手動確認用。Phase 4B 承認後に CI に追加予定。
#
# 最終更新: 2026-05-26（Phase 4A 準備アーティファクト）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# 色出力（tty のみ）
if [ -t 1 ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; RESET=''
fi

found_count=0

check() {
  local label="$1"
  local pattern="$2"
  local dirs=("${@:3}")

  echo ""
  echo "──────────────────────────────────────────"
  echo "CHECK: ${label}"
  echo "  pattern: ${pattern}"
  echo "  target : ${dirs[*]}"
  echo "──────────────────────────────────────────"

  local results
  results=$(grep -rn --include="*.py" --include="*.js" --include="*.jsx" --include="*.ts" \
                      --include="*.tsx" --include="*.md" \
                      "${pattern}" "${dirs[@]}" 2>/dev/null || true)

  if [ -z "$results" ]; then
    echo -e "${GREEN}  NOT FOUND — OK${RESET}"
  else
    echo -e "${RED}  FOUND — 要確認:${RESET}"
    echo "$results" | sed 's/^/    /'
    found_count=$((found_count + 1))
  fi
}

# ── 検索対象ディレクトリ ──────────────────────────────
BACKEND="${PROJECT_ROOT}/backend"
FRONTEND="${PROJECT_ROOT}/frontend"
PLUGIN="${PROJECT_ROOT}/obsidian-plugin"
DOCS="${PROJECT_ROOT}"

echo "=========================================="
echo "  check_patch_callers.sh"
echo "  実行日時: $(date '+%Y-%m-%d %H:%M:%S')"
echo "  プロジェクトルート: ${PROJECT_ROOT}"
echo "=========================================="

# ── [1] backend: PATCH /api/settings/ocr エンドポイント定義 ──
check \
  "backend: PATCH /api/settings/ocr エンドポイント定義" \
  '@app\.patch.*["\x27]/api/settings/ocr' \
  "${BACKEND}"

# ── [2] backend: PATCH /api/settings/dictionary エンドポイント定義 ──
check \
  "backend: PATCH /api/settings/dictionary エンドポイント定義" \
  '@app\.patch.*["\x27]/api/settings/dictionary' \
  "${BACKEND}"

# ── [3] frontend: updateOcrSettings 呼び出し（関数定義・export 行を除く） ──
#    documentService.js の関数定義行は Phase 4B で削除予定 → 実際の call site のみ確認
echo ""
echo "──────────────────────────────────────────"
echo "CHECK: frontend: updateOcrSettings 実呼び出し（定義行除く）"
echo "  pattern: updateOcrSettings( (ただし function/export 行を除外)"
echo "  target : ${FRONTEND}"
echo "──────────────────────────────────────────"
results3=$(grep -rn --include="*.js" --include="*.jsx" \
  'updateOcrSettings\s*(' \
  "${FRONTEND}" 2>/dev/null \
  | grep -v '^\s*//\|export async function\|export function\|async function updateOcr' \
  || true)
if [ -z "$results3" ]; then
  echo -e "${GREEN}  NOT FOUND — OK（実呼び出しゼロ）${RESET}"
else
  echo -e "${RED}  FOUND — 要確認:${RESET}"
  echo "$results3" | sed 's/^/    /'
  found_count=$((found_count + 1))
fi

# ── [4] frontend: updateDictionarySettings 呼び出し（関数定義・export 行を除く） ──
echo ""
echo "──────────────────────────────────────────"
echo "CHECK: frontend: updateDictionarySettings 実呼び出し（定義行除く）"
echo "  pattern: updateDictionarySettings( (ただし function/export 行を除外)"
echo "  target : ${FRONTEND}"
echo "──────────────────────────────────────────"
results4=$(grep -rn --include="*.js" --include="*.jsx" \
  'updateDictionarySettings\s*(' \
  "${FRONTEND}" 2>/dev/null \
  | grep -v '^\s*//\|export async function\|export function\|async function updateDictionary' \
  || true)
if [ -z "$results4" ]; then
  echo -e "${GREEN}  NOT FOUND — OK（実呼び出しゼロ）${RESET}"
else
  echo -e "${RED}  FOUND — 要確認:${RESET}"
  echo "$results4" | sed 's/^/    /'
  found_count=$((found_count + 1))
fi

# ── [5] obsidian-plugin: /api/settings/ocr または /api/settings/dictionary 参照 ──
check \
  "obsidian-plugin: /api/settings/ocr or /api/settings/dictionary 参照" \
  '/api/settings/\(ocr\|dictionary\)' \
  "${PLUGIN}"

# ── [6] docs / scratch: /api/settings/ocr or /api/settings/dictionary の記述 ──
#    （情報収集のみ — "FOUND" でも削除判断はしない）
echo ""
echo "══════════════════════════════════════════"
echo "INFO: docs/scratch 内の参照（削除判断対象外）"
echo "══════════════════════════════════════════"
echo ""
echo "  pattern: /api/settings/ocr|/api/settings/dictionary"
echo "  対象   : scratch/ README.md SETUP_MANUAL.md CHANGELOG.md"
grep -rn --include="*.md" \
  '/api/settings/ocr\|/api/settings/dictionary' \
  "${PROJECT_ROOT}/scratch" \
  "${PROJECT_ROOT}/README.md" \
  "${PROJECT_ROOT}/SETUP_MANUAL.md" \
  "${PROJECT_ROOT}/CHANGELOG.md" \
  2>/dev/null | sed 's/^/    /' || echo "    (なし)"

# ── 結果サマリー ──────────────────────────────────────
echo ""
echo "=========================================="
echo "  サマリー"
echo "=========================================="
if [ "$found_count" -eq 0 ]; then
  echo -e "${GREEN}  ✅ 全チェック PASS（実呼び出しゼロ）${RESET}"
  echo "  → Phase 4B 着手条件（コード参照ゼロ）を満たしています。"
  echo "  → ただし2週間のアクセスログ観測も併せて確認してください。"
else
  echo -e "${RED}  ❌ ${found_count} 件のチェックで参照が残存しています。${RESET}"
  echo "  → 上記の FOUND 箇所を確認・対処してから Phase 4B に進んでください。"
fi
echo "=========================================="
