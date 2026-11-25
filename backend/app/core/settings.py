from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    """Application settings loaded from environment variables or defaults."""

    model_config = SettingsConfigDict(
        env_prefix="ORGANUM_",
        env_file=".env",
        extra="ignore",
    )

    app_name: str = "ORGANUM"
    app_version: str = "0.1.0"
    environment: str = "development"
    debug: bool = False

    database_url: str = Field(
        default_factory=lambda: (
            f"sqlite+aiosqlite:///{(_REPO_ROOT / 'data' / 'organum.db').as_posix()}"
        )
    )
    app_db_url: str = Field(
        default_factory=lambda: (
            f"sqlite+aiosqlite:///{(_REPO_ROOT / 'data' / 'app.db').as_posix()}"
        )
    )
    bind_host: str = "127.0.0.1"
    demo_project_path: Path = Field(default_factory=lambda: _REPO_ROOT / "data" / "demo_project")
    icons_dir: Path = Field(default_factory=lambda: _REPO_ROOT / "data" / "icons")
    storage_root: Path = Field(default_factory=lambda: _REPO_ROOT / "data" / "products")
    cache_root: Path = Field(default_factory=lambda: _REPO_ROOT / "data" / "cache")

    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"]
    )
    jwt_secret: str = "organum-dev-secret-change-in-production"
    jwt_algorithm: str = "HS256"
    default_user_username: str = "artist"
    default_user_display_name: str = "Lead Artist"
    auto_scan_on_startup: bool = True
    frontend_dist_dir: Path | None = None
    ocio_config_path: str | None = None


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached settings instance."""
    return Settings()
