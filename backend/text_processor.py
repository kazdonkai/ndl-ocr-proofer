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

        通常形式（callout）:
            ![[image.jpg]]
            > [!OCR]
            > テキスト行1
            > テキスト行2

        一括ノート形式（> プレフィックスなし）:
            ![[image.jpg]]
            > [!OCR]
            テキスト行1
            テキスト行2

        Returns:
            list[dict]: 各ページの情報
            [{"page": 1, "image_name": "xxx.jpg", "image_link": "path/to/xxx.jpg", "ocr_text": "..."}]
        """
        if not markdown_content:
            return []

        re_image = re.compile(r'!\[\[(.*?)(?:\|.*?)?\]\]')
        re_ocr_header = re.compile(r'>\s*\[!ocr\]', re.IGNORECASE)
        re_any_callout = re.compile(r'>\s*\[!', re.IGNORECASE)
        re_heading = re.compile(r'^#{1,6}\s+')

        lines = markdown_content.splitlines()
        pages = []

        i = 0
        while i < len(lines):
            line = lines[i]

            img_match = re_image.search(line)
            if img_match:
                image_link = img_match.group(1)          # フルパス ("path/to/page-01.jpg")
                image_name = image_link.split('/')[-1]   # ファイル名のみ

                ocr_lines = []
                j = i + 1
                found_ocr = False

                # 画像行の後、空行をスキップして OCR ヘッダーを探す
                while j < len(lines):
                    stripped = lines[j].strip()
                    if re_ocr_header.search(lines[j]):
                        found_ocr = True
                        j += 1
                        # OCR コンテンツ行を読む（> プレフィックスあり）
                        while j < len(lines):
                            s = lines[j].strip()
                            if not s:
                                break
                            if re_any_callout.search(lines[j]):
                                break
                            if s.startswith('>'):
                                content = s[1:].strip()
                                ocr_lines.append(content)
                                j += 1
                            else:
                                break
                        # > プレフィックスなし（一括ノート形式）のフォールバック
                        # >[!ocr] の後に > で始まらない行が来た場合、次の画像まで読む
                        if not ocr_lines:
                            re_page_sep = re.compile(r'^#{1,6}\s+.*\.(jpg|jpeg|png)\b', re.IGNORECASE)
                            k = j
                            while k < len(lines):
                                if re_image.search(lines[k]):
                                    break
                                s = lines[k].strip()
                                if s:
                                    # ページ区切り見出し（"## page-02.jpg" 等）で終了
                                    if re_page_sep.search(s):
                                        break
                                    plain = re_heading.sub('', s)
                                    if plain.startswith('>'):
                                        plain = plain[1:].strip()
                                    if plain:
                                        ocr_lines.append(plain)
                                k += 1
                            j = k
                        break
                    elif stripped == '':
                        j += 1
                    elif re_image.search(lines[j]):
                        break
                    else:
                        break

                page_num = len(pages) + 1
                pages.append({
                    "page": page_num,
                    "image_name": image_name,
                    "image_link": image_link,
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
