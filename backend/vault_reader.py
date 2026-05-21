import json
import re
import yaml
import unicodedata
from pathlib import Path
from typing import Optional, Dict, Any, List
from text_processor import OCRTextProcessor

class VaultReader:
    """Obsidian Minji Vaultリーダー（v2: 複数画像・パス検索対応）"""
    
    def __init__(self, vault_path: str):
        self.vault_path = Path(vault_path)
        self.image_index = {}
        self.name_index = {}
        self.id_index = {}
        self.path_index = {}  # 相対パス（拡張子なし）→ md_path
        self._build_index()

    # インデックス対象外のディレクトリ
    EXCLUDE_DIRS = {'backup', 'proofreading-app', '.trash', '.obsidian', '.gemini'}

    def _should_skip(self, path: Path) -> bool:
        """除外ディレクトリに含まれるパスかどうかを判定"""
        return any(part in self.EXCLUDE_DIRS for part in path.relative_to(self.vault_path).parts)

    def _build_index(self):
        print(f"Indexing: {self.vault_path}")
        self.image_index = {}
        self.name_index = {}
        self.id_index = {}
        self.path_index = {}
        for md_path in self.vault_path.rglob("*.md"):
            if self._should_skip(md_path):
                continue
            
            # MacのNFD問題を避けるためNFCに正規化
            stem_nfc = unicodedata.normalize('NFC', md_path.stem)
            self.name_index[stem_nfc] = md_path
            
            # 相対パス（拡張子なし）でもインデックス登録
            rel = md_path.relative_to(self.vault_path)
            rel_no_ext = unicodedata.normalize('NFC', str(rel.with_suffix('')))
            self.path_index[rel_no_ext] = md_path
            
            try:
                with open(md_path, "r", encoding="utf-8") as f:
                    content = f.read(500)
                    if content.startswith("---"):
                        fm = yaml.safe_load(content.split("---")[1])
                        if fm and "id" in fm: self.id_index[str(fm["id"])] = md_path
            except: pass
        
        for ext in [".jpg", ".jpeg", ".png"]:
            for img_path in self.vault_path.rglob(f"*{ext}"):
                if self._should_skip(img_path):
                    continue
                # 画像名も正規化して登録
                name_nfc = unicodedata.normalize('NFC', img_path.name)
                self.image_index[name_nfc] = img_path
        
        print(f"Indexed: {len(self.name_index)} notes, {len(self.image_index)} images")

    def resolve_image_path(self, md_path: Path, md_content: str) -> Optional[Path]:
        """後方互換: 最初の1枚の画像パスを返す"""
        paths = self.resolve_image_paths(md_path, md_content)
        return paths[0] if paths else None

    def resolve_image_paths(self, md_path: Path, md_content: str) -> List[Path]:
        """Markdown内の全画像WikiLinkを順番に解決して返す"""
        wikilinks = re.findall(r'!\[\[(.*?)(?:\|.*?)?\]\]', md_content)
        resolved = []
        for link in wikilinks:
            link_nfc = unicodedata.normalize('NFC', link)
            # パス区切りがある場合は Vault ルートからのフルパスで解決（ファイル名衝突を回避）
            if '/' in link_nfc:
                full_path = self.vault_path / link_nfc
                if full_path.exists():
                    resolved.append(full_path)
                    continue
            # フォールバック: ファイル名のみで検索
            name = link_nfc.split('/')[-1]
            if name in self.image_index:
                resolved.append(self.image_index[name])
        
        if resolved:
            return resolved
        
        # WikiLink画像が見つからない場合、Frontmatterやファイル名でフォールバック
        try:
            if md_content.startswith("---"):
                fm = yaml.safe_load(md_content.split("---")[1])
                if fm and "image" in fm:
                    img = unicodedata.normalize('NFC', str(fm["image"]))
                    if img in self.image_index:
                        return [self.image_index[img]]
                    img_name = Path(img).name
                    if img_name in self.image_index:
                        return [self.image_index[img_name]]
        except: pass

        # Fallback to note name
        stem_nfc = unicodedata.normalize('NFC', md_path.stem)
        for ext in [".jpg", ".jpeg", ".png"]:
            if f"{stem_nfc}{ext}" in self.image_index:
                return [self.image_index[f"{stem_nfc}{ext}"]]
        return []

    def get_document_data(self, query: str) -> Dict[str, Any]:
        """ドキュメントを検索して取得する。パス付き検索にも対応。"""
        md_path = None
        # クエリもNFCに正規化
        query = unicodedata.normalize('NFC', query)
        
        # 1. IDインデックスで検索
        md_path = self.id_index.get(query)
        
        # 2. ファイル名インデックスで検索
        if not md_path:
            md_path = self.name_index.get(query)
        
        # 3. パスインデックスで検索（例: "100/10000001_0016_申渡 減地一件"）
        # .md 拡張子付きで入力された場合にも対応（例: Obsidian の開いているファイルパスをそのまま貼り付け）
        if not md_path:
            md_path = self.path_index.get(query)
            if not md_path and query.endswith('.md'):
                md_path = self.path_index.get(query[:-3])
        
        # 4. 部分一致検索（ファイル名）
        if not md_path:
            for name in self.name_index:
                if query in name:
                    md_path = self.name_index[name]
                    break
        
        # 5. 部分一致検索（パス）
        if not md_path:
            q = query[:-3] if query.endswith('.md') else query
            for path_key in self.path_index:
                if q in path_key:
                    md_path = self.path_index[path_key]
                    break
        
        if not md_path:
            raise Exception(f"Not found: {query}")
        
        with open(md_path, "r", encoding="utf-8") as f:
            md_content = f.read()
        
        # 複数画像パスを解決
        image_paths = self.resolve_image_paths(md_path, md_content)
        image_path = image_paths[0] if image_paths else None
        
        # 画像の相対パスリスト
        image_paths_rel = []
        for p in image_paths:
            try:
                image_paths_rel.append(str(p.relative_to(self.vault_path)))
            except:
                image_paths_rel.append(str(p))
        
        # ページ別OCR抽出
        ocr_pages = OCRTextProcessor.extract_ocr_pages(md_content)
        
        # 各ページに画像パスを紐づけ
        for page in ocr_pages:
            image_link = page.get("image_link", "")
            img_name = page.get("image_name", "")
            resolved_img = False
            # フルパスがあれば Vault ルートから直接解決（ファイル名衝突を回避）
            if image_link and '/' in image_link:
                full_path = self.vault_path / unicodedata.normalize('NFC', image_link)
                if full_path.exists():
                    try:
                        page["image_path"] = str(full_path.relative_to(self.vault_path))
                        resolved_img = True
                    except Exception:
                        pass
            if not resolved_img:
                if img_name in self.image_index:
                    try:
                        page["image_path"] = str(
                            self.image_index[img_name].relative_to(self.vault_path)
                        )
                    except Exception:
                        page["image_path"] = ""
                else:
                    page["image_path"] = ""
        
        # JSON OCR（旧形式、後方互換）
        json_path = None
        for p in self.vault_path.rglob(f"{md_path.stem}.json"):
            json_path = p
            break
        ocr_json = None
        if json_path:
            with open(json_path, "r", encoding="utf-8") as f:
                ocr_json = json.load(f)

        # frontmatter を解析して返す（WikiLink 等の Obsidian 記法はそのまま保持）
        fm = None
        if md_content.startswith("---"):
            try:
                second = md_content.find("\n---", 3)
                if second != -1:
                    fm = yaml.safe_load(md_content[3:second]) or {}
            except Exception:
                fm = {}

        return {
            "doc_id": query,
            "resolved_name": md_path.stem,
            "markdown_path": str(md_path),
            "markdown_content": md_content,
            "image_path": str(image_path.relative_to(self.vault_path)) if image_path else None,
            "image_paths": image_paths_rel,
            "ocr_pages": ocr_pages,
            "ocr_json": ocr_json,
            "frontmatter": fm,
        }

    @staticmethod
    def _collect_ocr_blocks(lines: list) -> list:
        """[!ocr] callout ブロックの開始・内容行インデックスを収集する。
        別 callout ヘッダー (> [!xxx]) または空行でブロック終了とみなす。"""
        re_header = re.compile(r'>\s*\[!ocr\]', re.IGNORECASE)
        re_any_callout = re.compile(r'>\s*\[!', re.IGNORECASE)
        blocks = []
        current = None
        for i, line in enumerate(lines):
            if current is None:
                if re_header.search(line):
                    current = {"header": i, "content": []}
            else:
                stripped = line.strip()
                if not stripped or re_any_callout.search(line) or not stripped.startswith('>'):
                    # 空行 / 別 callout / 非引用行 → ブロック終了
                    blocks.append(current)
                    current = None
                    if re_header.search(line):
                        current = {"header": i, "content": []}
                else:
                    current["content"].append(i)
        if current is not None:
            blocks.append(current)
        return blocks

    def embed_corrected_ocr(self, md_content: str, corrected_text: str) -> str:
        """
        編集されたOCRテキストを [!OCR] コールアウトブロックに書き戻す。
        frontmatter・見出し・画像リンク等の構造は一切変更しない。
        複数ページある場合は元の行数比率でテキストを各ブロックに分配する。
        """
        lines = md_content.splitlines()

        # Step1: [!OCR]ブロックの位置を収集
        blocks = self._collect_ocr_blocks(lines)

        if not blocks:
            return md_content  # [!OCR]なし → 変更しない

        # Step2: 編集テキストを各ブロックに比率分配
        new_lines = corrected_text.splitlines()
        total_new = len(new_lines)
        total_orig = sum(len(b["content"]) for b in blocks) or 1

        assignments = []
        pos = 0
        for i, block in enumerate(blocks):
            if i == len(blocks) - 1:
                assignments.append(new_lines[pos:])
            else:
                count = max(1, round(len(block["content"]) / total_orig * total_new))
                assignments.append(new_lines[pos:pos + count])
                pos += count

        # Step3: 後ろから置換（行番号ずれ防止）
        result = lines[:]
        for block, assigned in reversed(list(zip(blocks, assignments))):
            new_callout = [f"> {t}" for t in assigned]
            h = block["header"]
            if block["content"]:
                end = block["content"][-1]
            else:
                end = h
            result[h:end + 1] = [result[h]] + new_callout

        return "\n".join(result)

    def embed_corrected_ocr_page(self, md_content: str, page_num: int, corrected_text: str) -> str:
        """
        特定ページのOCRテキストのみを書き戻す。
        page_num: 1-indexed
        """
        lines = md_content.splitlines()

        # [!OCR]ブロックの位置を収集
        blocks = self._collect_ocr_blocks(lines)

        if not blocks or page_num < 1 or page_num > len(blocks):
            return md_content

        block = blocks[page_num - 1]
        new_lines = corrected_text.splitlines()
        new_callout = [f"> {t}" for t in new_lines]
        
        result = lines[:]
        h = block["header"]
        end = block["content"][-1] if block["content"] else h
        result[h:end + 1] = [result[h]] + new_callout

        return "\n".join(result)

    def get_file_content(self, md_path: str) -> str:
        """現在のファイル内容を読み込んで返す（bodyパース・callout upsert 前に呼ぶ）。"""
        with open(md_path, "r", encoding="utf-8") as f:
            return f.read()

    def upsert_ocr_callout_for_page(self, md_path: str, page: int, ocr_text: str) -> str:
        """
        指定ページ（1-based）のOCRテキストを callout ブロックで insert または update する。
        - 既存 [!ocr] / [!OCR] ブロックがある → ヘッダーを [!ocr] に統一して内容を置換
        - ブロック未存在（画像行あり） → 画像行の直後に [!ocr] ブロックを挿入
        - 変更後のファイル内容を返す（保存はしない）
        """
        content = self.get_file_content(md_path)
        lines = content.splitlines()

        re_image = re.compile(r'!\[\[(.*?)(?:\|.*?)?\]\]')
        re_ocr_header = re.compile(r'>\s*\[!ocr\]', re.IGNORECASE)
        re_any_callout = re.compile(r'>\s*\[!', re.IGNORECASE)

        # 全画像行インデックスを収集（1-based page に対応する 0-based 配列アクセス）
        image_line_indices = [i for i, ln in enumerate(lines) if re_image.search(ln)]

        if page < 1 or page > len(image_line_indices):
            raise ValueError(f"Page {page} is out of range (1-{len(image_line_indices)})")

        target_img_line = image_line_indices[page - 1]  # 0-based array access

        # 画像行の直後から [!ocr] ヘッダーを探す（空行はスキップ、次の画像 or 別要素で停止）
        callout_header_line = None
        callout_content_end = None
        j = target_img_line + 1
        while j < len(lines):
            stripped = lines[j].strip()
            if re_ocr_header.search(lines[j]):
                callout_header_line = j
                k = j + 1
                # 別 callout ヘッダー (> [!xxx]) または空行・非 '>' 行でブロック終了
                while k < len(lines):
                    s = lines[k].strip()
                    if not s or re_any_callout.search(lines[k]) or not s.startswith('>'):
                        break
                    k += 1
                callout_content_end = k
                break
            elif stripped == '':
                j += 1
            elif re_image.search(lines[j]):
                break  # 次の画像に到達 → callout なし
            else:
                break  # 別の要素 → callout なし

        # [!ocr] 統一形式で新しい callout 行を生成
        new_callout_lines = ["> [!ocr]"] + [f"> {t}" for t in ocr_text.splitlines()]

        result = lines[:]
        if callout_header_line is not None:
            # 既存 callout を置換（ヘッダー行を含む全範囲）
            result[callout_header_line:callout_content_end] = new_callout_lines
        else:
            # 画像行の直後に挿入
            insert_pos = target_img_line + 1
            result[insert_pos:insert_pos] = new_callout_lines

        return "\n".join(result)

    def list_files(self) -> List[Dict[str, Any]]:
        """Returns all indexed markdown files sorted by path.
        Replaceable with Obsidian Vault API (vault.getMarkdownFiles()) in plugin context."""
        result = []
        for rel_path, md_path in self.path_index.items():
            if md_path.suffix.lower() != '.md':
                continue
            result.append({
                "name": unicodedata.normalize('NFC', md_path.stem),
                "path": rel_path,
            })
        return sorted(result, key=lambda x: x["path"])

    def rescan(self) -> Dict[str, Any]:
        """Rebuilds file index in-process without restarting the backend.
        Replaceable with vault.on('create'/'delete') listeners in Obsidian plugin context."""
        old_paths = set(self.path_index.keys())
        self._build_index()
        new_paths = set(self.path_index.keys())
        added_paths = sorted(new_paths - old_paths)
        added_files = [
            {"name": unicodedata.normalize('NFC', self.path_index[p].stem), "path": p}
            for p in added_paths
            if p in self.path_index
        ]
        return {
            "added": len(added_paths),
            "removed": len(old_paths - new_paths),
            "total": len(new_paths),
            "added_files": added_files,
        }

    def update_frontmatter_field(self, md_path: str, field_name: str, value) -> None:
        """
        frontmatter 内の単一フィールドを安全に更新して保存する。
        - frontmatter ブロック（--- ... ---）が存在しない場合は新規作成して追加
        - 行頭完全一致のみ更新（部分キー名・ネストされたキーへの誤マッチなし）
        - フィールド未存在時は closing --- の直前に追記
        - save_markdown() 経由でタイムスタンプ付きバックアップを保証
        """
        content = self.get_file_content(md_path)
        new_value_str = str(value)

        if not content.startswith("---"):
            # frontmatter ブロックが存在しない場合は先頭に新規作成
            new_content = f"---\n{field_name}: {new_value_str}\n---\n{content}"
            self.save_markdown(md_path, new_content)
            return

        # closing '---' を検索（先頭 '---\n' の直後から）
        second_marker = content.find("\n---", 3)
        if second_marker == -1:
            raise ValueError(f"frontmatter が閉じられていません: {md_path}")

        # frontmatter テキスト（'---\n' と '\n---' の間）と残りの本文を分離
        fm_text = content[4:second_marker]          # '---\n' の直後から
        rest    = content[second_marker:]           # '\n---' 以降（本文を含む）

        # 行頭完全一致パターン: ^field_name:[ \t]*.*$
        key_pat = re.compile(
            rf'^({re.escape(field_name)}):[ \t]*.*$',
            re.MULTILINE,
        )

        if key_pat.search(fm_text):
            # count=1: 同一キーが複数行あっても先頭1件のみ書き換え
            new_fm = key_pat.sub(f'{field_name}: {new_value_str}', fm_text, count=1)
        else:
            # キー未存在: 末尾に追記（末尾改行を整える）
            new_fm = fm_text.rstrip("\n") + f"\n{field_name}: {new_value_str}\n"

        new_content = f"---\n{new_fm}{rest}"
        self.save_markdown(md_path, new_content)

    @staticmethod
    def with_disk_frontmatter(disk_content: str, incoming_content: str) -> str:
        """
        フルマークダウン保存時にディスク上の frontmatter を保持するユーティリティ。
        - disk_content の frontmatter（update_frontmatter_field で更新済みの状態）をそのまま使用
        - incoming_content の本文（frontmatter 以降）で body を置き換える
        - disk_content に frontmatter がない場合は incoming_content をそのまま返す
        """
        def _fm_end(content):
            if not content.startswith("---"):
                return None
            pos = content.find("\n---", 3)
            if pos == -1:
                return None
            return pos + 4  # "\n---" の長さ分

        disk_end = _fm_end(disk_content)
        if disk_end is None:
            return incoming_content

        incoming_end = _fm_end(incoming_content)
        incoming_body = incoming_content[incoming_end:] if incoming_end is not None else incoming_content
        return disk_content[:disk_end] + incoming_body

    def save_markdown(self, path, content):
        import shutil
        from datetime import datetime
        from pathlib import Path
        
        # 保存パスのデバッグ
        print(f"DEBUG: Saving to {path}")
        
        # 保存前にオリジナルを backup/ ディレクトリへタイムスタンプ付きで退避
        try:
            target_path = Path(path)
            backup_dir = self.vault_path / "backup"
            backup_dir.mkdir(exist_ok=True)
            
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            stem = target_path.stem
            suffix = target_path.suffix
            
            # ファイル名の末尾にタイムスタンプを付与
            bak_name = f"{stem}_{timestamp}{suffix}"
            bak_path = backup_dir / bak_name
            
            print(f"DEBUG: Creating backup at {bak_path}")
            shutil.copy2(path, bak_path)
        except Exception as e:
            print(f"DEBUG: Backup failed: {e}")
            pass
            
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"DEBUG: Save completed.")
