import os
import re
import shutil
import subprocess
import uuid
import unicodedata
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

VAULT_ROOT = Path(os.environ["VAULT_ROOT"])
OCR_ENGINE_PATH = Path(os.environ["OCR_ENGINE_PATH"])
TEMP_ROOT = Path(os.getenv("OCR_TEMP_ROOT", "/tmp/ocr_temp"))
TEMP_IMAGE_DIR = TEMP_ROOT / "images"
TEMP_OCR_DIR = TEMP_ROOT / "ocr_raw"

def ocr_image(image_path: Path) -> str:
    """NDL古典籍OCRを実行し、テキストを返す"""
    session_id = str(uuid.uuid4())[:8]
    img_temp_dir = TEMP_IMAGE_DIR / session_id
    ocr_temp_dir = TEMP_OCR_DIR / session_id
    
    img_temp_dir.mkdir(parents=True, exist_ok=True)
    ocr_temp_dir.mkdir(parents=True, exist_ok=True)

    shutil.copy2(image_path, img_temp_dir)

    venv_python = OCR_ENGINE_PATH / ".venv" / "bin" / "python"
    ocr_script = OCR_ENGINE_PATH / "src" / "ocr.py"
    cmd = [
        str(venv_python), str(ocr_script),
        "--sourcedir", str(img_temp_dir),
        "--output", str(ocr_temp_dir)
    ]
    
    try:
        subprocess.run(cmd, check=True, cwd=OCR_ENGINE_PATH / "src", capture_output=True)
    except subprocess.CalledProcessError as e:
        print(f"OCR Error for {image_path.name}: {e.stderr.decode()}")
        shutil.rmtree(img_temp_dir, ignore_errors=True)
        shutil.rmtree(ocr_temp_dir, ignore_errors=True)
        return ""

    txt_files = list(ocr_temp_dir.glob("*.txt"))
    text = ""
    if txt_files:
        with open(txt_files[0], "r", encoding="utf-8") as f:
            text = f.read().strip()
    
    shutil.rmtree(img_temp_dir, ignore_errors=True)
    shutil.rmtree(ocr_temp_dir, ignore_errors=True)
    
    return text

def ocr_single_page(image_path: Path) -> str:
    """1枚の画像に対してOCRを実行し、テキストを返す。失敗時は空文字。"""
    return ocr_image(image_path)


def process_and_run_ocr(md_path_str: str) -> bool:
    md_path = Path(md_path_str)
    if not md_path.exists():
        return False

    with open(md_path, "r", encoding="utf-8") as f:
        content = f.read()

    # 1. 既存の画像リンクをすべて抽出
    img_links = []
    for match in re.finditer(r"!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]", content):
        img_links.append(match.group(1).strip())
    for match in re.finditer(r"!\[.*?\]\((.+?)\)", content):
        img_links.append(match.group(1).strip())

    if not img_links:
        return False

    # 2. 実際の画像ファイルパスを特定
    note_parent = md_path.parent
    root_files = VAULT_ROOT / "files"
    target_files_dir = note_parent / "files"
    target_files_dir.mkdir(exist_ok=True)

    images_to_process = []
    for link in img_links:
        img_name = Path(link).name
        # NFC正規化して検索
        img_name_nfc = unicodedata.normalize('NFC', img_name)
        
        potential_paths = [
            note_parent / link,
            note_parent / "files" / img_name,
            root_files / img_name,
        ]
        
        found = False
        for p in potential_paths:
            # パス文字列をNFCに
            p_str = unicodedata.normalize('NFC', str(p))
            p_nfc = Path(p_str)
            if p_nfc.exists() and p_nfc.is_file():
                images_to_process.append(p_nfc)
                found = True
                break
        
        # 見つからない場合はNFCでのglobを試す
        if not found:
            for f in root_files.glob(f"*{img_name_nfc}*"):
                if f.is_file():
                    images_to_process.append(f)
                    found = True
                    break

    # 重複排除
    unique_images = []
    seen = set()
    for img in images_to_process:
        if str(img) not in seen:
            seen.add(str(img))
            unique_images.append(img)

    if not unique_images:
        return False

    # 3. リネーム・移動・OCR実行
    note_stem = unicodedata.normalize('NFC', md_path.stem)
    new_image_sections = []
    
    for i, src in enumerate(unique_images):
        seq = i + 1
        new_name = f"{note_stem}_{seq:02d}{src.suffix.lower()}"
        dest = target_files_dir / new_name
        
        # リネームして移動
        if str(src) != str(dest):
            if not dest.exists():
                shutil.move(str(src), str(dest))
        
        # OCR実行
        ocr_text = ocr_image(dest)
        
        # コールアウト形式のブロック作成
        block = f"- [ ] ![[files/{new_name}]]"
        if ocr_text:
            block += "\n> [!ocr]"
            for t_line in ocr_text.split("\n"):
                block += f"\n> {t_line}"
        
        new_image_sections.append(block)

    # 4. コンテンツの整形
    # 既存の画像リンク行やOCR結果行を削除
    lines = content.split("\n")
    cleaned_lines = []
    skip_mode = False

    for line in lines:
        if re.search(r'>\s*\[!ocr\]', line, re.IGNORECASE):
            skip_mode = True
            continue
        
        if skip_mode:
            if line.startswith(">"):
                continue
            else:
                skip_mode = False
                
        if re.search(r"!\[\[.*?\]\]", line) or re.search(r"!\[.*?\]\(.*?\)", line):
            continue
            
        cleaned_lines.append(line)

    # 末尾の余分な空行を削除
    while cleaned_lines and cleaned_lines[-1].strip() == "":
        cleaned_lines.pop()

    # ## 記録 の位置を探して直後に画像を挿入
    record_idx = -1
    for i, line in enumerate(cleaned_lines):
        if line.strip() == "## 記録":
            record_idx = i
            break
            
    images_str = "\n\n" + "\n\n".join(new_image_sections) + "\n\n"
    if record_idx != -1:
        cleaned_lines.insert(record_idx + 1, images_str)
        final_content = "\n".join(cleaned_lines) + "\n"
    else:
        final_content = "\n".join(cleaned_lines) + "\n\n## 記録" + images_str

    # フロントマターの status または minji_status を 3 に更新
    fm_match = re.match(r"^---\n(.*?)\n---", final_content, re.DOTALL)
    if fm_match:
        fm_content = fm_match.group(1)
        if re.search(r"^minji_status:", fm_content, re.MULTILINE):
            fm_content = re.sub(r"^minji_status:.*$", "minji_status: 3", fm_content, flags=re.MULTILINE)
        elif re.search(r"^status:", fm_content, re.MULTILINE):
            fm_content = re.sub(r"^status:.*$", "status: 3", fm_content, flags=re.MULTILINE)
        else:
            fm_content += "\nstatus: 3"
            
        final_content = f"---\n{fm_content}\n---" + final_content[fm_match.end():]

    # 5. 保存
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(final_content)

    return True
