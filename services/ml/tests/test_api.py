"""HTTP tests. Auth, size and type checks run without the model; the rest need it."""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.settings import Settings, get_settings
from tests.conftest import model_paths, needs_model, sine, wav_bytes

TOKEN = "test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture(autouse=True)
def env(monkeypatch: pytest.MonkeyPatch):
    model, class_map = model_paths()
    monkeypatch.setenv("ML_API_TOKEN", TOKEN)
    monkeypatch.setenv("YAMNET_MODEL_PATH", str(model))
    monkeypatch.setenv("YAMNET_CLASS_MAP", str(class_map))
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_settings_fail_without_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ML_API_TOKEN")
    with pytest.raises(ValueError):
        Settings()  # type: ignore[call-arg]


def test_classify_requires_token() -> None:
    client = TestClient(app)  # no "with": the model is not loaded for these checks
    assert client.post("/v1/audio/classify", content=b"RIFF").status_code == 401
    response = client.post("/v1/audio/classify", content=b"RIFF", headers={"Authorization": "Bearer nope"})
    assert response.status_code == 401
    assert response.json() == {"error": "unauthorized"}


def test_classify_rejects_large_body() -> None:
    client = TestClient(app)
    response = client.post("/v1/audio/classify", content=b"\0" * (10 * 1024 * 1024 + 1), headers=AUTH)
    assert response.status_code == 413
    assert response.json() == {"error": "payload_too_large"}


def test_classify_rejects_unknown_type() -> None:
    client = TestClient(app)
    response = client.post("/v1/audio/classify", content=b"%PDF-1.7 not audio", headers=AUTH)
    assert response.status_code == 415
    assert response.json() == {"error": "unsupported_media_type"}


@needs_model
def test_healthz_reports_model() -> None:
    with TestClient(app) as client:
        body = client.get("/healthz").json()
    assert body["status"] == "ok"
    assert body["modelLoaded"] is True
    assert body["model"]["name"] == "yamnet"
    assert len(body["model"]["sha256"]) == 64
    assert body["model"]["labelMapVersion"] == "1"


@needs_model
def test_classify_sine_end_to_end() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/v1/audio/classify?topK=3", content=wav_bytes(sine(2.0), 16_000), headers=AUTH
        )
        no_png = client.post(
            "/v1/audio/classify?spectrogram=false", content=wav_bytes(sine(1.0), 16_000), headers=AUTH
        )
    assert response.status_code == 200
    body = response.json()
    assert body["sampleRate"] == 16_000
    assert body["durationS"] == pytest.approx(2.0)
    assert len(body["windows"]) == 4  # 0.00, 0.48, 0.96, 1.44 s; the last one is zero-padded
    assert all(len(w["topK"]) == 3 for w in body["windows"])
    assert body["summary"]["label"] in {"boat_engine", "gunshot", "background"}
    assert body["spectrogramPng"]
    assert no_png.json()["spectrogramPng"] is None


@needs_model
def test_classify_rejects_too_long_and_undecodable() -> None:
    with TestClient(app) as client:
        too_long = client.post(
            "/v1/audio/classify", content=wav_bytes(sine(61.0, rate=8_000), 8_000), headers=AUTH
        )
        broken = client.post("/v1/audio/classify", content=b"RIFF\0\0\0\0WAVEbroken", headers=AUTH)
    assert (too_long.status_code, too_long.json()) == (422, {"error": "audio_too_long"})
    assert (broken.status_code, broken.json()) == (422, {"error": "undecodable_audio"})


@needs_model
def test_forecast_endpoint() -> None:
    from tests.test_forecast import request

    with TestClient(app) as client:
        response = client.post("/v1/forecast/seal", json=request(days=2), headers=AUTH)
        unauthorized = client.post("/v1/forecast/seal", json=request())
    assert response.status_code == 200
    assert response.json()["model"]["simplified"] is True
    assert unauthorized.status_code == 401
