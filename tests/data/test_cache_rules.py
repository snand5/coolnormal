import json

import pytest

from abs_stub import CACHED, cached_observations, run_once

REBASE_FACTOR = 0.6945
PERIODS_THE_ABS_STILL_RETURNS = 120
DECIMAL_PLACES_THE_ABS_PUBLISHES = 2
DRIFT_PER_QUARTER = 0.0002
INSIDE_TOLERANCE = 0.004
OUTSIDE_TOLERANCE = 0.006
INDEX_SERIES = ["cpi_quarterly", "wpi_quarterly"]
SERIES_THE_PAGE_LOADS = [
	"cpi_quarterly", "wpi_quarterly", "unemployment_rate",
	"underutilisation_rate",
]


def recent(name):
	return cached_observations(name)[-PERIODS_THE_ABS_STILL_RETURNS:]


def rebased(name):
	return [(period, round(value * REBASE_FACTOR,
			       DECIMAL_PLACES_THE_ABS_PUBLISHES))
		for period, value in recent(name)]


def drifting(name):
	return [(period, value * (1 + DRIFT_PER_QUARTER) ** step)
		for step, (period, value) in enumerate(recent(name))]


def one_period_moved(name, fraction):
	observations = recent(name)
	middle = len(observations) // 2
	period, value = observations[middle]

	observations[middle] = (period, value * (1 + fraction))
	return observations


def stored(data_directory, name):
	data = json.loads((data_directory / "data.json").read_text())
	return data[name]


def outcome(data_directory, name):
	status = json.loads((data_directory / "status.json").read_text())
	return status["series"][name]


@pytest.mark.parametrize("name", INDEX_SERIES)
def test_rebase_with_rounding_only_is_accepted(monkeypatch, tmp_path, name):
	assert run_once(monkeypatch, tmp_path, {name: rebased(name)}) == 0
	first_cached = CACHED[name][0]
	first_stored = stored(tmp_path, name)[0]
	assert first_stored["period"] == first_cached["period"]
	assert first_stored["value"] == pytest.approx(
		first_cached["value"] * REBASE_FACTOR, rel=0.001)
	assert outcome(tmp_path, name)["note"].startswith("re-based")


@pytest.mark.parametrize("name", INDEX_SERIES)
def test_index_series_with_inconsistent_ratio_is_rejected_not_rebased(
		monkeypatch, tmp_path, name):
	assert run_once(monkeypatch, tmp_path, {name: drifting(name)}) == 1
	assert stored(tmp_path, name) == CACHED[name]
	assert outcome(tmp_path, name)["outcome"] == "failed"


@pytest.mark.parametrize("name", INDEX_SERIES)
def test_one_period_moved_more_than_tolerance_is_rejected(monkeypatch,
							  tmp_path, name):
	replies = {name: one_period_moved(name, OUTSIDE_TOLERANCE)}

	assert run_once(monkeypatch, tmp_path, replies) == 1
	assert stored(tmp_path, name) == CACHED[name]


@pytest.mark.parametrize("name", INDEX_SERIES)
def test_one_period_revised_within_tolerance_is_accepted(monkeypatch,
							 tmp_path, name):
	replies = {name: one_period_moved(name, INSIDE_TOLERANCE)}

	assert run_once(monkeypatch, tmp_path, replies) == 0
	assert outcome(tmp_path, name)["outcome"] == "updated"
	assert outcome(tmp_path, name)["note"] is None


def without_middle(observations):
	middle = len(observations) // 2

	return observations[:middle] + observations[middle + 1:]


@pytest.mark.parametrize("name", SERIES_THE_PAGE_LOADS)
def test_merged_series_with_a_missing_period_is_rejected_and_cache_kept(
		monkeypatch, tmp_path, name):
	cached_with_gap = dict(CACHED, **{name: without_middle(CACHED[name])})
	replies = {name: without_middle(cached_observations(name))}

	assert run_once(monkeypatch, tmp_path, replies, cached_with_gap) == 1
	assert stored(tmp_path, name) == cached_with_gap[name]
	assert outcome(tmp_path, name)["outcome"] == "failed"
