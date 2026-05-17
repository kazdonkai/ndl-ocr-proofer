from backend.text_processor import OCRTextProcessor

test_markdown = """
# 事件ノート

![[image.jpg]]

この画像は証拠資料です。

> [!ocr]
> 翻刻テキスト一行目
> 翻刻テキスト二行目

別のセクション
"""

test_markdown_multi_newline = """
![[image.jpg]]


> [!ocr]
> 離れていても抽出できるか
"""

def test():
    print("--- Test 1: With description between image and ocr ---")
    result1 = OCRTextProcessor.get_clean_text(test_markdown)
    print(f"Result: '{result1}'")
    
    print("\n--- Test 2: With multiple newlines ---")
    result2 = OCRTextProcessor.get_clean_text(test_markdown_multi_newline)
    print(f"Result: '{result2}'")

if __name__ == "__main__":
    test()
