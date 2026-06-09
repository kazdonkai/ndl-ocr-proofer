"""
config_loader.py — 設定読み込みの単一窓口（Phase 2A 導入）

優先順位: .env > app.toml > .agent/settings.yaml (fallback) > DEFAULT

- .env はこのモジュールより前に load_dotenv 済みであること（各エントリポイントの責務）。
- app.toml が存在する場合はそちらを読む。存在しない場合は .agent/settings.yaml にフォールバック。
- .agent/settings.yaml の status.値の定義（日本語ラベル）は常に YAML から読む（TOML 非対象）。
"""
from __future__ import annotations

import logging
import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

try:
    import yaml as _yaml
except ImportError:
    _yaml = None

logger = logging.getLogger(__name__)

_BACKEND_DIR: Path = Path(__file__).parent


# ── 設定値コンテナ（型付きデータクラス） ──────────────────────────────────────


@dataclass
class OcrSettings:
    rename_images_before_ocr: bool = True
    write_status_after_ocr: bool = True


@dataclass
class DictionarySettings:
    use_experimental: bool = False


@dataclass
class StatusSettings:
    property_name: str = "minji_status"
    ocr_done_value: int = 2


@dataclass
class AutoDownweightSettings:
    mode: str = "off"


@dataclass
class PdfSettings:
    """
    PDF OCR import 設定（post-migration 実装予定）。

    実装時期: outside-Vault 移行が安定した後。
    設計文書: docs/pdf_ocr_design.md

    環境変数で管理（パス系・動作パラメータのため .env 専管）:
      PDF_ALLOWED_ROOTS  — PDFを読み込んでよいディレクトリをカンマ区切りで列挙
      PDF_RENDER_DPI     — PDF→画像変換の解像度（デフォルト 300）
      PDF_RENDER_FORMAT  — 変換フォーマット "jpg" | "png"（デフォルト "jpg"）
      PDF_CACHE_TTL_HOURS — 一時画像キャッシュの保持時間（デフォルト 24）

    pypdfium2 / PDF レンダリング / PDF API エンドポイントは未実装。
    このクラスは設定読み取り口のスタブとしてのみ存在する。
    """
    allowed_roots: list = field(default_factory=list)  # PDF_ALLOWED_ROOTS（パスリスト）
    render_dpi: int = 300                               # PDF_RENDER_DPI
    render_format: str = "jpg"                          # PDF_RENDER_FORMAT
    cache_ttl_hours: int = 24                           # PDF_CACHE_TTL_HOURS


@dataclass
class EnvInfo:
    config_file_path: str
    config_file_exists: bool
    vault_root: str
    app_data_dir: str
    dict_dir: str
    eval_dir: str
    ocr_temp_root: str
    backend_version: str = "1.1.0"


# ── ConfigLoader ──────────────────────────────────────────────────────────────


