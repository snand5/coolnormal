import json

import pytest

from abs_stub import (CACHED, SERIES_BY_NAME, TODAY, run_once, serve,
		      strict_json, update_data, with_last_replaced)


NOT_FINITE = ["NaN", "nan", "inf", "-Infinity"]
FULL_WIDTH_YEAR = "\uff12\uff10\uff12\uff16"
BAD_PERIODS = {
	"cpi_quarterly": ["9999-Q9", "2026-Q0", "2026-Q5", "2026-09",
			  "2026-Q3 ", FULL_WIDTH_YEAR + "-Q4"],
	"cpi_monthly": ["9999-99", "2026-13", "2026-00", "2026-Q3",
			"2026-9", FULL_WIDTH_YEAR + "-10"],
	"unemployment_rate": ["9999-99", "2026-13", "2026-Q3"],
}


@pytest.mark.parametrize("value", NOT_FINITE)
@pytest.mark.parametrize("name", ["cpi_quarterly", "unemployment_rate"])
def test_non_finite_value_is_rejected(monkeypatch, name, value):
	serve(monkeypatch, {name: with_last_replaced(name, value=value)})

	with pytest.raises(update_data.SeriesLooksWrong):
		update_data.fetch_from_abs(SERIES_BY_NAME[name])


BAD_PERIOD_CASES = [(name, period) for name, periods in BAD_PERIODS.items()
		    for period in periods]


@pytest.mark.parametrize("name, period", BAD_PERIOD_CASES)
def test_period_in_wrong_form_is_rejected(monkeypatch, name, period):
	serve(monkeypatch, {name: with_last_replaced(name, period=period)})

	with pytest.raises(update_data.SeriesLooksWrong):
		update_data.fetch_from_abs(SERIES_BY_NAME[name])


@pytest.mark.parametrize("name", ["cpi_quarterly", "cpi_monthly",
				  "unemployment_rate"])
def test_well_formed_response_is_accepted(monkeypatch, name):
	serve(monkeypatch, {})

	fetched = update_data.fetch_from_abs(SERIES_BY_NAME[name])
	assert len(fetched) == len(CACHED[name])


def test_non_finite_value_keeps_cache_and_flags_failure(monkeypatch,
							 tmp_path):
	replies = {"cpi_quarterly": with_last_replaced("cpi_quarterly",
							value="NaN")}

	assert run_once(monkeypatch, tmp_path, replies) == 1
	written = strict_json((tmp_path / "data.json").read_text())
	status = json.loads((tmp_path / "status.json").read_text())
	assert written["cpi_quarterly"] == CACHED["cpi_quarterly"]
	assert status["series"]["cpi_quarterly"]["outcome"] == "failed"


def test_bad_period_cannot_block_later_updates(monkeypatch, tmp_path):
	replies = {"cpi_quarterly": with_last_replaced("cpi_quarterly",
							period="9999-Q9")}

	assert run_once(monkeypatch, tmp_path, replies) == 1
	serve(monkeypatch, {})
	assert update_data.main(tmp_path, TODAY) == 0
	status = json.loads((tmp_path / "status.json").read_text())
	assert status["series"]["cpi_quarterly"]["latest"] == "2026-Q3"
