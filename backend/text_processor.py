import re

class OCRTextProcessor:
    """
    MarkdownノートからOCR対象となる純粋な本文を抽出するクラス。
    ページ（画像）単位での抽出にも対応。
    """
    
    @staticmethod
    def extract_ocr_text(markdown_content: str) -> str:
        """
        ノート内の [!ocr] callout ブロックを探し、その中身を抽出する。
        大文字小文字を問わず、引用記号 '>' で続く限り読み取る。
        別 callout ヘッダー (> [!xxx]) に達した時点でブロック終了とみなす。
        """
        if not markdown_content:
            return ""

        lines = markdown_content.splitlines()
        extracted_lines = []
        is_inside_ocr = False

        re_header = re.compile(r'\[!ocr\]', re.IGNORECASE)
        re_any_callout = re.compile(r'>\s*\[!', re.IGNORECASE)

        for line in lines:
            if not is_inside_ocr:
                if re_header.search(line):
                    is_inside_ocr = True
                    content = line.split(']', 1)[-1].strip()
                    if content:
                        extracted_lines.append(content)
                    continue
            else:
                stripped = line.strip()
                if not stripped:
                    # 空行でブロック終了（Obsidian callout の標準動作）
                    is_inside_ocr = False
                elif re_any_callout.search(line):
                    # 別 callout ヘッダーに到達 → このブロック終了
                    is_inside_ocr = False
                    # 新しいブロックが [!ocr] なら開始する
                    if re_header.search(line):
                        is_inside_ocr = True
                        content = line.split(']', 1)[-1].strip()
                        if content:
                            extracted_lines.append(content)
                elif stripped.startswith('>'):
                    content = stripped[1:].strip()
                    extracted_lines.append(content)
                else:
                    is_inside_ocr = False

        return "\n".join(extracted_lines).strip()

    @staticmethod
    def extract_ocr_pages(markdown_content: str) -> list:
        """
        Markdownから画像とOCRテキストの対応関係をページ単位で抽出する。
        
        構造想定:
        - [ ] ![[画像名.jpg]]
        > [!OCR]
        > テキスト行1
        > テキスト行2
        
        Returns:
            list[dict]: 各ページの情報
            [{"page": 1, "image_name": "xxx.jpg", "ocr_text": "..."}]
        """
        if not markdown_content:
            return []
        
        lines = markdown_content.splitlines()
        pages = []
        
        # WikiLink画像パターン
        re_image = re.compile(r'!\[\[(.*?)(?:\|.*?)?\]\]')
        re_ocr_header = re.compile(r'>\s*\[!ocr\]', re.IGNORECASE)
        
        re_any_callout = re.compile(r'>\s*\[!', re.IGNORECASE)

        i = 0
        while i < len(lines):
            line = lines[i]

            # 画像WikiLinkを検出
            img_match = re_image.search(line)
            if img_match:
                image_name = img_match.group(1).split('/')[-1]

                # この画像に続く [!OCR] ブロックを探す
                ocr_lines = []
                j = i + 1
                found_ocr = False

                # 画像行の後、空行をスキップして OCR ヘッダーを探す
                while j < len(lines):
                    stripped = lines[j].strip()
                    if re_ocr_header.search(lines[j]):
                        found_ocr = True
                        j += 1
                        # OCR コンテンツ行を読む
                        # 別 callout ヘッダー (> [!xxx]) または空行でブロック終了
                        while j < len(lines):
                            s = lines[j].strip()
                            if not s:
                                # 空行 → callout 終了
                                break
                            if re_any_callout.search(lines[j]):
                                # 別 callout ヘッダー → 終了（iはこの行の手前に戻す）
                                break
                            if s.startswith('>'):
                                content = s[1:].strip()
                                ocr_lines.append(content)
                                j += 1
                            else:
                                break
                        break
                    elif stripped == '':
                        # OCR ヘッダー前の空行はスキップ
                        j += 1
                    elif re_image.search(lines[j]):
                        # 次の画像に到達 → OCR ブロックなし
                        break
                    else:
                        # 別の要素 → OCR ブロックなし
                        break

                page_num = len(pages) + 1
                pages.append({
                    "page": page_num,
                    "image_name": image_name,
                    "ocr_text": "\n".join(ocr_lines).strip()
                })

                if found_ocr:
                    i = j
                else:
                    i += 1
            else:
                i += 1

        return pages

    @staticmethod
    def normalize_text(text: str) -> str:
        if not text:
            return ""
        # 最終調整（末尾の空白削除など）
        return "\n".join(line.rstrip() for line in text.splitlines()).strip()

    @classmethod
    def get_clean_text(cls, markdown_content: str) -> str:
        extracted = cls.extract_ocr_text(markdown_content)
        return cls.normalize_text(extracted)
