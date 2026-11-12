"""EcoShield ML service (FastAPI).

Endpoints (contract: packages/contracts/src/ml.ts):
  GET  /healthz             no auth; model name, version, sha256 and label map version
  POST /v1/audio/classify   raw audio bytes -> labels per window, events, summary, spectrogram
  POST /v1/forecast/seal    simplified, assumption-based seal presence forecast

Errors are short JSON codes such as {"error": "audio_too_long"}; stack traces never leave the service.
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.audio.classify import classify_bytes
from app.audio.decode import AudioTooLong, UndecodableAudio, UnsupportedAudioType, detect_format
from app.audio.mapping import load_label_map
from app.audio.yamnet import Yamnet
from app.auth import require_token
from app.forecast.model import ForecastInputError, SealForecastModel
from app.schemas import ClassifyResponse, ForecastRequest, ForecastResponse, Health, ModelInfo
from app.settings import get_settings

log = logging.getLogger("ecoshield.ml")
LABEL_MAP_PATH = Path(__file__).parent / "audio" / "label_map.yaml"


class ApiError(Exception):
    """An expected error that becomes {"error": code} with the given HTTP status."""

    def __init__(self, status: int, code: str) -> None:
        self.status = status
        self.code = code


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fail fast: missing token, missing model files or a label name that is not in the
    # class map raise here, and uvicorn exits instead of serving a broken service.
    settings = get_settings()
    model = Yamnet(settings.yamnet_model_path, settings.yamnet_class_map)
    app.state.model = model
    app.state.label_map = load_label_map(LABEL_MAP_PATH, model.class_names)
    app.state.forecast = SealForecastModel.from_default_config()
    log.info("YAMNet loaded, sha256=%s", model.info.sha256)
    yield


app = FastAPI(title="EcoShield ML", version="0.1.0", lifespan=lifespan)


@app.exception_handler(ApiError)
async def api_error_handler(_request: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content={"error": exc.code})


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
    codes = {401: "unauthorized", 404: "not_found", 405: "method_not_allowed"}
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": codes.get(exc.status_code, "http_error")},
        headers=getattr(exc, "headers", None),
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_request: Request, _exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"error": "invalid_request"})


@app.exception_handler(Exception)
async def unexpected_error_handler(_request: Request, exc: Exception) -> JSONResponse:
    log.exception("unexpected error", exc_info=exc)  # details stay in the service log
    return JSONResponse(status_code=500, content={"error": "internal_error"})


def model_info(request: Request) -> ModelInfo:
    model: Yamnet = request.app.state.model
    return ModelInfo(
        name=model.info.name,
        version=model.info.version,
        sha256=model.info.sha256,
        labelMapVersion=request.app.state.label_map.version,
    )


@app.get("/healthz", response_model=Health)
async def healthz(request: Request) -> Health:
    return Health(status="ok", modelLoaded=True, model=model_info(request))


async def read_body_limited(request: Request, limit: int) -> bytes:
    """Read the request body, refusing it (413) as soon as it exceeds the limit.

    The Content-Length header is checked first; the real byte count is checked too,
    because the header can be missing (chunked upload) or wrong.
    """
    declared = request.headers.get("content-length")
    if declared is not None:
        if not declared.isdigit():
            raise ApiError(400, "bad_content_length")
        if int(declared) > limit:
            raise ApiError(413, "payload_too_large")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > limit:
            raise ApiError(413, "payload_too_large")
    return bytes(body)


@app.post(
    "/v1/audio/classify",
    response_model=ClassifyResponse,
    dependencies=[Depends(require_token)],
)
async def classify(
    request: Request,
    topK: int = Query(default=5, ge=1, le=20),  # noqa: N803 (query name fixed by the contract)
    spectrogram: bool = Query(default=True),
) -> ClassifyResponse:
    settings = get_settings()
    data = await read_body_limited(request, settings.max_upload_bytes)
    if not data:
        raise ApiError(422, "empty_body")
    if detect_format(data) is None:
        raise ApiError(415, "unsupported_media_type")

    def work() -> dict:
        return classify_bytes(
            data,
            request.app.state.model,
            request.app.state.label_map,
            top_k=topK,
            with_spectrogram=spectrogram,
            max_duration_s=settings.max_duration_s,
        )

    try:
        # Decoding and inference run in a worker thread so the server stays responsive.
        result = await asyncio.wait_for(asyncio.to_thread(work), timeout=settings.processing_timeout_s)
    except TimeoutError as exc:
        raise ApiError(504, "processing_timeout") from exc
    except UnsupportedAudioType as exc:
        raise ApiError(415, "unsupported_media_type") from exc
    except AudioTooLong as exc:
        raise ApiError(422, "audio_too_long") from exc
    except UndecodableAudio as exc:
        raise ApiError(422, "undecodable_audio") from exc
    return ClassifyResponse(model=model_info(request), **result)


@app.post(
    "/v1/forecast/seal",
    response_model=ForecastResponse,
    dependencies=[Depends(require_token)],
)
async def forecast_seal(request: Request, body: ForecastRequest) -> ForecastResponse:
    model: SealForecastModel = request.app.state.forecast
    try:
        return model.forecast(body)
    except ForecastInputError as exc:
        raise ApiError(422, exc.code) from exc
