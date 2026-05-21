# Phase 1-a: Shape confusion detector.
# Loads shape_pairs.yaml and provides scored candidate lookup for CandidateEngine.
#
# Guard: candidate scoring only — no automatic replacement.

import os
from typing import Dict, List, Optional, Tuple


DEFAULT_SCORE = 50.0

# context value used by entries that apply to all document types
_ANY = 'any'


class ShapeDetector:
    """
    Looks up visually confusable character pairs for a suspect span.
    Returns {candidate: score} for integration into CandidateEngine scoring.

    Usage:
        detector = ShapeDetector("/path/to/shape_pairs.yaml")
        result = detector.lookup("末", context="classical_jp")
        # → {"未": 45.0}
    """

    def __init__(self, yaml_path: Optional[str] = None) -> None:
        # wrong_form → [(correct, score, context), ...]
        self._table: Dict[str, List[Tuple[str, float, str]]] = {}
        if yaml_path:
            if os.path.exists(yaml_path):
                self._load(yaml_path)
            else:
                print(f"[ShapeDetector] {yaml_path} not found — table empty.")

    def _load(self, path: str) -> None:
        try:
            import yaml
            with open(path, encoding='utf-8') as f:
                data = yaml.safe_load(f)
            for entry in data.get('pairs', []):
                wrong = entry.get('wrong', '').strip()
                if not wrong:
                    continue
                corrects = entry.get('correct', [])
                if isinstance(corrects, str):
                    corrects = [corrects]
                score = float(entry.get('score', DEFAULT_SCORE))
                context = entry.get('context', _ANY)
                self._table.setdefault(wrong, [])
                for c in corrects:
                    if isinstance(c, str) and c.strip():
                        self._table[wrong].append((c.strip(), score, context))
            print(f"[ShapeDetector] Loaded {len(self._table)} wrong-form entries from {path}.")
        except Exception as e:
            print(f"[ShapeDetector] Failed to load {path}: {e}")

    def lookup(
        self,
        suspect: str,
        context: str = _ANY,
    ) -> Dict[str, float]:
        """
        Returns {candidate: score} for the given suspect form.

        Context matching:
          - entry context == 'any'  → always matches
          - entry context == doc context → matches
          - otherwise → skipped

        When multiple entries map the same wrong→correct pair at different scores,
        the highest score wins.
        """
        entries = self._table.get(suspect, [])
        if not entries:
            return {}
        result: Dict[str, float] = {}
        for correct, score, entry_ctx in entries:
            if entry_ctx == _ANY or context == _ANY or entry_ctx == context:
                if score > result.get(correct, 0.0):
                    result[correct] = score
        return result

    @property
    def entry_count(self) -> int:
        return len(self._table)
