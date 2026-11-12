"""Transparent seal presence scorecard (no training, no hidden parameters).

For each cell and day:
    logit(p) = season(day of year) + wind + waves + sst + haulout
Each term is a "contribution" in log-odds that the dashboard shows as an explanation.
All numbers come from assumptions.yaml and are unvalidated assumptions (PLAN.md 7.3).
The same inputs always give the same output (deterministic).
"""

import math
from datetime import date, timedelta
from pathlib import Path

import yaml

from app.schemas import (
    CellForecast,
    DayForecast,
    Factor,
    ForecastModelInfo,
    ForecastRequest,
    ForecastResponse,
    Hydrology,
)

DEFAULT_CONFIG = Path(__file__).parent / "assumptions.yaml"
FACTOR_ORDER = ("season", "wind", "waves", "sst", "haulout")

LEVEL_RU = {"low": "низкий", "medium": "средний", "high": "высокий"}
FACTOR_RU = {
    "season": "сезон",
    "wind": "ветер",
    "waves": "волнение",
    "sst": "температура воды",
    "haulout": "близость к залёжке",
}
FACTOR_EN = {
    "season": "season",
    "wind": "wind",
    "waves": "waves",
    "sst": "water temperature",
    "haulout": "haul-out proximity",
}
DISCLAIMER_RU = "Упрощённая модель на допущениях; требует проверки экологами."
DISCLAIMER_EN = "Simplified assumption-based model; needs validation by ecologists."


class ForecastInputError(Exception):
    """Request is valid JSON but cannot be forecast (HTTP 422 with this code)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def season_log_odds(day: date, monthly: list[float]) -> float:
    """Seasonal base: linear interpolation between mid-month values, wrapping around the year."""
    year_days = 366 if (day.year % 4 == 0 and (day.year % 100 != 0 or day.year % 400 == 0)) else 365
    position = (day.timetuple().tm_yday - 0.5) / year_days * 12.0 - 0.5  # 0.0 = middle of January
    low = math.floor(position)
    frac = position - low
    return monthly[low % 12] * (1.0 - frac) + monthly[(low + 1) % 12] * frac


class SealForecastModel:
    def __init__(self, config: dict) -> None:
        self.config = config
        self.factors = config["factors"]
        for name in FACTOR_ORDER:
            if not self.factors[name].get("assumptions"):
                raise ValueError(f"factor {name!r} has no documented assumption")

    @classmethod
    def from_default_config(cls) -> "SealForecastModel":
        return cls(yaml.safe_load(DEFAULT_CONFIG.read_text(encoding="utf-8")))

    def assumption_ids(self) -> list[str]:
        return sorted({a for name in FACTOR_ORDER for a in self.factors[name]["assumptions"]})

    def level(self, presence: float) -> str:
        levels = self.config["levels"]
        if presence >= levels["high_from"]:
            return "high"
        if presence >= levels["medium_from"]:
            return "medium"
        return "low"

    def _linear(self, name: str, value: float) -> float:
        f = self.factors[name]
        return f["weight_per_unit"] * (value - f["reference"])

    def factors_for(self, day: date, hydro: Hydrology, dist_haulout_km: float) -> list[Factor]:
        """The five contributions (log-odds) for one cell on one day."""
        f = self.factors
        haul = f["haulout"]
        return [
            Factor(
                name="season",
                value=day.timetuple().tm_yday,
                unit=f["season"]["unit"],
                contribution=round(season_log_odds(day, f["season"]["monthly_log_odds"]), 4),
            ),
            Factor(
                name="wind",
                value=hydro.windSpeedMs,
                unit=f["wind"]["unit"],
                contribution=round(self._linear("wind", hydro.windSpeedMs), 4),
            ),
            Factor(
                name="waves",
                value=hydro.waveHeightM,
                unit=f["waves"]["unit"],
                contribution=round(self._linear("waves", hydro.waveHeightM), 4),
            ),
            Factor(
                name="sst",
                value=hydro.sstC,
                unit=f["sst"]["unit"],
                contribution=round(self._linear("sst", hydro.sstC), 4),
            ),
            Factor(
                name="haulout",
                value=dist_haulout_km,
                unit=haul["unit"],
                contribution=round(
                    haul["weight_per_unit"] * (min(dist_haulout_km, haul["cap"]) - haul["reference"]), 4
                ),
            ),
        ]

    def forecast(self, request: ForecastRequest) -> ForecastResponse:
        if not request.cells:
            raise ForecastInputError("no_cells")
        hydro_by_date = {h.date: h for h in request.hydrology}
        days = []
        for offset in range(request.days):
            day = request.startDate + timedelta(days=offset)
            hydro = hydro_by_date.get(day)
            if hydro is None:
                raise ForecastInputError("hydrology_missing_for_day")
            cells = []
            for cell in request.cells:
                factors = self.factors_for(day, hydro, cell.distHauloutKm)
                presence = sigmoid(sum(fa.contribution for fa in factors))
                cells.append(
                    CellForecast(
                        id=cell.id, presence=round(presence, 4), level=self.level(presence), factors=factors
                    )
                )
            dist = {c.id: c.distHauloutKm for c in request.cells}
            summary_ru, summary_en = self.summaries(cells, dist)
            days.append(DayForecast(date=day, cells=cells, summaryRu=summary_ru, summaryEn=summary_en))
        model = self.config["model"]
        return ForecastResponse(
            model=ForecastModelInfo(name=model["name"], version=str(model["version"]), simplified=True),
            days=days,
            assumptions=self.assumption_ids(),
        )

    def summaries(self, cells: list[CellForecast], dist_km: dict[int, float]) -> tuple[str, str]:
        """Two or three plain sentences per day, from fixed templates (no language model)."""
        # Highest presence; ties go to the cell closer to a haul-out, then the lower id.
        best = max(cells, key=lambda c: (c.presence, -dist_km[c.id], -c.id))
        worst = min(cells, key=lambda c: (c.presence, -dist_km[c.id], c.id))
        # Two strongest drivers of the best cell, by absolute contribution.
        drivers = sorted(best.factors, key=lambda fa: (-abs(fa.contribution), FACTOR_ORDER.index(fa.name)))[
            :2
        ]

        def sign(x: float) -> str:
            return "+" if x >= 0 else "−"

        drivers_ru = ", ".join(f"{FACTOR_RU[d.name]} ({sign(d.contribution)})" for d in drivers)
        drivers_en = ", ".join(f"{FACTOR_EN[d.name]} ({sign(d.contribution)})" for d in drivers)
        ru = (
            f"Выше всего индекс присутствия в {dist_km[best.id]:.1f} км от кандидатной залёжки: "
            f"≈ {best.presence:.2f} (уровень «{LEVEL_RU[best.level]}»), ниже всего в "
            f"{dist_km[worst.id]:.1f} км: ≈ {worst.presence:.2f}. "
            f"Главные факторы: {drivers_ru}. {DISCLAIMER_RU}"
        )
        en = (
            f"Presence is highest {dist_km[best.id]:.1f} km from a candidate haul-out: "
            f"≈ {best.presence:.2f} ({best.level}), lowest {dist_km[worst.id]:.1f} km away: "
            f"≈ {worst.presence:.2f}. Main drivers: {drivers_en}. {DISCLAIMER_EN}"
        )
        return ru, en
