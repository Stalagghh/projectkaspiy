"""Pydantic models that mirror packages/contracts/src/ml.ts field by field.

Field names are written exactly as they appear in the JSON (camelCase), so the
contract can be checked by reading the two files side by side.
"""

from datetime import date
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

AudioLabel = Literal["boat_engine", "gunshot", "background"]
Qualitative = Literal["high", "medium", "low"]


class ClassScore(BaseModel):
    name: str
    score: float = Field(ge=0, le=1)


class ModelInfo(BaseModel):
    name: str
    version: str
    sha256: str
    labelMapVersion: str


class Health(BaseModel):
    status: Literal["ok"]
    modelLoaded: bool
    model: ModelInfo


class LabelScores(BaseModel):
    boat_engine: float = Field(ge=0, le=1)
    gunshot: float = Field(ge=0, le=1)
    background: float = Field(ge=0, le=1)


class Window(BaseModel):
    startS: float
    endS: float
    scores: LabelScores
    topK: list[ClassScore]


class Event(BaseModel):
    label: Literal["boat_engine", "gunshot"]
    confidence: float = Field(ge=0, le=1)
    startS: float
    endS: float


class Summary(BaseModel):
    label: AudioLabel
    confidence: float = Field(ge=0, le=1)
    qualitative: Qualitative
    topK: list[ClassScore]


class Thresholds(BaseModel):
    """PRELIMINARY thresholds until they are tuned on a validation set (MODEL_CARD)."""

    boat_engine: float
    gunshot: float


class ClassifyResponse(BaseModel):
    model: ModelInfo
    durationS: float = Field(ge=0)
    sampleRate: int = Field(gt=0)
    windows: list[Window]
    events: list[Event]
    summary: Summary
    thresholds: Thresholds
    spectrogramPng: str | None


# ---------- Forecast ----------

FactorName = Literal["season", "wind", "waves", "sst", "haulout"]


class DataSource(BaseModel):
    name: str
    kind: Literal["real", "synthetic"]
    asOf: str


class HydrologySources(BaseModel):
    wind: DataSource
    waves: DataSource
    sst: DataSource


class Hydrology(BaseModel):
    date: date
    windSpeedMs: float = Field(ge=0)
    waveHeightM: float = Field(ge=0)
    sstC: float
    sources: HydrologySources


class Cell(BaseModel):
    id: int
    lat: float
    lon: float
    distHauloutKm: float = Field(ge=0)
    distCoastKm: float = Field(ge=0)


class ForecastRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    areaId: str
    issuedAt: AwareDatetime
    startDate: date
    days: int = Field(ge=1, le=7)
    cells: list[Cell]
    hydrology: list[Hydrology]


class Factor(BaseModel):
    name: FactorName
    value: float
    unit: str
    contribution: float  # log-odds; positive raises presence


class CellForecast(BaseModel):
    id: int
    presence: float = Field(ge=0, le=1)
    level: Literal["low", "medium", "high"]
    factors: list[Factor]


class DayForecast(BaseModel):
    date: date
    cells: list[CellForecast]
    summaryRu: str
    summaryEn: str


class ForecastModelInfo(BaseModel):
    name: str
    version: str
    simplified: Literal[True]


class ForecastResponse(BaseModel):
    model: ForecastModelInfo
    days: list[DayForecast]
    assumptions: list[str]
