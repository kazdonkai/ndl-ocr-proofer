# Phase 1-b: Document-level particle script heuristic.
# Determines whether a document uses katakana or hiragana for function particles,
# to guide candidate ranking and bulk-correction proposals in CandidateEngine.
#
# Guard: read-only analysis only. No automatic bulk replacement.
# CandidateEngine uses the result to boost katakana candidates when
# particle_script == 'katakana_dominant', or flag hiragana-for-katakana mismatches.

import re
from dataclasses import dataclass


def _hira_to_kata(char: str) -> str:
    """ひらがな1文字をカタカナに変換。変換不能な場合はそのまま返す。"""
    code = ord(char)
    if 0x3041 <= code <= 0x3096:
        return chr(code + 0x60)
    return char

# ── Constants ──────────────────────────────────────────────────────────────────

_KANJI = r'[一-龠々]'
_KANJI_KATA = r'[一-龠々ァ-ヶ]'

# (katakana, hiragana) pairs targeted for style analysis
PARTICLE_PAIRS: list[tuple[str, str]] = [
    ('ハ', 'は'),
    ('ニ', 'に'),
    ('ヲ', 'を'),
    ('ノ', 'の'),  # 語中ノは除外: preceding char must be kanji (not katakana)
    ('ト', 'と'),
    ('ヘ', 'へ'),
    ('テ', 'て'),
]

KATA_PARTICLES: frozenset[str] = frozenset(k for k, _ in PARTICLE_PAIRS)
HIRA_PARTICLES: frozenset[str] = frozenset(h for _, h in PARTICLE_PAIRS)

# Pre-compiled context patterns.
# Require: preceded by kanji (CJK) AND followed by kanji-or-katakana.
# ノ/の: stricter — preceded by kanji only (excludes mid-katakana-word ノ like ノート).
_CTX: dict[str, re.Pattern] = {}
for _kata, _hira in PARTICLE_PAIRS:
    _pre = _KANJI if _kata == 'ノ' else _KANJI_KATA
    _CTX[_kata] = re.compile(rf'(?<={_pre}){re.escape(_kata)}(?={_KANJI_KATA})')
    _CTX[_hira] = re.compile(rf'(?<={_pre}){re.escape(_hira)}(?={_KANJI_KATA})')

# Exclusion patterns
_KUTEN_RE = re.compile(r'。')     # 句点行: modern punctuation → skip
_MODERN_MARKERS = re.compile(     # 近代文マーカー（括弧内注記等）
    r'[（(「」）)]|（\d'
)

DOMINANCE_THRESHOLD = 0.70   # kata_ratio ≥ 0.70 → katakana_dominant
MIN_PARTICLES = 10            # 観測数がこれ未満なら 'insufficient'


# ── Result dataclass ───────────────────────────────────────────────────────────

@dataclass
class DocumentStyleHints:
    particle_script: str    # 'katakana_dominant' | 'mixed' | 'hiragana_dominant' | 'insufficient'
    kata_particle_count: int
    hira_particle_count: int
    kata_ratio: float
    total_particles: int

    def to_dict(self) -> dict:
        return {
            'particle_script': self.particle_script,
            'kata_particle_count': self.kata_particle_count,
            'hira_particle_count': self.hira_particle_count,
            'kata_ratio': round(self.kata_ratio, 3),
            'total_particles': self.total_particles,
        }


# ── Analyzer ───────────────────────────────────────────────────────────────────

