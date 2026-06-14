#!/usr/bin/env bash
# ============================================================
#  start.sh — proofreading-app 起動スクリプト
#  使い方:
#    ./start.sh          # バックエンド + フロントエンドを同時起動（開発モード）
#                        #   backend: uvicorn --reload  port 8000
#                        #   frontend: Vite dev server  port 5176
#    ./start.sh --prod   # production モード起動
#                        #   frontend を npm run build でビルドし、
#                        #   FastAPI（port 8000）から静的配信する。
#                        #   Vite dev server は起動しない。
#    ./start.sh --stop   # 起動中のプロセスを停止
#    ./start.sh --status # 起動状態を確認
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

BACKEND_PORT=8000
FRONTEND_PORT=5176

BACKEND_LOG="$SCRIPT_DIR/logs/backend.log"
FRONTEND_LOG="$SCRIPT_DIR/logs/frontend.log"
PID_FILE="$SCRIPT_DIR/logs/app.pid"
MODE_FILE="$SCRIPT_DIR/logs/app.mode"

# ── カラー出力 ────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }
log_step()  { echo -e "${CYAN}[>>>>]${NC}  $*"; }

# ── 依存確認 ─────────────────────────────────────────────────
check_deps() {
  local ok=true
  command -v python3  >/dev/null 2>&1 || { log_error "python3 が見つかりません"; ok=false; }
  command -v npm      >/dev/null 2>&1 || { log_error "npm が見つかりません"; ok=false; }
  $ok || exit 1
}

# ── ポート使用中チェック ──────────────────────────────────────
port_in_use() { lsof -ti :"$1" >/dev/null 2>&1; }

# ── --status ─────────────────────────────────────────────────
cmd_status() {
  echo ""
  local mode=""
  [[ -f "$MODE_FILE" ]] && mode=$(cat "$MODE_FILE")

  if port_in_use "$BACKEND_PORT"; then
    log_info "バックエンド  : 起動中 (port $BACKEND_PORT)"
  else
    log_warn "バックエンド  : 停止中"
  fi

  if [[ "$mode" == "prod" ]]; then
    log_info "フロントエンド: dev server 未使用 (prod mode) → http://localhost:$BACKEND_PORT"
  elif port_in_use "$FRONTEND_PORT"; then
    log_info "フロントエンド: 起動中 → http://localhost:$FRONTEND_PORT"
  else
    log_warn "フロントエンド: 停止中"
  fi
  echo ""
}

# ── --stop ───────────────────────────────────────────────────
cmd_stop() {
  log_step "プロセスを停止します…"

  if [[ -f "$PID_FILE" ]]; then
    while IFS= read -r pid; do
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" && log_info "PID $pid を停止しました"
      fi
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  fi

  # ポートで残ったプロセスも念のため終了（複数 PID に対応）
  for port in $BACKEND_PORT $FRONTEND_PORT; do
    while IFS= read -r pid; do
      [[ -n "$pid" ]] || continue
      kill "$pid" 2>/dev/null && log_info "port $port のプロセス (PID $pid) を停止しました"
    done < <(lsof -ti :"$port" 2>/dev/null)
  done

  log_info "停止完了"
}

