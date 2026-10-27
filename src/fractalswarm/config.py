"""Settings from dotenv files and the environment.

Secrets live outside the repo in ``~/.fractalswarm/.env``, which every worktree shares.
A local ``.env``, if present, overrides it, and real environment variables override both.
Empty values count as unset. Secrets are ``SecretStr``: never print or log their values.
"""

from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

SHARED_ENV_FILE = Path.home() / ".fractalswarm" / ".env"
LOCAL_ENV_FILE = Path(".env")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Later files override earlier ones.
        env_file=(SHARED_ENV_FILE, LOCAL_ENV_FILE),
        env_file_encoding="utf-8",
        env_ignore_empty=True,
        extra="ignore",
    )

    model_api_key: SecretStr | None = None
    hf_token: SecretStr | None = None
    model_api_base_url: str = "https://api.meta.ai/v1"
    project_cap_usd: float = Field(
        default=150.0, gt=0, validation_alias="FRACTALSWARM_PROJECT_CAP_USD"
    )
