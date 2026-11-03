import math

import pytest

from recompute import (BASE_QUARTER, PriceLevel, cpi_with_gaps, position,
		       quarter_at, read_json)

EXPECTED = read_json("expected-2026-10-29.json")
CASES = read_json("cases.json")
FIXTURE = read_json(EXPECTED["fixture"])
RUN_CASE_PATH_RATE = 2.5


def close(actual, expected, tolerance):
	return math.isclose(actual, expected, rel_tol=0, abs_tol=tolerance)


def step_quarter(step):
	return quarter_at(position(BASE_QUARTER) + step)


@pytest.fixture(params=EXPECTED["trends"],
		ids=lambda row: f"trend {row['trend_rate']}")
def headline(request):
	return request.param, PriceLevel(FIXTURE, request.param["trend_rate"])


def test_gap(headline):
	row, prices = headline

	assert prices.latest == row["latest_quarter"]
	assert close(prices.gap(prices.latest), row["percent_above_trend"],
		     EXPECTED["tolerance"])


def test_run(headline):
	row, prices = headline

	assert prices.run() == (row["is_above"], row["run_first_quarter"],
				row["run_length_in_quarters"])


def test_average_and_annual_change(headline):
	row, prices = headline

	assert close(prices.average_inflation(), row["average_inflation"],
		     EXPECTED["tolerance"])
	assert close(prices.annual_change(prices.latest), row["annual_change"],
		     EXPECTED["tolerance"])


def test_years_back_to_trend(headline):
	row, prices = headline
	expected_rates = [rate for rate, _ in row["years_back_to_trend"]]

	assert prices.catch_up_rates() == expected_rates
	for rate, years in row["years_back_to_trend"]:
		assert close(prices.years_back_to_trend(rate), years,
			     EXPECTED["tolerance"])


def test_wages(headline):
	row, prices = headline

	assert list(prices.wage_window()) == row["wage_window"]
	assert close(prices.wages_relative_to_prices(),
		     row["wages_relative_to_prices"], EXPECTED["tolerance"])


@pytest.mark.parametrize("case", CASES["runs"], ids=lambda case: case["rule"])
def test_run_rule(case):
	gaps = case["percent_gaps"]
	data = {"cpi_quarterly": cpi_with_gaps(gaps, RUN_CASE_PATH_RATE)}
	prices = PriceLevel(data, case["trend_rate"])

	assert prices.run() == (case["is_above"],
				step_quarter(case["run_first_step"]),
				case["run_length_in_quarters"])


@pytest.mark.parametrize("case", CASES["catch_up"],
			 ids=lambda case: case["rule"])
def test_catch_up_rule(case):
	gaps = [0, case["latest_percent_gap"]]
	data = {"cpi_quarterly": cpi_with_gaps(gaps, case["trend_rate"])}
	prices = PriceLevel(data, case["trend_rate"])

	assert prices.catch_up_rates() == case["rates"]
	assert close(prices.years_back_to_trend(case["rate"]), case["years"],
		     CASES["tolerance"])
