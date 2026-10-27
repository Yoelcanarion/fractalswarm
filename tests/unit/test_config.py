"""Settings: the shared env file loads first, a local .env overrides it, secrets stay hidden."""

from pathlib import Path

import pytest

from fractalswarm.config import Settings

ENV_VARS = ("MODEL_API_KEY", "HF_TOKEN", "FRACTALSWARM_PROJECT_CAP_USD")


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for var in ENV_VARS:
        monkeypatch.delenv(var, raising=False)


def write_env(path: Path, text: str) -> Path:
    path.write_text(text, encoding="utf-8")
    return path


def test_default_env_files_are_shared_then_local() -> None:
    shared, local = Settings.model_config["env_file"]
    assert shared == Path.home() / ".fractalswarm" / ".env"
    assert local == Path(".env")


def test_local_env_overrides_shared(tmp_path: Path) -> None:
    shared = write_env(tmp_path / "shared.env", "MODEL_API_KEY=shared-key\nHF_TOKEN=hf_shared\n")
    local = write_env(
        tmp_path / "local.env", "MODEL_API_KEY=local-key\nFRACTALSWARM_PROJECT_CAP_USD=42\n"
    )
    settings = Settings(_env_file=(shared, local))
    assert settings.model_api_key is not None
    assert settings.model_api_key.get_secret_value() == "local-key"
    assert settings.hf_token is not None
    assert settings.hf_token.get_secret_value() == "hf_shared"
    assert settings.project_cap_usd == 42


def test_empty_values_count_as_unset(tmp_path: Path) -> None:
    shared = write_env(tmp_path / "shared.env", "MODEL_API_KEY=shared-key\nHF_TOKEN=\n")
    local = write_env(tmp_path / "local.env", "MODEL_API_KEY=\n")
    settings = Settings(_env_file=(shared, local))
    assert settings.model_api_key is not None
    assert settings.model_api_key.get_secret_value() == "shared-key"
    assert settings.hf_token is None


def test_environment_overrides_env_files(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    shared = write_env(tmp_path / "shared.env", "MODEL_API_KEY=shared-key\n")
    monkeypatch.setenv("MODEL_API_KEY", "env-key")
    settings = Settings(_env_file=(shared,))
    assert settings.model_api_key is not None
    assert settings.model_api_key.get_secret_value() == "env-key"


def test_missing_files_give_defaults(tmp_path: Path) -> None:
    settings = Settings(_env_file=(tmp_path / "absent.env",))
    assert settings.model_api_key is None
    assert settings.hf_token is None
    assert settings.model_api_base_url == "https://api.meta.ai/v1"
    assert settings.project_cap_usd == 150


def test_secrets_never_appear_in_repr(tmp_path: Path) -> None:
    shared = write_env(tmp_path / "shared.env", "MODEL_API_KEY=LLM_1_secret\nHF_TOKEN=hf_secret\n")
    settings = Settings(_env_file=(shared,))
    for text in (repr(settings), str(settings), settings.model_dump_json()):
        assert "LLM_1_secret" not in text
        assert "hf_secret" not in text
