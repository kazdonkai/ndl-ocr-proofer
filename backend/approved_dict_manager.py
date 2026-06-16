"""approved/ および staging/ 辞書 CSV の CRUD 管理モジュール。

GUI からの辞書エントリ追加・編集・削除・バックアップを担当する。
- 書き込み前に自動バックアップ（archive/old_versions/）
- 原子的書き込み（tempfile + os.replace）
- ai_analyzer.reload_dictionary() の呼び出しは main.py 側で行う
"""

import csv
import datetime
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any, Optional

APPROVED_CSV_COLUMNS = [
    "term", "normalized", "variants", "reading",
    "category", "domain", "priority", "protect", "source", "approved",
]

_TRUE_VALUES = {"true", "1", "t", "yes", "y"}


def _normalize_variants(raw: str) -> str:
    """';' または ',' を区切りとして受け付け、trim・空除去・重複除去して ';' 結合で返す。
    半角スペース単体は区切り文字として扱わない。"""
    if not raw:
        return ""
    seen: list[str] = []
    seen_set: set[str] = set()
    for part in raw.replace(",", ";").split(";"):
        part = part.strip()
        if part and part not in seen_set:
            seen.append(part)
            seen_set.add(part)
    return ";".join(seen)


def _parse_bool(value: str, default: bool = False) -> bool:
    v = str(value).strip().lower()
    if v in _TRUE_VALUES:
        return True
    if v in {"false", "0", "f", "no", "n", ""}:
        return False
    return default


def _now_stamp() -> str:
    return datetime.datetime.now().strftime("%Y%m%d_%H%M%S")


