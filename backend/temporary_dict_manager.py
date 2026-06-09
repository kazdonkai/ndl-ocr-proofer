"""temporary/ ディレクトリ配下の CSV ファイルの CRUD 管理モジュール。

ディレクトリ管理に変更（approved_dict_manager.py と同じパターン）。
- temporary/ ディレクトリ内の全 CSV ファイルを管理
- enabled=true エントリのみ dictionary_loader へ渡す
- 物理削除・論理無効化（enabled=false）の両方に対応
- 書き込み前に自動バックアップ（archive_dir/）
- 原子的書き込み（tempfile + os.replace）
"""

import csv
import datetime
import os
import shutil
import tempfile
from pathlib import Path
from typing import List, Optional

TEMP_CSV_COLUMNS: List[str] = [
    "term",
    "normalized",
    "variants",
    "reading",
    "category",
    "domain",
    "priority",
    "protect",
    "source",
    "approved",
    "enabled",
    "registered_at",
    "last_seen_at",
    "note",
    "approval_count",
]

UNUSED_THRESHOLD_DAYS = 180

_TRUE_VALUES = {"true", "1", "t", "yes", "y"}


def _normalize_variants(raw: str) -> str:
    """';' または ',' を区切りとして受け付け、trim・空除去・重複除去して ';' 結合で返す。
    半角スペース単体は区切り文字として扱わない。"""
    if not raw:
        return ""
    seen: List[str] = []
    seen_set: set[str] = set()
    for part in raw.replace(",", ";").split(";"):
        part = part.strip()
        if part and part not in seen_set:
            seen.append(part)
            seen_set.add(part)
    return ";".join(seen)


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _now_stamp() -> str:
    return datetime.datetime.now().strftime("%Y%m%d_%H%M%S")


def _parse_bool(value: str, default: bool = False) -> bool:
    v = value.strip().lower()
    if v in _TRUE_VALUES:
        return True
    if v in {"false", "0", "f", "no", "n", ""}:
        return False
    return default


