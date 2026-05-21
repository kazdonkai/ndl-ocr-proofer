# Phase 1-c: File-context domain hint builder.
# Builds a {term: bonus_score} dict from file metadata so CandidateEngine can
# rank domain-relevant proper nouns higher without forcing a conversion.
#
# Scoring formula in CandidateEngine:
#   final_score = shape_score + context_score + domain_hint_bonus.get(candidate, 0.0)
#
# Guard: bonus only — never forces a replacement.

import os
import re
from pathlib import Path
from typing import Optional

# ── Bonus tiers ────────────────────────────────────────────────────────────────

_BONUS_PROPER_NOUN_YAML = 30.0   # proper_nouns.yaml hit + context match
_BONUS_REGION_ALIAS     = 20.0   # region alias / historical province name
_BONUS_METADATA_TOKEN   = 15.0   # token from filename / frontmatter fields

# ── Bonus caps ─────────────────────────────────────────────────────────────────
# shape_score = 50.0, context_score = 100.0+ なので:
#   REGIONAL_BONUS_MAX: regional bonus が shape_score の 80% を超えない上限
#   STANDALONE_BONUS_MAX: 辞書・字形テーブルにない bonus-only 候補の上限
#     → shape_score(50) の半分以下に設定し、字形候補より必ず下位にする
REGIONAL_BONUS_MAX   = 40.0   # regional proper_noun の weight 後スコア上限
STANDALONE_BONUS_MAX = 25.0   # bonus-only 候補（辞書・字形なし）のスコア上限

# ── Region alias table (historical provinces) ─────────────────────────────────

_REGION_ALIASES: dict[str, list[str]] = {
    '大阪': ['大阪', '大坂', '浪速', '摂津'],
    '京都': ['京都', '山城', '洛'],
    '奈良': ['奈良', '大和', '大倭'],
    '滋賀': ['滋賀', '近江', '江州'],
    '和歌山': ['和歌山', '紀伊', '紀州'],
    '群馬': ['群馬', '上野', '上州'],
    '長野': ['長野', '信濃', '信州'],
    '山梨': ['山梨', '甲斐', '甲州'],
    '青森': ['青森', '陸奥', '南部'],
    '宮城': ['宮城', '陸前', '仙台'],
    '秋田': ['秋田', '羽後', '出羽'],
    '熊本': ['熊本', '肥後'],
    '静岡': ['静岡', '駿河', '遠江'],
    '愛知': ['愛知', '尾張', '三河'],
    '三重': ['三重', '伊勢', '伊賀', '志摩'],
    '鳥取': ['鳥取', '因幡', '伯耆'],
    '沖縄': ['沖縄', '琉球'],
}

_PREF_NAMES: list[str] = list(_REGION_ALIASES.keys())

# alias/旧国名 → 都道府県正規名 への逆引き
_REGION_NORMALIZE: dict[str, str] = {}
for _pref, _aliases in _REGION_ALIASES.items():
    for _alias in _aliases:
        _REGION_NORMALIZE[_alias] = _pref

# 都道府県正規名 → regional seed ファイルキー（全47都道府県）
_REGION_FILE_KEY: dict[str, str] = {
    '北海道': 'hokkaido',
    '青森':   'aomori',
    '岩手':   'iwate',
    '宮城':   'miyagi',
    '秋田':   'akita',
    '山形':   'yamagata',
    '福島':   'fukushima',
    '茨城':   'ibaraki',
    '栃木':   'tochigi',
    '群馬':   'kozuke',
    '埼玉':   'saitama',
    '千葉':   'chiba',
    '東京':   'tokyo',
    '神奈川': 'kanagawa',
    '新潟':   'niigata',
    '富山':   'toyama',
    '石川':   'ishikawa',
    '福井':   'fukui',
    '山梨':   'yamanashi',
    '長野':   'shinano',
    '岐阜':   'gifu',
    '静岡':   'shizuoka',
    '愛知':   'aichi',
    '三重':   'mie',
    '滋賀':   'shiga',
    '京都':   'kyoto',
    '大阪':   'osaka',
    '兵庫':   'hyogo',
    '奈良':   'nara',
    '和歌山': 'wakayama',
    '鳥取':   'tottori',
    '島根':   'shimane',
    '岡山':   'okayama',
    '広島':   'hiroshima',
    '山口':   'yamaguchi',
    '徳島':   'tokushima',
    '香川':   'kagawa',
    '愛媛':   'ehime',
    '高知':   'kochi',
    '福岡':   'fukuoka',
    '佐賀':   'saga',
    '長崎':   'nagasaki',
    '熊本':   'kumamoto',
    '大分':   'oita',
    '宮崎':   'miyazaki',
    '鹿児島': 'kagoshima',
    '沖縄':   'okinawa',
}

