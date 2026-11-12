"""Service settings, read from environment variables.

The service refuses to start when a required setting is missing (fail fast),
so a misconfigured container never runs half-working.
"""

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Environment variable names are the upper-case field names, e.g. ML_API_TOKEN.
    model_config = SettingsConfigDict(case_sensitive=False, extra="ignore")

    # Shared secret that callers send as "Authorization: Bearer <token>". Required, no default.
    ml_api_token: str = Field(min_length=1)

    # YAMNet model files. They are not baked into the image: they are mounted read-only at /models.
    yamnet_model_path: Path = Path("/models/yamnet/yamnet_classification.tflite")
    yamnet_class_map: Path = Path("/models/yamnet/yamnet_class_map.csv")

    # Limits from the API contract (packages/contracts/src/ml.ts).
    max_upload_bytes: int = 10 * 1024 * 1024  # 10 MB
    max_duration_s: float = 60.0
    processing_timeout_s: float = 15.0


@lru_cache
def get_settings() -> Settings:
    """Read the settings once; raises a validation error if ML_API_TOKEN is missing."""
    return Settings()  # type: ignore[call-arg]