# ── 起動 ─────────────────────────────────────────────────────
cmd_start() {
  check_deps

  # logs ディレクトリ作成
  mkdir -p "$SCRIPT_DIR/logs"
  > "$PID_FILE"
  echo "dev" > "$MODE_FILE"

  echo ""
  log_step "proofreading-app を起動します"
  echo "  プロジェクト : $SCRIPT_DIR"
  echo ""

  # ── バックエンド ──────────────────────────────────────────
  if port_in_use "$BACKEND_PORT"; then
    log_warn "バックエンド port $BACKEND_PORT はすでに使用中です（スキップ）"
  else
    log_step "バックエンド起動中… (port $BACKEND_PORT)"
    (
      cd "$BACKEND_DIR"
      python3 -m uvicorn main:app --reload --host 127.0.0.1 --port "$BACKEND_PORT" \
        >> "$BACKEND_LOG" 2>&1
    ) &
    BACKEND_PID=$!
    echo "$BACKEND_PID" >> "$PID_FILE"

    # 起動待機（最大10秒）
    local attempts=0
    while ! port_in_use "$BACKEND_PORT"; do
      sleep 0.5
      attempts=$((attempts + 1))
      if [[ $attempts -ge 20 ]]; then
        log_error "バックエンドの起動がタイムアウトしました"
        log_error "ログを確認してください: $BACKEND_LOG"
        exit 1
      fi
    done
    log_info "バックエンド起動完了 (PID $BACKEND_PID)"
  fi

  # ── フロントエンド ────────────────────────────────────────
  if port_in_use "$FRONTEND_PORT"; then
    log_warn "フロントエンド port $FRONTEND_PORT はすでに使用中です（スキップ）"
  else
    log_step "フロントエンド起動中… (port $FRONTEND_PORT)"
    (
      cd "$FRONTEND_DIR"
      npm run dev >> "$FRONTEND_LOG" 2>&1
    ) &
    FRONTEND_PID=$!
    echo "$FRONTEND_PID" >> "$PID_FILE"

    # 起動待機（最大15秒）
    local attempts=0
    while ! port_in_use "$FRONTEND_PORT"; do
      sleep 0.5
      attempts=$((attempts + 1))
      if [[ $attempts -ge 30 ]]; then
        log_error "フロントエンドの起動がタイムアウトしました"
        log_error "ログを確認してください: $FRONTEND_LOG"
        exit 1
      fi
    done
    log_info "フロントエンド起動完了 (PID $FRONTEND_PID)"
  fi

  # ── 完了メッセージ ────────────────────────────────────────
  echo ""
  echo -e "  ${GREEN}✓ 起動完了${NC}"
  echo -e "  アプリ URL  : ${CYAN}http://localhost:$FRONTEND_PORT${NC}"
  echo -e "  API URL     : http://localhost:$BACKEND_PORT"
  echo -e "  ログ        : $SCRIPT_DIR/logs/"
  echo ""
  echo -e "  停止するには: ${YELLOW}./start.sh --stop${NC}"
  echo "  または Ctrl+C（このターミナルを使い続ける場合）"
  echo ""
}

# ── production 起動 ──────────────────────────────────────────
cmd_prod() {
  check_deps

  mkdir -p "$SCRIPT_DIR/logs"
  > "$PID_FILE"
  echo "prod" > "$MODE_FILE"

  echo ""
  log_step "proofreading-app を production モードで起動します"
  echo "  プロジェクト : $SCRIPT_DIR"
  echo ""

  # ── フロントエンドビルド ──────────────────────────────────
  log_step "フロントエンドをビルド中… (npm run build)"
  if ! (cd "$FRONTEND_DIR" && npm run build >> "$FRONTEND_LOG" 2>&1); then
    log_error "npm run build に失敗しました"
    log_error "ログを確認してください: $FRONTEND_LOG"
    exit 1
  fi

  if [[ ! -f "$FRONTEND_DIR/dist/index.html" ]]; then
    log_error "frontend/dist/index.html が見つかりません。ビルドが正常に完了しなかった可能性があります。"
    log_error "ログを確認してください: $FRONTEND_LOG"
    exit 1
  fi
  log_info "ビルド完了 → frontend/dist/"

  # ── バックエンド（production モード） ─────────────────────
  if port_in_use "$BACKEND_PORT"; then
    log_warn "バックエンド port $BACKEND_PORT はすでに使用中です（スキップ）"
  else
    log_step "バックエンド起動中… (production, --reload なし, port $BACKEND_PORT)"
    (
      cd "$BACKEND_DIR"
      SERVE_FRONTEND=true python3 -m uvicorn main:app \
        --host 127.0.0.1 --port "$BACKEND_PORT" >> "$BACKEND_LOG" 2>&1
    ) &
    BACKEND_PID=$!
    echo "$BACKEND_PID" >> "$PID_FILE"

    local attempts=0
    while ! port_in_use "$BACKEND_PORT"; do
      sleep 0.5
      attempts=$((attempts + 1))
      if [[ $attempts -ge 20 ]]; then
        log_error "バックエンドの起動がタイムアウトしました"
        log_error "ログを確認してください: $BACKEND_LOG"
        exit 1
      fi
    done
    log_info "バックエンド起動完了 (PID $BACKEND_PID)"
  fi

  # ── 完了メッセージ ────────────────────────────────────────
  echo ""
  echo -e "  ${GREEN}✓ production 起動完了${NC}"
  echo -e "  アプリ URL  : ${CYAN}http://localhost:$BACKEND_PORT${NC}"
  echo -e "  API URL     : http://localhost:$BACKEND_PORT/api"
  echo -e "  ログ        : $SCRIPT_DIR/logs/"
  echo ""
  echo -e "  停止するには: ${YELLOW}./start.sh --stop${NC}"
  echo ""
}

# ── メイン ───────────────────────────────────────────────────
case "${1:-}" in
  --stop)   cmd_stop   ;;
  --status) cmd_status ;;
  --prod)   cmd_prod   ;;
  *)        cmd_start  ;;
esac
