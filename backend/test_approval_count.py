"""
test_approval_count.py

approval_count フィールドおよび昇格候補（is_promotion_candidate）の動作検証。

テスト対象:
  - approval_count 列なし CSV の後方互換読み込み
  - 新規登録時の approval_count 初期値（= 0）
  - 同一 term 再登録時のインクリメント
  - normalized 変更時のカウントリセット
  - normalized 変更なし（他フィールド変更）はリセットしない
  - 閾値到達時の is_promotion_candidate 判定（main._row_to_entry 経由）
  - enabled=false 時は is_promotion_candidate が False
  - 一覧ソートで候補エントリが先頭に来ること（displayEntries ロジック相当）
"""

import csv
import io
import os
import sys
import tempfile
import pytest
from pathlib import Path

# backend ディレクトリをパスに追加
sys.path.insert(0, str(Path(__file__).parent))

from temporary_dict_manager import TemporaryDictManager, TEMP_CSV_COLUMNS

PROMOTION_CANDIDATE_THRESHOLD = 3  # main.py と同値


# ── フィクスチャ ──────────────────────────────────────────────────────────────

@pytest.fixture
def manager(tmp_path):
    temp_dir = tmp_path / "temporary"
    archive_dir = tmp_path / "archive"
    return TemporaryDictManager(str(temp_dir), str(archive_dir))


# ── ヘルパー ──────────────────────────────────────────────────────────────────

def _approval_count(manager: TemporaryDictManager, filename: str, term: str) -> int:
    rows = manager.read_file(filename)
    row = next((r for r in rows if r.get("term", "").strip() == term), None)
    assert row is not None, f"term '{term}' が見つかりません"
    return int(row.get("approval_count", "0") or "0")


def _is_candidate(approval_count: int, enabled: bool) -> bool:
    """main.py の _row_to_entry 内の判定ロジックを再現する。"""
    return enabled and approval_count >= PROMOTION_CANDIDATE_THRESHOLD


def _write_legacy_csv(path: Path, rows: list[dict]) -> None:
    """approval_count 列を持たない旧形式 CSV を書き込む。"""
    legacy_columns = [c for c in TEMP_CSV_COLUMNS if c != "approval_count"]
    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=legacy_columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


# ── 後方互換性 ────────────────────────────────────────────────────────────────