class ParticleScriptAnalyzer:
    """
    Scans full document text and classifies its particle-script style.

    Usage in CandidateEngine:
      - katakana_dominant → boost katakana particle candidates; surface hira→kata proposals
      - hiragana_dominant → boost hiragana candidates (rare in classical docs)
      - mixed / insufficient → no style-based boost; rely on shape_score + context_score
    """

    def analyze(self, text: str) -> DocumentStyleHints:
        kata_count = 0
        hira_count = 0

        for line in text.splitlines():
            # 除外: 句点行
            if _KUTEN_RE.search(line):
                continue
            # 除外: 近代文マーカーが多い行（注記・読点混じり）
            if _MODERN_MARKERS.search(line):
                continue

            for kata, hira in PARTICLE_PAIRS:
                for m in _CTX[kata].finditer(line):
                    if m.end() >= len(line):   # 除外: 行末位置
                        continue
                    kata_count += 1
                for m in _CTX[hira].finditer(line):
                    if m.end() >= len(line):
                        continue
                    hira_count += 1

        total = kata_count + hira_count
        if total < MIN_PARTICLES:
            return DocumentStyleHints(
                particle_script='insufficient',
                kata_particle_count=kata_count,
                hira_particle_count=hira_count,
                kata_ratio=0.0,
                total_particles=total,
            )

        kata_ratio = kata_count / total
        if kata_ratio >= DOMINANCE_THRESHOLD:
            script = 'katakana_dominant'
        elif kata_ratio <= (1.0 - DOMINANCE_THRESHOLD):
            script = 'hiragana_dominant'
        else:
            script = 'mixed'

        return DocumentStyleHints(
            particle_script=script,
            kata_particle_count=kata_count,
            hira_particle_count=hira_count,
            kata_ratio=kata_ratio,
            total_particles=total,
        )

    def detect_isolated_hira_suspects(
        self, text: str, style: 'DocumentStyleHints'
    ) -> list[dict]:
        """
        katakana_dominant 文書で、漢字/カタカナに隣接するひらがな文字を検出する。
        助詞7種に限定せず、全ひらがな文字を対象とする（'り'→'リ' 等を含む）。
        返す辞書は AIAnalyzer.analyze_document の spans リストに直接追加可能。
        '_forced_candidate' キーに変換後カタカナを格納する。
        """
        if style.particle_script != 'katakana_dominant':
            return []

        # 漢字またはカタカナに隣接するひらがな（少なくとも片側が隣接）
        _adjacent_pattern = re.compile(
            r'(?<=[一-龠々ァ-ヶ])[ぁ-ん]|[ぁ-ん](?=[一-龠々ァ-ヶ])'
        )

        seen: set[str] = set()
        results = []
        for m in _adjacent_pattern.finditer(text):
            hira = m.group()
            if hira in seen:
                continue
            seen.add(hira)
            kata = _hira_to_kata(hira)
            if kata == hira:
                continue
            results.append({
                'suspect_span': hira,
                'reason': (
                    f'カタカナ優勢文書にひらがな「{hira}」検出'
                    f' → 「{kata}」の誤認の可能性（OCRアーティファクト疑い）'
                ),
                'confidence': 0.40,
                'is_protected': False,
                '_forced_candidate': kata,
            })
        return results

    def detect_hira_bigram_suspects(
        self, text: str, style: 'DocumentStyleHints'
    ) -> list[dict]:
        """
        katakana_dominant 文書で、漢字/カタカナに隣接するひらがな2文字列を検出する。

        対象: OCRがカタカナをひらがなに誤変換した可能性のある bigram（より→ヨリ、とも→トモ等）。
        '_kata_bigram_candidate' キーに変換後カタカナ候補を格納する。
        _forced_candidate ではない（自動適用なし、UI での選択のみ有効）。
        """
        if style.particle_script != 'katakana_dominant':
            return []

        # 漢字/カタカナに隣接するひらがな2文字列（前後どちらか一方で隣接条件を満たせばよい）
        _bigram_pattern = re.compile(
            r'(?<=[一-龠々ァ-ヶ])[ぁ-ん]{2}|[ぁ-ん]{2}(?=[一-龠々ァ-ヶ])'
        )

        seen: set[str] = set()
        results = []
        for m in _bigram_pattern.finditer(text):
            bigram = m.group()
            if bigram in seen:
                continue
            seen.add(bigram)
            kata = ''.join(_hira_to_kata(c) for c in bigram)
            if kata == bigram:
                continue
            results.append({
                'suspect_span': bigram,
                'reason': (
                    f'カタカナ優勢文書にひらがな2文字「{bigram}」検出'
                    f' → 「{kata}」の誤認の可能性（OCRアーティファクト疑い）'
                ),
                'confidence': 0.45,
                'is_protected': False,
                '_kata_bigram_candidate': kata,
            })
        return results

    def mismatched_hira_positions(
        self, text: str, style: DocumentStyleHints
    ) -> list[dict]:
        """
        katakana_dominant 文書でひらがな助詞が使われている箇所を列挙する。
        CandidateEngine の「一括補正候補提示」に使う。
        自動適用しない — 補正候補として返すのみ。
        """
        if style.particle_script != 'katakana_dominant':
            return []

        results = []
        for kata, hira in PARTICLE_PAIRS:
            for m in _CTX[hira].finditer(text):
                if m.end() >= len(text):
                    continue
                # 行末・句点行・近代文行チェック
                line_start = text.rfind('\n', 0, m.start()) + 1
                line_end = text.find('\n', m.end())
                if line_end == -1:
                    line_end = len(text)
                line = text[line_start:line_end]
                if _KUTEN_RE.search(line) or _MODERN_MARKERS.search(line):
                    continue
                results.append({
                    'start': m.start(),
                    'end': m.end(),
                    'hira': hira,
                    'kata_candidate': kata,
                    'context': text[max(0, m.start() - 4):m.end() + 4],
                })
        return results
