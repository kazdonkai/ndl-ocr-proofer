"""temporary辞書 (user_manual_temporary.csv) の読み書き管理モジュール。

Phase M-1: 最小データ経路
  - enabled=true エントリのみ loader へ渡す
  - ユーザー手動登録 (source="user-manual") と将来の seed 投入を provenance で区別
  - 物理削除は実装しない（enabled=false で論理無効化のみ）
  - last_seen_at は 180 日以上前を「長期未使用」と定義（cleanup UI は後続フェーズ）

内部識別子 (tier="experimental" 等) は変更しないため、
観測フィールド rank1_from_experimental_dict / aggregate_experimental.py への影響なし。
"""

import csv
import datetime
from pathlib import Path
from typing import List, Optional

# CSV カラム定義（順序保持）
TEMP_CSV_COLUMNS: List[str] = [
    "term",          # OCR 誤字など（疑義表記）
    "normalized",    # 正規化形（正しい表記）
    "variants",      # セミコロン区切りの表記揺れ
    "reading",       # 読み仮名
    "category",      # 語彙カテゴリ（法制語 / 地名 / 人名 等）
    "domain",        # 専門領域
    "priority",      # 候補スコア重み (0.0–1.0)
    "protect",       # 保護フラグ (true/false)
    "source",        # provenance: "user-manual" | "seed"
    "approved",      # 承認済みフラグ（temporary は常に false）
    "enabled",       # 有効フラグ (true/false) — loader は true のみ読む
    "registered_at", # 初回登録日時 (ISO 8601 UTC)
    "last_seen_at",  # 最終参照/更新日時 (ISO 8601 UTC)
    "note",          # 任意メモ
]

# 長期未使用の閾値（日数）
UNUSED_THRESHOLD_DAYS = 180

_TRUE_VALUES = {"true", "1", "t", "yes", "y"}


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _parse_bool(value: str, default: bool = False) -> bool:
    v = value.strip().lower()
    if v in _TRUE_VALUES:
        return True
    if v in {"false", "0", "f", "no", "n"}:
        return False
    return default


class TemporaryDictManager:
    """user_manual_temporary.csv の CRUD を担当する。

    Args:
        csv_path: CSV ファイルの絶対パス。存在しない場合はヘッダーのみ作成する。
    """

    def __init__(self, csv_path: str) -> None:
        self.csv_path = Path(csv_path)
        self.csv_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_header()

    # ── 内部ユーティリティ ────────────────────────────────────────────────────

    def _ensure_header(self) -> None:
        """CSV が存在しない、またはヘッダーのみの場合にヘッダーを書き込む。"""
        if not self.csv_path.exists():
            with open(self.csv_path, "w", encoding="utf-8", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=TEMP_CSV_COLUMNS)
                writer.writeheader()

    def _read_rows(self) -> List[dict]:
        """全行を dict のリストとして返す（enabled 問わず）。"""
        rows: List[dict] = []
        with open(self.csv_path, "r", encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                rows.append(dict(row))
        return rows

    def _write_rows(self, rows: List[dict]) -> None:
        """全行を上書き保存する（ヘッダー再書き込み含む）。"""
        with open(self.csv_path, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=TEMP_CSV_COLUMNS)
            writer.writeheader()
            writer.writerows(rows)

    @staticmethod
    def _is_enabled(row: dict) -> bool:
        return _parse_bool(row.get("enabled", "false"), default=False)

    # ── 読み取り API ─────────────────────────────────────────────────────────

    def read_all(self) -> List[dict]:
        """全エントリを返す（enabled 問わず）。GET API 用。"""
        return self._read_rows()

    def read_enabled(self) -> List[dict]:
        """enabled=true のエントリのみ返す。dictionary_loader 用。"""
        return [r for r in self._read_rows() if self._is_enabled(r)]

    def is_stale(self, row: dict) -> bool:
        """last_seen_at が UNUSED_THRESHOLD_DAYS 以上前なら True（cleanup 判定用）。"""
        raw = row.get("last_seen_at", "").strip()
        if not raw:
            return False
        try:
            last = datetime.datetime.fromisoformat(raw)
            if last.tzinfo is None:
                last = last.replace(tzinfo=datetime.timezone.utc)
            delta = datetime.datetime.now(datetime.timezone.utc) - last
            return delta.days >= UNUSED_THRESHOLD_DAYS
        except ValueError:
            return False

    # ── 書き込み API ─────────────────────────────────────────────────────────

    def register(
        self,
        term: str,
        normalized: str,
        *,
        variants: str = "",
        reading: str = "",
        category: str = "",
        domain: str = "",
        priority: float = 0.6,
        note: str = "",
        source: str = "user-manual",
    ) -> dict:
        """temporary辞書に語を登録する。

        - 既存の term がある場合: enabled=true に戻し last_seen_at を更新して返す。
        - 新規の場合: 全フィールドを初期化して追加する。
        - source / provenance は呼び出し元が指定する（"user-manual" | "seed"）。

        fidelity principle: 自動一括投入は行わない。
        明示的なユーザー選択がある場合のみ本関数を呼ぶこと。
        """
        rows = self._read_rows()
        now = _now_iso()

        for row in rows:
            if row.get("term", "").strip() == term:
                # 既存エントリを再有効化
                row["enabled"] = "true"
                row["last_seen_at"] = now
                self._write_rows(rows)
                return row

        # 新規エントリ
        entry: dict = {
            "term": term,
            "normalized": normalized,
            "variants": variants,
            "reading": reading,
            "category": category,
            "domain": domain,
            "priority": str(priority),
            "protect": "false",
            "source": source,
            "approved": "false",
            "enabled": "true",
            "registered_at": now,
            "last_seen_at": now,
            "note": note,
        }
        rows.append(entry)
        self._write_rows(rows)
        return entry

    def toggle_enabled(self, term: str, enabled: bool) -> Optional[dict]:
        """指定 term の enabled フラグを切り替える。

        term が存在しない場合は None を返す。
        物理削除は行わない（M-1 方針）。
        """
        rows = self._read_rows()
        for row in rows:
            if row.get("term", "").strip() == term:
                row["enabled"] = "true" if enabled else "false"
                self._write_rows(rows)
                return row
        return None