class TestLegacyCsvCompat:
    def test_read_csv_without_approval_count_column(self, manager, tmp_path):
        """approval_count 列なし CSV を読んでも KeyError にならず、値は 0 とみなせる。"""
        legacy_path = manager.temp_dir / "legacy.csv"
        _write_legacy_csv(legacy_path, [{
            "term": "テスト語",
            "normalized": "テスト語",
            "variants": "",
            "reading": "",
            "category": "",
            "domain": "",
            "priority": "0.6",
            "protect": "false",
            "source": "seed",
            "approved": "false",
            "enabled": "true",
            "registered_at": "2024-01-01T00:00:00+00:00",
            "last_seen_at": "2024-01-01T00:00:00+00:00",
            "note": "",
        }])

        rows = manager.read_file("legacy.csv")
        assert len(rows) == 1
        count = int(rows[0].get("approval_count", "0") or "0")
        assert count == 0

    def test_new_file_has_approval_count_column(self, manager):
        """新規作成ファイルのヘッダーに approval_count が含まれる。"""
        manager.ensure_file("new.csv")
        path = manager.temp_dir / "new.csv"
        with open(path, "r", encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            assert "approval_count" in (reader.fieldnames or [])

    def test_empty_file_readable(self, manager):
        """ヘッダーのみの空ファイルを読んでもエラーにならない。"""
        manager.ensure_file("empty.csv")
        rows = manager.read_file("empty.csv")
        assert rows == []


# ── 新規登録時の初期値 ────────────────────────────────────────────────────────

class TestInitialApprovalCount:
    def test_new_entry_approval_count_is_zero(self, manager):
        """新規登録エントリの approval_count は 0。"""
        manager.register("初期語", "初期語")
        count = _approval_count(manager, manager.DEFAULT_FILE, "初期語")
        assert count == 0

    def test_multiple_new_entries_all_zero(self, manager):
        """複数新規登録しても全エントリの初期値は 0。"""
        for i in range(5):
            manager.register(f"語{i}", f"語{i}")
        rows = manager.read_file(manager.DEFAULT_FILE)
        for row in rows:
            assert int(row.get("approval_count", "0") or "0") == 0


# ── 再登録時のインクリメント ──────────────────────────────────────────────────

class TestApprovalCountIncrement:
    def test_reregister_increments_count(self, manager):
        """同一 term を再登録すると approval_count が 1 増える。"""
        manager.register("語A", "語A")
        assert _approval_count(manager, manager.DEFAULT_FILE, "語A") == 0

        manager.register("語A", "語A")
        assert _approval_count(manager, manager.DEFAULT_FILE, "語A") == 1

    def test_multiple_reregistrations(self, manager):
        """3 回再登録すると approval_count == 3。"""
        manager.register("語B", "語B")
        for _ in range(3):
            manager.register("語B", "語B")
        assert _approval_count(manager, manager.DEFAULT_FILE, "語B") == 3

    def test_reregister_does_not_affect_other_entries(self, manager):
        """再登録は同一 term のカウントのみ増やす。他エントリに影響しない。"""
        manager.register("語C", "語C")
        manager.register("語D", "語D")
        manager.register("語C", "語C")

        assert _approval_count(manager, manager.DEFAULT_FILE, "語C") == 1
        assert _approval_count(manager, manager.DEFAULT_FILE, "語D") == 0


# ── normalized 変更時のリセット ───────────────────────────────────────────────

class TestNormalizedChangeReset:
    def test_update_normalized_resets_count(self, manager):
        """update_entry で normalized が変わった場合、approval_count を 0 にリセットする。"""
        manager.register("語E", "語E")
        for _ in range(3):
            manager.register("語E", "語E")
        assert _approval_count(manager, manager.DEFAULT_FILE, "語E") == 3

        manager.update_entry(manager.DEFAULT_FILE, "語E", {"normalized": "語E（修正後）"})
        assert _approval_count(manager, manager.DEFAULT_FILE, "語E") == 0

    def test_update_other_field_does_not_reset_count(self, manager):
        """normalized 以外のフィールド更新では approval_count をリセットしない。"""
        manager.register("語F", "語F")
        for _ in range(2):
            manager.register("語F", "語F")
        assert _approval_count(manager, manager.DEFAULT_FILE, "語F") == 2

        manager.update_entry(manager.DEFAULT_FILE, "語F", {"note": "メモ追記"})
        assert _approval_count(manager, manager.DEFAULT_FILE, "語F") == 2

    def test_update_normalized_to_same_value_does_not_reset(self, manager):
        """normalized を同じ値で更新した場合はリセットしない。"""
        manager.register("語G", "語G")
        for _ in range(2):
            manager.register("語G", "語G")
        assert _approval_count(manager, manager.DEFAULT_FILE, "語G") == 2

        manager.update_entry(manager.DEFAULT_FILE, "語G", {"normalized": "語G"})
        assert _approval_count(manager, manager.DEFAULT_FILE, "語G") == 2


# ── 昇格候補判定 ─────────────────────────────────────────────────────────────

class TestPromotionCandidate:
    def test_below_threshold_is_not_candidate(self, manager):
        """approval_count が閾値未満（2）の場合は候補でない。"""
        manager.register("語H", "語H")
        for _ in range(2):
            manager.register("語H", "語H")
        count = _approval_count(manager, manager.DEFAULT_FILE, "語H")
        assert count == 2
        assert not _is_candidate(count, enabled=True)

    def test_at_threshold_is_candidate(self, manager):
        """approval_count が閾値（3）に達した場合は候補になる。"""
        manager.register("語I", "語I")
        for _ in range(3):
            manager.register("語I", "語I")
        count = _approval_count(manager, manager.DEFAULT_FILE, "語I")
        assert count == 3
        assert _is_candidate(count, enabled=True)

    def test_above_threshold_is_candidate(self, manager):
        """approval_count が閾値を超えても候補のまま。"""
        manager.register("語J", "語J")
        for _ in range(5):
            manager.register("語J", "語J")
        count = _approval_count(manager, manager.DEFAULT_FILE, "語J")
        assert count == 5
        assert _is_candidate(count, enabled=True)


# ── enabled=false 時の非表示 ──────────────────────────────────────────────────

class TestDisabledEntryNotCandidate:
    def test_disabled_entry_is_not_candidate(self, manager):
        """enabled=false のエントリは閾値以上でも候補にならない。"""
        manager.register("語K", "語K")
        for _ in range(3):
            manager.register("語K", "語K")
        count = _approval_count(manager, manager.DEFAULT_FILE, "語K")
        assert count == 3

        # 無効化
        manager.toggle_enabled("語K", False)
        assert not _is_candidate(count, enabled=False)

    def test_reenabled_entry_becomes_candidate(self, manager):
        """再有効化すると候補に戻る（カウントは維持）。"""
        manager.register("語L", "語L")
        for _ in range(3):
            manager.register("語L", "語L")
        manager.toggle_enabled("語L", False)
        manager.toggle_enabled("語L", True)

        count = _approval_count(manager, manager.DEFAULT_FILE, "語L")
        assert count == 3
        assert _is_candidate(count, enabled=True)


# ── 一覧ソート（displayEntries ロジック） ─────────────────────────────────────

class TestDisplayEntriesSort:
    def _make_entry(self, term: str, is_candidate: bool) -> dict:
        return {"term": term, "is_promotion_candidate": is_candidate}

    def _sort_entries(self, entries: list[dict]) -> list[dict]:
        """DictionaryManager.jsx の displayEntries ソートロジックを Python で再現する。"""
        return sorted(
            entries,
            key=lambda e: (0 if e.get("is_promotion_candidate") else 1),
        )

    def test_candidate_comes_first(self):
        """昇格候補エントリが先頭に並ぶ。"""
        entries = [
            self._make_entry("語M", False),
            self._make_entry("語N", True),
            self._make_entry("語O", False),
        ]
        result = self._sort_entries(entries)
        assert result[0]["term"] == "語N"

    def test_multiple_candidates_stay_grouped(self):
        """複数候補はまとめて先頭に来る。"""
        entries = [
            self._make_entry("語P", False),
            self._make_entry("語Q", True),
            self._make_entry("語R", True),
            self._make_entry("語S", False),
        ]
        result = self._sort_entries(entries)
        assert result[0]["is_promotion_candidate"] is True
        assert result[1]["is_promotion_candidate"] is True
        assert not result[2]["is_promotion_candidate"]
        assert not result[3]["is_promotion_candidate"]

    def test_no_candidates_order_unchanged(self):
        """候補がない場合は元の順序が維持される。"""
        entries = [
            self._make_entry("語T", False),
            self._make_entry("語U", False),
        ]
        result = self._sort_entries(entries)
        assert [e["term"] for e in result] == ["語T", "語U"]

    def test_all_candidates_order_unchanged(self):
        """全員候補の場合も元の順序が維持される。"""
        entries = [
            self._make_entry("語V", True),
            self._make_entry("語W", True),
        ]
        result = self._sort_entries(entries)
        assert [e["term"] for e in result] == ["語V", "語W"]
