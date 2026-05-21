import re
from typing import Any


class DocumentType:
    CLASSICAL = "classical"
    MODERN = "modern"
    UNKNOWN = "unknown"


class DocumentTypeDetector:
    """
    OCRテキストの言語特徴からドキュメント種別（classical/modern/unknown）を推定する。
    frontmatter に document_type キーがある場合はそれを優先する。

    実測根拠（明治18年名古屋控訴裁判所文書, 69,409文字）:
      漢字率 58.8%, カタカナ率 32.2%, ひらがな率 2.1%
      kata/(kata+hira) = 0.94, 古文末パターン多数, 現代語マーカー 0.007%
    """

    # 古文末・文語的表現（漢文訓読・候文・カタカナ助詞前提の文体）
    _CLASSICAL_PAT = re.compile(
        r'ナリ|タリ|ベシ|ケリ|テフ|ヲ以テ|ヲモテ|ニ付|ノコト|ノ義|ノ儀'
        r'|ニ係ル|ニ関スル|ニ対シ|候|仕候|申候|右候|以上候|御座候'
    )

    # 現代語マーカー（ひらがな主体の口語・標準語文体）
    _MODERN_PAT = re.compile(
        r'です|ます|ません|ください|について|における|に関して'
        r'|した[。\n]|する[。\n]|される|られる|させる|できる'
    )

    def detect(self, text: str, frontmatter: dict[str, Any] | None = None) -> dict:
        """
        Returns:
            {
              "type": "classical" | "modern" | "unknown",
              "confidence": 0.0–1.0,
              "source": "frontmatter" | "heuristic" | "insufficient_text",
              "signals": { ... }   # heuristic のときのみ
            }
        """
        # 0. frontmatter による明示的オーバーライド
        if frontmatter:
            explicit = str(frontmatter.get("document_type", "")).lower()
            if explicit in (DocumentType.CLASSICAL, DocumentType.MODERN):
                return {"type": explicit, "confidence": 1.0, "source": "frontmatter"}
            # era フィールドによる補完（候文・漢文訓読文体の史料に対応）
            era_raw = str(frontmatter.get("era", ""))
            _CLASSICAL_ERAS = ["明治", "大正", "江戸", "慶長", "文久", "安政", "天保",
                               "文政", "寛政", "享保", "元禄", "寛永", "元和", "文禄",
                               "天正", "永禄", "天文", "大永", "明応", "延徳"]
            if any(era in era_raw for era in _CLASSICAL_ERAS):
                return {"type": DocumentType.CLASSICAL, "confidence": 0.75, "source": "frontmatter_era"}

        if not text or len(text) < 100:
            return {"type": DocumentType.UNKNOWN, "confidence": 0.0, "source": "insufficient_text"}

        n = len(text)
        kata = sum(1 for c in text if "゠" <= c <= "ヿ")
        hira = sum(1 for c in text if "ぁ" <= c <= "ゟ")
        total_kana = kata + hira

        kata_ratio = kata / n
        kata_kana_ratio = kata / total_kana if total_kana > 0 else 0.5

        classical_count = len(self._CLASSICAL_PAT.findall(text))
        modern_count = len(self._MODERN_PAT.findall(text))
        classical_density = classical_count / max(n / 100, 1)
        modern_density = modern_count / max(n / 100, 1)

        # スコアリング（プラス = classical, マイナス = modern）
        score = 0.0
        if kata_ratio > 0.20:
            score += 2.0
        elif kata_ratio > 0.10:
            score += 1.0

        if kata_kana_ratio > 0.85:
            score += 2.0
        elif kata_kana_ratio > 0.60:
            score += 1.0

        if classical_density > 0.5:
            score += 1.5
        elif classical_density > 0.1:
            score += 0.5

        if modern_density > 0.1:
            score -= 3.0
        elif modern_density > 0.01:
            score -= 1.0

        if score >= 2.5:
            # 2.5 に下げた理由: 首紙・短ページは漢字密度が高く kata_ratio が低くなりやすい。
            # kata_kana_ratio > 0.60 (+1.0) + classical_density > 0.50 (+1.5) = 2.5 で
            # 十分に古文書判定が安定する（modern が 2.5 に届くことはほぼ不可能）。
            doc_type = DocumentType.CLASSICAL
            confidence = min(1.0, score / 5.5)
        elif score <= -2.0:
            doc_type = DocumentType.MODERN
            confidence = min(1.0, abs(score) / 5.0)
        else:
            doc_type = DocumentType.UNKNOWN
            confidence = 0.3

        return {
            "type": doc_type,
            "confidence": round(confidence, 2),
            "source": "heuristic",
            "signals": {
                "kata_ratio": round(kata_ratio, 3),
                "kata_kana_ratio": round(kata_kana_ratio, 3),
                "classical_density": round(classical_density, 2),
                "modern_density": round(modern_density, 2),
            },
        }