class TemporaryDictManager:
    """temporary/ ディレクトリ配下の CSV ファイルの CRUD を担当する。

    Args:
        temp_dir:    temporary/ ディレクトリの絶対パス
        archive_dir: バックアップ保存先
    """

    DEFAULT_FILE = "user_manual_temporary.csv"

    def __init__(self, temp_dir: str, archive_dir: str) -> None:
        self.temp_dir = Path(temp_dir)
        self.archive_dir = Path(archive_dir)
        self.temp_dir.mkdir(parents=True, exist_ok=True)
        self.archive_dir.mkdir(parents=True, exist_ok=True)
        # デフォルトファイルは必ず存在させる
        self.ensure_file(self.DEFAULT_FILE)

    # ── 内部ユーティリティ ─────────────────────────────────────────────────────

    def _csv_path(self, filename: str) -> Path:
        p = (self.temp_dir / filename).resolve()
        if not str(p).startswith(str(self.temp_dir.resolve())):
            raise ValueError(f"不正なファイル名: {filename}")
        return p

    def _read_rows(self, filename: str) -> List[dict]:
        path = self._csv_path(filename)
        if not path.exists():
            raise FileNotFoundError(f"辞書ファイルが見つかりません: {filename}")
        rows: List[dict] = []
        with open(path, "r", encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                rows.append(dict(row))
        return rows

    def _write_rows_atomic(self, filename: str, rows: List[dict]) -> None:
        path = self._csv_path(filename)
        tmp_fd, tmp_path = tempfile.mkstemp(
            dir=str(path.parent), suffix=".tmp", prefix=".dict_"
        )
        try:
            with os.fdopen(tmp_fd, "w", encoding="utf-8", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=TEMP_CSV_COLUMNS, extrasaction="ignore")
                writer.writeheader()
                writer.writerows(rows)
            os.replace(tmp_path, str(path))
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

    def backup(self, filename: str) -> str:
        src = self._csv_path(filename)
        if not src.exists():
            return ""
        stem = src.stem
        dst = self.archive_dir / f"{stem}_{_now_stamp()}.csv"
        shutil.copy2(str(src), str(dst))
        return str(dst)

    @staticmethod
    def _is_enabled(row: dict) -> bool:
        return _parse_bool(row.get("enabled", "false"), default=False)

    # ── 読み取り API ───────────────────────────────────────────────────────────

    def list_files(self) -> List[str]:
        return sorted(p.name for p in self.temp_dir.glob("*.csv"))

    def read_file(self, filename: str) -> List[dict]:
        return self._read_rows(filename)

    def read_all(self) -> List[dict]:
        """全 CSV ファイルのエントリを結合して返す（source_file フィールドを付与）。"""
        result: List[dict] = []
        for name in self.list_files():
            try:
                rows = self._read_rows(name)
                for row in rows:
                    row["source_file"] = name
                result.extend(rows)
            except Exception:
                pass
        return result

    def read_enabled(self) -> List[dict]:
        """enabled=true のエントリのみ返す。dictionary_loader 用。"""
        return [r for r in self.read_all() if self._is_enabled(r)]

    def is_stale(self, row: dict) -> bool:
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

    # ── 書き込み API ──────────────────────────────────────────────────────────

    def ensure_file(self, filename: str) -> None:
        """CSV ファイルが存在しない場合にヘッダーのみで作成する。"""
        path = self._csv_path(filename)
        if not path.exists():
            with open(path, "w", encoding="utf-8", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=TEMP_CSV_COLUMNS)
                writer.writeheader()

    def register(
        self,
        term: str,
        normalized: str,
        *,
        filename: str = DEFAULT_FILE,
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
        """
        self.ensure_file(filename)
        rows = self._read_rows(filename)
        now = _now_iso()

        for row in rows:
            if row.get("term", "").strip() == term:
                row["enabled"] = "true"
                row["last_seen_at"] = now
                old_count = int(row.get("approval_count", "0") or "0")
                row["approval_count"] = str(old_count + 1)
                self._write_rows_atomic(filename, rows)
                row["source_file"] = filename
                return row

        entry: dict = {
            "term": term,
            "normalized": normalized,
            "variants": _normalize_variants(variants),
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
            "approval_count": "0",
        }
        rows.append(entry)
        self._write_rows_atomic(filename, rows)
        entry["source_file"] = filename
        return entry

    def toggle_enabled(self, term: str, enabled: bool, filename: Optional[str] = None) -> Optional[dict]:
        """指定 term の enabled フラグを切り替える。"""
        search_files = [filename] if filename else self.list_files()
        for fname in search_files:
            try:
                rows = self._read_rows(fname)
            except FileNotFoundError:
                continue
            for row in rows:
                if row.get("term", "").strip() == term:
                    row["enabled"] = "true" if enabled else "false"
                    self._write_rows_atomic(fname, rows)
                    row["source_file"] = fname
                    return row
        return None

    def update_entry(self, filename: str, term: str, updates: dict) -> dict:
        """既存エントリのフィールドを部分更新する（バックアップ後）。"""
        rows = self._read_rows(filename)
        term = term.strip()
        for row in rows:
            if row.get("term", "").strip() == term:
                self.backup(filename)
                normalized_changed = (
                    "normalized" in updates
                    and str(updates["normalized"]).strip() != row.get("normalized", "").strip()
                )
                for key in ("normalized", "variants", "reading", "category",
                            "domain", "priority", "protect", "note", "enabled"):
                    if key in updates:
                        val = updates[key]
                        if key == "variants":
                            row[key] = _normalize_variants(str(val))
                        elif key in ("protect", "enabled"):
                            row[key] = "true" if _parse_bool(str(val)) else "false"
                        else:
                            row[key] = str(val).strip()
                if normalized_changed:
                    row["approval_count"] = "0"
                row["last_seen_at"] = _now_iso()
                self._write_rows_atomic(filename, rows)
                row["source_file"] = filename
                return row
        raise KeyError(f"term '{term}' が見つかりません: {filename}")

    def delete_entry(self, filename: str, term: str) -> None:
        """エントリを CSV から物理削除する（バックアップ後）。"""
        rows = self._read_rows(filename)
        term = term.strip()
        new_rows = [r for r in rows if r.get("term", "").strip() != term]
        if len(new_rows) == len(rows):
            raise KeyError(f"term '{term}' が見つかりません: {filename}")
        self.backup(filename)
        self._write_rows_atomic(filename, new_rows)

    def delete_file(self, filename: str, archive_dir: Optional[Path] = None) -> str:
        """辞書ファイルを削除する（バックアップ後）。バックアップパスを返す。"""
        if filename == self.DEFAULT_FILE:
            raise ValueError(f"'{filename}' は基幹 temporary ファイルのため削除できません")
        backup_path = self.backup(filename)
        path = self._csv_path(filename)
        path.unlink()
        return backup_path

    def has_protected_entries(self, filename: str) -> bool:
        """protect=true のエントリが存在するか確認する。"""
        try:
            rows = self._read_rows(filename)
            return any(_parse_bool(r.get("protect", "false")) for r in rows)
        except Exception:
            return False

    def backup_all(self) -> List[str]:
        paths: List[str] = []
        for name in self.list_files():
            p = self.backup(name)
            if p:
                paths.append(p)
        return paths