_SPLIT_RE = re.compile(r'[_\-\s　・]+')


# ── Builder ────────────────────────────────────────────────────────────────────

class FileContextHintBuilder:
    """
    Builds domain_hint_bonus for CandidateEngine.generate().

    Inputs (all optional):
      filename    — markdown file stem
      frontmatter — parsed YAML dict (keys: title, collection, region, year, subject, …)
      proper_nouns_path — path to proper_nouns.yaml (if available)

    Output:
      { term: bonus_score }  — additive bonus on top of base shape/context scores
    """

    def build(
        self,
        filename: str = "",
        frontmatter: Optional[dict] = None,
        dict_dir: Optional[str] = None,
        # backward compat: ignored if dict_dir is provided
        proper_nouns_path: Optional[str] = None,
        body_text: str = "",
    ) -> "tuple[dict[str, float], set[str], dict, set[str]]":
        """
        Returns:
          hints             — {term: bonus_score} additive bonus dict
          proper_noun_terms — set of terms that came from proper_nouns yaml
          region_info       — {"region": str, "region_multiplier": float}
          geo_noun_terms    — subset of proper_noun_terms from prefectures + regional yaml
                              (NOT from core.yaml). Used to suppress noisy 2-char geo aliases.
        """
        hints: dict[str, float] = {}
        proper_noun_terms: set[str] = set()
        geo_noun_terms: set[str] = set()
        fm = frontmatter or {}

        # ── 2. Region — normalize alias/旧国名 → 都道府県正規名 ───────────────
        # (先に region を決定することで、step 1 のトークンボーナスに multiplier を適用できる)
        raw_region = str(fm.get('region', '') or self._region_from_text(filename))
        region = _REGION_NORMALIZE.get(raw_region, raw_region)

        # region presence check: body_text 中に region aliases が出現するか
        # → 出現なしなら frontmatter.region が誤っている可能性高い → regional bonus を抑制
        region_multiplier = self._compute_region_multiplier(region, body_text)

        # region alias names (region mismatch 時はこれらのメタデータトークンも抑制する)
        _region_alias_tokens: set[str] = set(_REGION_ALIASES.get(region, [region])) if region else set()

        # ── 1. Tokens from filename and frontmatter metadata ──────────────────
        # region 名トークン（愛知・信濃など）は region_multiplier を適用して mismatch 時に抑制
        for token in self._extract_tokens(filename, fm):
            if len(token) >= 2:
                if token in _region_alias_tokens:
                    effective = _BONUS_METADATA_TOKEN * region_multiplier
                else:
                    effective = _BONUS_METADATA_TOKEN
                if effective > 0:
                    hints[token] = hints.get(token, 0.0) + effective

        if region:
            for alias in _region_alias_tokens:
                effective_alias_bonus = _BONUS_REGION_ALIAS * region_multiplier
                if effective_alias_bonus > 0:
                    hints[alias] = hints.get(alias, 0.0) + effective_alias_bonus

        # ── 3. proper_nouns 辞書 ─────────────────────────────────────────────
        if dict_dir:
            # core: 全国共通語 — キャップなし、region_multiplier 適用しない
            core_path = os.path.join(dict_dir, "proper_nouns.core.yaml")
            if os.path.exists(core_path):
                for term, score in self._load_proper_nouns(core_path, region).items():
                    hints[term] = hints.get(term, 0.0) + score
                    proper_noun_terms.add(term)

            # prefectures: 全国共通地理語（都道府県名・旧国名）— REGIONAL_BONUS_MAX でキャップ
            # core から分離された地理辞書。bonus-only 候補として機能し、
            # regional ファイルの高 weight エントリ（region一致時）に優先度で負ける設計
            pref_path = os.path.join(dict_dir, "proper_nouns.prefectures.yaml")
            if os.path.exists(pref_path):
                for term, score in self._load_proper_nouns(
                    pref_path, region, score_cap=REGIONAL_BONUS_MAX
                ).items():
                    hints[term] = hints.get(term, 0.0) + score
                    proper_noun_terms.add(term)
                    geo_noun_terms.add(term)  # 地名 alias ノイズ抑制対象

            # regional: REGIONAL_BONUS_MAX でキャップ、region_multiplier 適用
            if region:
                region_key = _REGION_FILE_KEY.get(region)
                if region_key:
                    regional_path = os.path.join(
                        dict_dir, f"proper_nouns.regions.{region_key}.yaml"
                    )
                    if os.path.exists(regional_path):
                        for term, score in self._load_proper_nouns(
                            regional_path, region, score_cap=REGIONAL_BONUS_MAX
                        ).items():
                            effective = score * region_multiplier
                            if effective > 0:
                                hints[term] = hints.get(term, 0.0) + effective
                                proper_noun_terms.add(term)
                                geo_noun_terms.add(term)  # 地名 alias ノイズ抑制対象

        elif proper_nouns_path:
            # 旧インターフェース: 単一ファイル指定（後方互換）
            for term, score in self._load_proper_nouns(proper_nouns_path, region).items():
                hints[term] = hints.get(term, 0.0) + score
                proper_noun_terms.add(term)

        region_info = {"region": region, "region_multiplier": region_multiplier}
        return hints, proper_noun_terms, region_info, geo_noun_terms

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _extract_tokens(self, filename: str, fm: dict) -> list[str]:
        tokens: list[str] = []
        # filename stem
        stem = Path(filename).stem if filename else ''
        tokens.extend(_SPLIT_RE.split(stem))
        # frontmatter scalar / list fields
        for key in ('title', 'collection', 'region', 'subject', 'series'):
            val = fm.get(key)
            if isinstance(val, str) and val:
                tokens.extend(_SPLIT_RE.split(val))
            elif isinstance(val, list):
                for v in val:
                    if isinstance(v, str):
                        tokens.extend(_SPLIT_RE.split(v))
        return [t.strip() for t in tokens if t.strip()]

    def _region_from_text(self, text: str) -> str:
        for pref in _PREF_NAMES:
            if pref in text:
                return pref
        return ''

    def _compute_region_multiplier(self, region: str, body_text: str) -> float:
        """
        body_text 中に region の aliases が出現する回数に基づき、
        regional bonus の減衰係数を返す。
          0 回 → 0.0 (frontmatter.region が誤っている可能性が高い)
          1 回 → 0.5
          2 回以上 → 1.0
        region 未指定 or body_text 未指定 → 1.0（デフォルト通り）
        """
        if not region or not body_text:
            return 1.0
        aliases = _REGION_ALIASES.get(region, [region])
        hit_count = sum(body_text.count(a) for a in aliases)
        if hit_count == 0:
            return 0.0
        elif hit_count == 1:
            return 0.5
        else:
            return 1.0

    def _load_proper_nouns(
        self,
        path: str,
        region: str,
        score_cap: Optional[float] = None,
    ) -> dict[str, float]:
        """
        Load proper_nouns.yaml.

        score_cap: regional ファイル読み込み時に適用するスコア上限。
          None (core) → 上限なし
          REGIONAL_BONUS_MAX → weight 後のスコアをキャップし、
            shape_score(50) を不当に超えないよう抑制する。

        Supports two formats:
          - Legacy: top-level list of {term, variants, region}
          - Current: {version, entries: [{term, type, aliases, regions, weight, note}]}

        Region filtering:
          - `regions` empty (or absent) → global, included for all documents
          - `regions` non-empty → only included when document's region matches

        Falls back gracefully if file not found or yaml not installed.
        """
        try:
            import yaml  # optional dep — graceful fallback
            with open(path, encoding='utf-8') as f:
                data = yaml.safe_load(f)

            # Resolve top-level format
            if isinstance(data, dict):
                entries = data.get('entries', [])
            else:
                entries = data or []

            result: dict[str, float] = {}
            for entry in entries:
                term = entry.get('term', '')
                if not term:
                    continue

                # Build effective regions list (new `regions` list or legacy `region` str)
                entry_regions: list[str] = []
                new_regions = entry.get('regions')
                if isinstance(new_regions, list):
                    entry_regions = [r for r in new_regions if isinstance(r, str) and r]
                elif isinstance(new_regions, str) and new_regions:
                    entry_regions = [new_regions]
                legacy_region = entry.get('region', '')
                if legacy_region and legacy_region not in entry_regions:
                    entry_regions.append(legacy_region)

                # Skip entries that specify regions not matching the current document
                if entry_regions and region and region not in entry_regions:
                    continue

                weight = float(entry.get('weight', 1.0))
                score = _BONUS_PROPER_NOUN_YAML * weight
                if score_cap is not None:
                    score = min(score, score_cap)

                result[term] = max(result.get(term, 0.0), score)

                # Aliases (new) or variants (legacy)
                aliases = entry.get('aliases') or entry.get('variants') or []
                for v in aliases:
                    if isinstance(v, str):
                        alias_score = score * 0.85
                        result[v] = max(result.get(v, 0.0), alias_score)

            return result
        except Exception:
            return {}
