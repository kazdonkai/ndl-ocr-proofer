import csv
from pathlib import Path
from typing import List, Optional, Set
from models import DictionaryTerm

class DictionaryLoader:
    """研究語彙辞書CSVの読込・バリデーション・メモリ展開を担当するクラス (Task D.2)"""
    
    def __init__(self, dictionaries_dir: str):
        self.dict_dir = Path(dictionaries_dir)
        self.approved_dir = self.dict_dir / "approved"
        self.staging_dir = self.dict_dir / "staging"
        self.terms: List[DictionaryTerm] = []

    def _parse_bool(self, value: str, default: bool = False) -> bool:
        """文字列を真偽値に安全にパースする"""
        v = value.strip().lower()
        if v in ('true', '1', 't', 'yes', 'y'):
            return True
        if v in ('false', '0', 'f', 'no', 'n'):
            return False
        return default

    def _parse_float(self, value: str, default: float = 0.0) -> float:
        """文字列を数値に安全にパースする"""
        if not value.strip():
            return default
        try:
            return float(value)
        except ValueError:
            return default

    def load_csv(self, file_path: Path, tier: str = "stable") -> List[DictionaryTerm]:
        """単一のCSVファイルを読み込み、厳密なバリデーションを行ってDictionaryTermのリストを返す"""
        loaded_terms = []
        
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                
                # 必須列チェック
                required_cols = {
                    "term", "normalized", "variants", "reading", "category", 
                    "domain", "priority", "protect", "source", "approved"
                }
                actual_cols = set(reader.fieldnames or [])
                if not required_cols.issubset(actual_cols):
                    missing = required_cols - actual_cols
                    raise ValueError(f"ファイル '{file_path.name}' に必須列が不足しています: {missing}")

                for line_idx, row in enumerate(reader, start=2): # header is line 1
                    term = row.get("term", "").strip()
                    if not term:
                        raise ValueError(f"ファイル '{file_path.name}' の {line_idx}行目: 'term' は必須です")
                    
                    # variantsの配列化 (空文字を除去)
                    variants_raw = row.get("variants", "")
                    variants = [v.strip() for v in variants_raw.split(";") if v.strip()]
                    
                    try:
                        priority = self._parse_float(row.get("priority", "0.0"))
                    except Exception:
                        raise ValueError(f"ファイル '{file_path.name}' の {line_idx}行目: 'priority' が不正な数値です")
                        
                    protect = self._parse_bool(row.get("protect", "false"))
                    approved = self._parse_bool(row.get("approved", "false"))

                    term_obj = DictionaryTerm(
                        term=term,
                        normalized=row.get("normalized", "").strip(),
                        variants=variants,
                        reading=row.get("reading", "").strip(),
                        category=row.get("category", "").strip(),
                        domain=row.get("domain", "").strip(),
                        priority=priority,
                        protect=protect,
                        source=row.get("source", "").strip(),
                        approved=approved,
                        tier=tier,
                    )
                    loaded_terms.append(term_obj)
                    
        except UnicodeDecodeError:
            raise ValueError(f"ファイル '{file_path.name}' はUTF-8形式で保存してください。")
            
        return loaded_terms

    def load_all_approved(self):
        """approvedディレクトリ配下のすべてのCSVを一括で読み込む"""
        self.terms.clear()
        if not self.approved_dir.exists():
            print(f"Warning: Approved dictionary directory not found: {self.approved_dir}")
            return
            
        for csv_path in self.approved_dir.glob("*.csv"):
            terms = self.load_csv(csv_path, tier="stable")
            self.terms.extend(terms)

        # 必要に応じて、同一 term + domain の完全重複をチェックしてマージ/警告する処理を追加可能
        
    def load_staging(self, filename: str) -> List[DictionaryTerm]:
        """stagingディレクトリ内の特定のCSVを別枠で読み込む"""
        target_path = self.staging_dir / filename
        if not target_path.exists():
            raise FileNotFoundError(f"Staging file not found: {filename}")
        return self.load_csv(target_path, tier="experimental")

    def load_all_staging(self) -> None:
        """stagingディレクトリ配下のすべてのCSVを experimental tier で self.terms に追記する。
        既存の stable terms は変更しない。staging/ が存在しないか空の場合は何もしない。"""
        if not self.staging_dir.exists():
            return
        added = 0
        for csv_path in self.staging_dir.glob("*.csv"):
            terms = self.load_csv(csv_path, tier="experimental")
            self.terms.extend(terms)
            added += len(terms)
        if added:
            print(f"[DictionaryLoader] Loaded {added} experimental terms from staging/.")

    def load_temporary_csv(self, file_path: Path) -> List[DictionaryTerm]:
        """temporary CSV を読み込む。

        - enabled=true のエントリのみロードする（M-1 loader フィルタ）。
        - tier="temporary" を付与して stable / experimental と区別する。
        - source フィールドで "user-manual" / "seed" の provenance を保持する。
        - 既存の load_csv() とは独立したメソッドで、観測フィールド A〜I に影響しない。
        """
        loaded_terms: List[DictionaryTerm] = []
        _TRUE = {"true", "1", "t", "yes", "y"}
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    # enabled フィルタ（M-1 コア要件）
                    enabled_raw = row.get("enabled", "false").strip().lower()
                    if enabled_raw not in _TRUE:
                        continue

                    term = row.get("term", "").strip()
                    if not term:
                        continue

                    variants_raw = row.get("variants", "")
                    variants = [v.strip() for v in variants_raw.split(";") if v.strip()]

                    term_obj = DictionaryTerm(
                        term=term,
                        normalized=row.get("normalized", "").strip(),
                        variants=variants,
                        reading=row.get("reading", "").strip(),
                        category=row.get("category", "").strip(),
                        domain=row.get("domain", "").strip(),
                        priority=self._parse_float(row.get("priority", "0.6")),
                        protect=self._parse_bool(row.get("protect", "false")),
                        source=row.get("source", "user-manual").strip(),
                        approved=self._parse_bool(row.get("approved", "false")),
                        tier="temporary",  # stable / experimental と区別
                    )
                    loaded_terms.append(term_obj)
        except UnicodeDecodeError:
            raise ValueError(f"ファイル '{file_path.name}' はUTF-8形式で保存してください。")
        return loaded_terms

    def load_temporary_dir(self) -> None:
        """temporary/ ディレクトリの CSV を一括ロードする（enabled=true のみ）。

        - reload() から常に呼ばれる（use_experimental フラグに依存しない）。
        - tier="temporary" で分類されるため rank1_from_experimental_dict（観測 A〜I）に影響しない。
        """
        temp_dir = self.dict_dir / "temporary"
        if not temp_dir.exists():
            return
        added = 0
        for csv_path in temp_dir.glob("*.csv"):
            terms = self.load_temporary_csv(csv_path)
            self.terms.extend(terms)
            added += len(terms)
        if added:
            print(f"[DictionaryLoader] Loaded {added} temporary terms from temporary/ (enabled only).")

    def reload(self, use_experimental: bool = False) -> None:
        """辞書全体を再読み込みする。use_experimental=True のとき staging/ も追加ロードする。
        temporary/ は use_experimental フラグに関わらず常にロードする。
        """
        self.load_all_approved()
        if use_experimental:
            self.load_all_staging()
        self.load_temporary_dir()
        print(f"[DictionaryLoader] Reload complete: {len(self.terms)} terms (experimental={use_experimental}).")

    def search_by_domain(self, domain: str) -> List[DictionaryTerm]:
        """特定の分野(domain)に合致する語彙リストを返すAPI"""
        return [t for t in self.terms if t.domain == domain]

# 動作確認用
if __name__ == "__main__":
    import os
    # 実行場所にかかわらず絶対パスでテスト
    base_dir = Path(__file__).parent.parent
    test_dict_dir = base_dir / "data/dictionaries"
    
    loader = DictionaryLoader(str(test_dict_dir))
    try:
        loader.load_all_approved()
        print(f"✅ Loaded {len(loader.terms)} terms from approved dictionaries.")
        for t in loader.terms:
            print(f"   - {t.term} (protect={t.protect}, priority={t.priority}, forms={t.all_forms})")
            
    except Exception as e:
        print(f"❌ Validation Error: {e}")