class ApprovedDictManager:
    """approved/ ディレクトリ配下の CSV ファイルの CRUD を担当する。

    Args:
        approved_dir: approved/ ディレクトリの絶対パス
        archive_dir:  バックアップ保存先（存在しない場合は自動作成）
    """

    def __init__(self, approved_dir: str, archive_dir: str) -> None:
        self.approved_dir = Path(approved_dir)
        self.archive_dir = Path(archive_dir)
        self.approved_dir.mkdir(parents=True, exist_ok=True)
        self.archive_dir.mkdir(parents=True, exist_ok=True)

    # ── 内部ユーティリティ ────────────────────────────────────────────────────

    def _csv_path(self, filename: str) -> Path:
        """ファイル名を approved_dir への安全なパスに解決する（パストラバーサル防止）。"""
        p = (self.approved_dir / filename).resolve()
        if not str(p).startswith(str(self.approved_dir.resolve())):
            raise ValueError(f"不正なファイル名: {filename}")
        return p

    def _read_rows(self, filename: str) -> list[dict]:
        path = self._csv_path(filename)
        if not path.exists():
            raise FileNotFoundError(f"辞書ファイルが見つかりません: {filename}")
        rows: list[dict] = []
        with open(path, "r", encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                rows.append(dict(row))
        return rows

    def _write_rows_atomic(self, filename: str, rows: list[dict]) -> None:
        path = self._csv_path(filename)
        tmp_fd, tmp_path = tempfile.mkstemp(
            dir=str(path.parent), suffix=".tmp", prefix=".dict_"
        )
        try:
            with os.fdopen(tmp_fd, "w", encoding="utf-8", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=APPROVED_CSV_COLUMNS, extrasaction="ignore")
                writer.writeheader()
                writer.writerows(rows)
            os.replace(tmp_path, str(path))
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

    def _backup(self, filename: str) -> str:
        """書き込み前にファイルを archive_dir へコピーする。バックアップパスを返す。"""
        src = self._csv_path(filename)
        if not src.exists():
            return ""
        stem = src.stem
        dst = self.archive_dir / f"{stem}_{_now_stamp()}.csv"
        shutil.copy2(str(src), str(dst))
        return str(dst)

    def backup(self, filename: str) -> str:
        """public バックアップ API（_backup の公開版）。"""
        return self._backup(filename)

    # ── 読み取り API ─────────────────────────────────────────────────────────

    def list_files(self) -> list[str]:
        """approved_dir 内の CSV ファイル名一覧を返す（サブディレクトリ除外）。"""
        return sorted(p.name for p in self.approved_dir.glob("*.csv"))

    def read_file(self, filename: str) -> list[dict]:
        """指定ファイルの全行を返す。"""
        return self._read_rows(filename)

    def read_all(self) -> list[dict]:
        """全 CSV ファイルのエントリを結合して返す（source_file フィールドを付与）。"""
        result: list[dict] = []
        for name in self.list_files():
            try:
                rows = self._read_rows(name)
                for row in rows:
                    row["source_file"] = name
                result.extend(rows)
            except Exception:
                pass
        return result

    # ── 書き込み API ─────────────────────────────────────────────────────────

    def ensure_file(self, filename: str) -> None:
        """CSV ファイルが存在しない場合にヘッダーのみで作成する。"""
        path = self._csv_path(filename)
        if not path.exists():
            with open(path, "w", encoding="utf-8", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=APPROVED_CSV_COLUMNS)
                writer.writeheader()

    def append_entry(self, filename: str, entry: dict) -> dict:
        """エントリを CSV の末尾に追加する。term の重複チェックあり。"""
        self.ensure_file(filename)
        rows = self._read_rows(filename)
        term = entry.get("term", "").strip()
        if not term:
            raise ValueError("term は必須です")
        if any(r.get("term", "").strip() == term for r in rows):
            raise ValueError(f"term '{term}' は既に存在します")
        self._backup(filename)
        row = {
            "term": term,
            "normalized": entry.get("normalized", term).strip(),
            "variants": _normalize_variants(entry.get("variants", "")),
            "reading": entry.get("reading", "").strip(),
            "category": entry.get("category", "").strip(),
            "domain": entry.get("domain", "").strip(),
            "priority": str(entry.get("priority", "0.8")),
            "protect": "true" if _parse_bool(str(entry.get("protect", "false"))) else "false",
            "source": entry.get("source", "manual").strip(),
            "approved": "true" if _parse_bool(str(entry.get("approved", "true"))) else "false",
        }
        rows.append(row)
        self._write_rows_atomic(filename, rows)
        row["source_file"] = filename
        return row

    def update_entry(self, filename: str, term: str, updates: dict) -> dict:
        """既存エントリのフィールドを部分更新する。"""
        rows = self._read_rows(filename)
        term = term.strip()
        for row in rows:
            if row.get("term", "").strip() == term:
                self._backup(filename)
                for key in ("normalized", "variants", "reading", "category",
                            "domain", "priority", "protect", "source", "approved"):
                    if key in updates:
                        val = updates[key]
                        if key == "variants":
                            row[key] = _normalize_variants(str(val))
                        elif key in ("protect", "approved"):
                            row[key] = "true" if _parse_bool(str(val)) else "false"
                        else:
                            row[key] = str(val).strip()
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
        self._backup(filename)
        self._write_rows_atomic(filename, new_rows)

    def has_protected_entries(self, filename: str) -> bool:
        """protect=true のエントリが存在するか確認する。"""
        _TRUE = {"true", "1", "t", "yes", "y"}
        try:
            rows = self._read_rows(filename)
            return any(str(r.get("protect", "false")).strip().lower() in _TRUE for r in rows)
        except Exception:
            return False

    def rename_file(self, old_filename: str, new_filename: str) -> str:
        """辞書ファイルをリネームする（バックアップ後）。新ファイル名を返す。

        拒否条件:
          - old_filename == new_filename（同名リネーム）
          - new_filename が既に存在する
          - いずれかのファイル名が不正（_csv_path によるパストラバーサル検出）
        """
        if old_filename == new_filename:
            raise ValueError(f"新しいファイル名が現在のファイル名と同じです: '{old_filename}'")
        old_path = self._csv_path(old_filename)
        new_path = self._csv_path(new_filename)
        if not old_path.exists():
            raise FileNotFoundError(f"辞書ファイルが見つかりません: {old_filename}")
        if new_path.exists():
            raise FileExistsError(f"ファイルが既に存在します: {new_filename}")
        self._backup(old_filename)
        old_path.rename(new_path)
        return new_filename

    def delete_file(self, filename: str) -> str:
        """辞書ファイルを削除する（バックアップ後）。バックアップパスを返す。"""
        backup_path = self._backup(filename)
        path = self._csv_path(filename)
        path.unlink()
        return backup_path

    def backup_all(self) -> list[str]:
        """全 CSV ファイルを一括バックアップする。バックアップパスのリストを返す。"""
        paths: list[str] = []
        for name in self.list_files():
            p = self._backup(name)
            if p:
                paths.append(p)
        return paths
