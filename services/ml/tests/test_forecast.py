import copy
from datetime import date

import pytest

from app.forecast.model import (
    DISCLAIMER_EN,
    DISCLAIMER_RU,
    FACTOR_ORDER,
    ForecastInputError,
    SealForecastModel,
    season_log_odds,
)
from app.schemas import ForecastRequest

SOURCE = {"name": "test", "kind": "synthetic", "asOf": "2026-11-12"}


def request(
    wind: float = 4.0, waves: float = 0.4, sst: float = 14.6, start: str = "2026-11-12", days: int = 1
) -> dict:
    day0 = date.fromisoformat(start)
    return {
        "areaId": "agrakhan",
        "issuedAt": "2026-11-12T09:00:00Z",
        "startDate": start,
        "days": days,
        "cells": [
            {"id": 1, "lat": 44.6, "lon": 47.7, "distHauloutKm": 1.0, "distCoastKm": 5.0},
            {"id": 2, "lat": 44.4, "lon": 47.6, "distHauloutKm": 20.0, "distCoastKm": 2.0},
        ],
        "hydrology": [
            {
                "date": date.fromordinal(day0.toordinal() + i).isoformat(),
                "windSpeedMs": wind,
                "waveHeightM": waves,
                "sstC": sst,
                "sources": {"wind": SOURCE, "waves": SOURCE, "sst": SOURCE},
            }
            for i in range(days)
        ],
    }


@pytest.fixture(scope="module")
def model() -> SealForecastModel:
    return SealForecastModel.from_default_config()


def presence(model: SealForecastModel, body: dict, cell: int = 0) -> float:
    return model.forecast(ForecastRequest.model_validate(body)).days[0].cells[cell].presence


def test_deterministic(model: SealForecastModel) -> None:
    body = request(days=3)
    first = model.forecast(ForecastRequest.model_validate(body)).model_dump_json()
    second = model.forecast(ForecastRequest.model_validate(copy.deepcopy(body))).model_dump_json()
    assert first == second


def test_response_shape(model: SealForecastModel) -> None:
    result = model.forecast(ForecastRequest.model_validate(request(days=2)))
    assert result.model.name == "seal-presence-scorecard"
    assert result.model.simplified is True
    assert result.assumptions == ["A-S1", "A-S2", "A-S3", "A-S5", "A-S6"]
    assert [d.date.isoformat() for d in result.days] == ["2026-11-12", "2026-11-13"]
    for day in result.days:
        assert DISCLAIMER_RU in day.summaryRu
        assert DISCLAIMER_EN in day.summaryEn
        for cell in day.cells:
            assert [f.name for f in cell.factors] == list(FACTOR_ORDER)
            assert 0 <= cell.presence <= 1


def test_stronger_wind_lowers_presence(model: SealForecastModel) -> None:
    assert presence(model, request(wind=15.0)) < presence(model, request(wind=2.0))


def test_higher_waves_lower_presence(model: SealForecastModel) -> None:
    assert presence(model, request(waves=2.0)) < presence(model, request(waves=0.2))


def test_warmer_water_slightly_lowers_presence(model: SealForecastModel) -> None:
    assert presence(model, request(sst=20.0)) < presence(model, request(sst=10.0))


def test_closer_to_haulout_raises_presence(model: SealForecastModel) -> None:
    body = request()
    assert presence(model, body, cell=0) > presence(model, body, cell=1)


def test_season_autumn_and_spring_above_summer() -> None:
    monthly = SealForecastModel.from_default_config().factors["season"]["monthly_log_odds"]
    july = season_log_odds(date(2026, 7, 15), monthly)
    assert season_log_odds(date(2026, 11, 15), monthly) > july
    assert season_log_odds(date(2026, 4, 1), monthly) > july


def test_every_factor_names_an_assumption(model: SealForecastModel) -> None:
    for name in FACTOR_ORDER:
        assert model.factors[name]["assumptions"], name


@pytest.mark.parametrize(("p", "level"), [(0.1, "low"), (0.33, "medium"), (0.65, "medium"), (0.66, "high")])
def test_levels(model: SealForecastModel, p: float, level: str) -> None:
    assert model.level(p) == level


def test_missing_hydrology_day_is_an_input_error(model: SealForecastModel) -> None:
    body = request(days=2)
    body["hydrology"] = body["hydrology"][:1]
    with pytest.raises(ForecastInputError):
        model.forecast(ForecastRequest.model_validate(body))