class ConfigLoader:
    """
    設定読み込みの単一窓口。main.py / ocr_runner.py で共用する。

    - ``get_config_loader()`` でシングルトンを取得すること。
    - ``reload()`` を呼ぶと toml / yaml 両方を再読み込みする。
    """

    def __init__(self) -> None:
        vault_root_raw: str = os.getenv("VAULT_ROOT", "")
        self._vault_root: str = vault_root_raw
        self._app_data_dir: str = os.getenv(
            "APP_DATA_DIR", str(_BACKEND_DIR.parent)
        )
        self._toml_path: Path = Path(self._app_data_dir) / "app.toml"
        self._yaml_path: Optional[Path] = (
            Path(vault_root_raw) / ".agent" / "settings.yaml"
            if vault_root_raw
            else None
        )
        # ロード（キャッシュ）
        self._toml_exists: bool = False
        self._toml_data: dict = {}
        self._yaml_data: Optional[dict] = None  # lazy
        self._load_toml()

    # ── 内部ローダー ──────────────────────────────────────────────────────────

    def _load_toml(self) -> None:
        """app.toml を読み込んで self._toml_data / self._toml_exists を更新する。"""
        if not self._toml_path.exists():
            self._toml_exists = False
            self._toml_data = {}
            return
        try:
            with open(self._toml_path, "rb") as f:
                self._toml_data = tomllib.load(f)
            self._toml_exists = True
        except Exception as exc:
            logger.warning("app.toml 読み込みエラー: %s", exc)
            self._toml_exists = False
            self._toml_data = {}

    def _load_yaml_lazy(self) -> dict:
        """settings.yaml を lazy load してキャッシュする。"""
        if self._yaml_data is not None:
            return self._yaml_data
        if _yaml is None or self._yaml_path is None or not self._yaml_path.exists():
            self._yaml_data = {}
            return self._yaml_data
        try:
            with open(self._yaml_path, "r", encoding="utf-8") as f:
                self._yaml_data = _yaml.safe_load(f) or {}
        except Exception as exc:
            logger.warning("settings.yaml 読み込みエラー: %s", exc)
            self._yaml_data = {}
        return self._yaml_data

    def _use_toml(self) -> bool:
        """app.toml が読み込み成功済みかどうか。"""
        return self._toml_exists

    def _get(self, section: str, key: str, default):
        """
        app.toml 存在時: toml のみ参照（yaml は無視）。
        app.toml 不在時: yaml にフォールバック。
        どちらにも値がなければ default を返す。
        """
        if self._use_toml():
            val = self._toml_data.get(section, {}).get(key)
            return val if val is not None else default
        # --- yaml fallback ---
        if not self._has_yaml_logged:
            logger.info("app.toml 不在: .agent/settings.yaml にフォールバックします")
            self._has_yaml_logged = True
        yaml_data = self._load_yaml_lazy()
        val = yaml_data.get(section, {}).get(key)
        return val if val is not None else default

    # _has_yaml_logged を遅延初期化するためのデスクリプタ代替
    @property
    def _has_yaml_logged(self) -> bool:
        return getattr(self, "_yaml_logged_flag", False)

    @_has_yaml_logged.setter
    def _has_yaml_logged(self, v: bool) -> None:
        self._yaml_logged_flag = v

    # ── 公開メソッド ──────────────────────────────────────────────────────────

    def get_ocr_settings(self) -> OcrSettings:
        """OCR 設定を返す。"""
        return OcrSettings(
            rename_images_before_ocr=bool(
                self._get("ocr", "rename_images_before_ocr", True)
            ),
            write_status_after_ocr=bool(
                self._get("ocr", "write_status_after_ocr", True)
            ),
        )

    def get_dictionary_settings(self) -> DictionarySettings:
        """辞書設定を返す。"""
        return DictionarySettings(
            use_experimental=bool(
                self._get("dictionary", "use_experimental", False)
            ),
        )

    def get_status_settings(self) -> StatusSettings:
        """
        ステータス設定を返す。
        TOML キー名（英語）と YAML キー名（日本語）の差異を吸収する。
        """
        if self._use_toml():
            prop_name = self._toml_data.get("status", {}).get(
                "property_name", "minji_status"
            )
            ocr_done_value = self._toml_data.get("status", {}).get("ocr_done_value", 2)
        else:
            yaml_data = self._load_yaml_lazy()
            status_sect = yaml_data.get("status", {})
            # YAML は日本語キー
            prop_name = status_sect.get("プロパティ名", "minji_status")
            ocr_done_value = status_sect.get("OCR完了値", 2)
        return StatusSettings(
            property_name=str(prop_name),
            ocr_done_value=int(ocr_done_value),
        )

    def get_auto_downweight_settings(self) -> AutoDownweightSettings:
        """AUTO_DOWNWEIGHT 設定を返す。"""
        return AutoDownweightSettings(
            mode=str(self._get("auto_downweight", "mode", "off")),
        )

    def get_pdf_settings(self) -> PdfSettings:
        """
        PDF OCR import 設定を返す（post-migration 実装予定・現時点はスタブ）。

        設定はすべて環境変数から読む（パス系のため .env 専管）。
        PDF レンダリング・API エンドポイントは未実装であり、
        このメソッドは将来の実装が設定読み取り口を破壊しないよう
        アーキテクチャ的な「予約」として存在する。

        実装条件: docs/pdf_ocr_design.md > Implementation Timing を参照。
        """
        raw_roots = os.getenv("PDF_ALLOWED_ROOTS", "")
        allowed_roots = [r.strip() for r in raw_roots.split(",") if r.strip()] if raw_roots else []
        return PdfSettings(
            allowed_roots=allowed_roots,
            render_dpi=int(os.getenv("PDF_RENDER_DPI", "300")),
            render_format=str(os.getenv("PDF_RENDER_FORMAT", "jpg")),
            cache_ttl_hours=int(os.getenv("PDF_CACHE_TTL_HOURS", "24")),
        )

    def get_status_labels(self) -> dict[int, str]:
        """
        status.値の定義（日本語ラベル）を返す。
        app.toml 存在時も、このメソッドは常に .agent/settings.yaml を参照する。
        （YAML 残留項目: ワークフロードキュメント的性格のため TOML 非対象）
        """
        yaml_data = self._load_yaml_lazy()
        raw = yaml_data.get("status", {}).get("値の定義", {})
        try:
            return {int(k): str(v) for k, v in raw.items()}
        except Exception:
            return {}

    def get_env_info(self) -> EnvInfo:
        """実行環境情報を返す（GET /api/config/status 用）。パス変更不可。"""
        dict_dir = os.getenv(
            "DICT_DIR", str(Path(self._app_data_dir) / "data/dictionaries")
        )
        eval_dir = os.getenv(
            "EVALUATION_DIR", str(Path(self._app_data_dir) / "evaluation/logs")
        )
        ocr_temp_root = os.getenv("OCR_TEMP_ROOT", "/tmp/ocr_temp")
        return EnvInfo(
            config_file_path=str(self._toml_path),
            config_file_exists=self._toml_exists,
            vault_root=self._vault_root,
            app_data_dir=self._app_data_dir,
            dict_dir=dict_dir,
            eval_dir=eval_dir,
            ocr_temp_root=ocr_temp_root,
            backend_version="1.1.0",
        )

    def as_config_dict(self) -> dict:
        """GET /api/config レスポンス用の全設定を dict で返す。"""
        ocr = self.get_ocr_settings()
        dictionary = self.get_dictionary_settings()
        status = self.get_status_settings()
        auto_dw = self.get_auto_downweight_settings()
        return {
            "ocr": {
                "rename_images_before_ocr": ocr.rename_images_before_ocr,
                "write_status_after_ocr": ocr.write_status_after_ocr,
            },
            "dictionary": {
                "use_experimental": dictionary.use_experimental,
            },
            "status": {
                "property_name": status.property_name,
                "ocr_done_value": status.ocr_done_value,
            },
            "auto_downweight": {
                "mode": auto_dw.mode,
            },
        }

    def reload(self) -> None:
        """app.toml および settings.yaml を再読み込みする。"""
        self._yaml_data = None
        self._yaml_logged_flag = False
        self._load_toml()
        logger.info("ConfigLoader: 設定を再読み込みしました")


# ── モジュールレベルシングルトン ──────────────────────────────────────────────

_config_loader: Optional[ConfigLoader] = None


def get_config_loader() -> ConfigLoader:
    """
    ConfigLoader のシングルトンを返す。初回呼び出し時に初期化する。
    main.py / ocr_runner.py で共用。
    """
    global _config_loader
    if _config_loader is None:
        _config_loader = ConfigLoader()
    return _config_loader
