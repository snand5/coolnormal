import io
import json
import urllib.error

import pytest

from conftest import load_update_script

update_data = load_update_script()

CPI_KEY = "ABS,CPI,2.0.0/1.10001.10.50.Q"
RATE_KEY = "ABS,LF,1.0.0/M13.3.1599.20.AUS.M"
FIRST_DAY = "2026-10-01"
NEXT_DAY = "2026-10-08"
FEWEST_OBSERVATIONS = 8
SDMX_CSV_HEADER = "DATAFLOW,FREQ,TIME_PERIOD,OBS_VALUE,OBS_STATUS"

SMALL_SERIES = [
	update_data.Series("cpi_quarterly", CPI_KEY, "2020-Q1",
			   FEWEST_OBSERVATIONS, True),
	update_data.Series("unemployment_rate", RATE_KEY, "2020-01",
			   FEWEST_OBSERVATIONS, False),
]


def quarters(first_year, count):
	return [f"{first_year + step // 4}-Q{step % 4 + 1}"
		for step in range(count)]


def months(first_year, count):
	return [f"{first_year + step // 12}-{step % 12 + 1:02d}"
		for step in range(count)]


def sdmx_csv(key, values):
	dataflow = key.split("/")[0].replace(",", ":")
	rows = [f"{dataflow},Q,{period},{value}," for period, value
		in values.items()]
	return "\n".join([SDMX_CSV_HEADER] + rows) + "\n"


class Reply(io.BytesIO):
	def __enter__(self):
		return self

	def __exit__(self, *exception):
		self.close()


class FakeAbs:
	def __init__(self):
		self.responses = {}
		self.requests = []

	def answer(self, key, values):
		self.responses[key] = sdmx_csv(key, values)

	def fail(self, key, error):
		self.responses[key] = error

	def urlopen(self, request, timeout):
		self.requests.append(request)
		key = request.full_url.split("/rest/data/")[1].split("?")[0]
		response = self.responses[key]
		if isinstance(response, Exception):
			raise response
		return Reply(response.encode("utf-8"))


@pytest.fixture
def abs_api(monkeypatch):
	fake = FakeAbs()

	monkeypatch.setattr(update_data.urllib.request, "urlopen",
			    fake.urlopen)
	monkeypatch.setattr(update_data, "SERIES", SMALL_SERIES)
	return fake


def as_observations(values):
	return [{"period": period, "value": value}
		for period, value in values.items()]


def write_cache(data_directory, cpi, rates, status=None):
	data = {"cpi_quarterly": as_observations(cpi),
		"unemployment_rate": as_observations(rates)}

	(data_directory / "data.json").write_text(json.dumps(data))
	if status is not None:
		(data_directory / "status.json").write_text(json.dumps(status))


def read_back(data_directory):
	data = json.loads((data_directory / "data.json").read_text())
	status = json.loads((data_directory / "status.json").read_text())
	values = {name: {observation["period"]: observation["value"]
			 for observation in data[name]}
		  for name in ("cpi_quarterly", "unemployment_rate")}

	return data, status, values


def steady_cpi(count=12, level=100.0):
	return {period: level + step for step, period
		in enumerate(quarters(2020, count))}


def steady_rates(count=12, level=4.0):
	return {period: level for period in months(2020, count)}


def answer_both(abs_api, cpi, rates):
	abs_api.answer(CPI_KEY, cpi)
	abs_api.answer(RATE_KEY, rates)


def test_request_names_the_key_start_period_and_csv_format(abs_api,
							   tmp_path):
	answer_both(abs_api, steady_cpi(), steady_rates())
	update_data.main(tmp_path, FIRST_DAY)
	request = abs_api.requests[0]

	assert request.full_url == (update_data.ABS_DATA_API + CPI_KEY +
				    "?startPeriod=2020-Q1")
	assert request.get_header("Accept") == "application/vnd.sdmx.data+csv"


def test_request_names_the_site_and_how_to_reach_it(abs_api, tmp_path):
	answer_both(abs_api, steady_cpi(), steady_rates())
	update_data.main(tmp_path, FIRST_DAY)

	for request in abs_api.requests:
		assert request.get_header("User-agent") == (
			"coolnormal.com price-level update "
			"(+https://coolnormal.com/)")


def test_first_run_writes_every_series(abs_api, tmp_path):
	answer_both(abs_api, steady_cpi(), steady_rates())

	assert update_data.main(tmp_path, FIRST_DAY) == 0
	data, status, values = read_back(tmp_path)
	assert values["cpi_quarterly"] == steady_cpi()
	assert values["unemployment_rate"] == steady_rates()
	assert status["checked"] == FIRST_DAY
	assert status["series"]["cpi_quarterly"]["outcome"] == "updated"
	assert status["series"]["cpi_quarterly"]["latest"] == "2022-Q4"


def test_same_response_again_is_unchanged(abs_api, tmp_path):
	write_cache(tmp_path, steady_cpi(), steady_rates())
	answer_both(abs_api, steady_cpi(), steady_rates())

	assert update_data.main(tmp_path, FIRST_DAY) == 0
	data, status, values = read_back(tmp_path)
	assert status["series"]["cpi_quarterly"]["outcome"] == "unchanged"
	assert status["series"]["unemployment_rate"]["outcome"] == "unchanged"


def test_failed_fetch_keeps_the_cached_series(abs_api, tmp_path):
	write_cache(tmp_path, steady_cpi(), steady_rates())
	abs_api.fail(CPI_KEY, urllib.error.URLError("timed out"))
	abs_api.answer(RATE_KEY, steady_rates())

	assert update_data.main(tmp_path, FIRST_DAY) == 1
	data, status, values = read_back(tmp_path)
	cpi_status = status["series"]["cpi_quarterly"]
	assert values["cpi_quarterly"] == steady_cpi()
	assert cpi_status["outcome"] == "failed"
	assert cpi_status["failing_since"] == FIRST_DAY
	assert cpi_status["latest"] == "2022-Q4"
	assert "timed out" in cpi_status["error"]
	assert status["series"]["unemployment_rate"]["outcome"] == "unchanged"


def test_failing_since_keeps_the_first_failure_date(abs_api, tmp_path):
	write_cache(tmp_path, steady_cpi(), steady_rates())
	abs_api.fail(CPI_KEY, urllib.error.HTTPError(
		"address", 503, "Service Unavailable", {}, None))
	abs_api.answer(RATE_KEY, steady_rates())

	update_data.main(tmp_path, FIRST_DAY)
	update_data.main(tmp_path, NEXT_DAY)
	data, status, values = read_back(tmp_path)
	assert status["series"]["cpi_quarterly"]["failing_since"] == FIRST_DAY
	assert status["checked"] == NEXT_DAY


def test_success_after_failure_clears_the_failure(abs_api, tmp_path):
	write_cache(tmp_path, steady_cpi(), steady_rates())
	abs_api.fail(CPI_KEY, urllib.error.URLError("timed out"))
	abs_api.answer(RATE_KEY, steady_rates())
	update_data.main(tmp_path, FIRST_DAY)
	abs_api.answer(CPI_KEY, steady_cpi())

	assert update_data.main(tmp_path, NEXT_DAY) == 0
	data, status, values = read_back(tmp_path)
	cpi_status = status["series"]["cpi_quarterly"]
	assert cpi_status["failing_since"] is None
	assert cpi_status["error"] is None
	assert cpi_status["last_success"] == NEXT_DAY


def test_dropped_series_keeps_the_cache(abs_api, tmp_path):
	write_cache(tmp_path, steady_cpi(), steady_rates())
	answer_both(abs_api, {}, steady_rates())

	assert update_data.main(tmp_path, FIRST_DAY) == 1
	data, status, values = read_back(tmp_path)
	assert values["cpi_quarterly"] == steady_cpi()
	assert "only 0 observations" in (
		status["series"]["cpi_quarterly"]["error"])


def test_shorter_history_keeps_older_cached_periods(abs_api, tmp_path):
	cached = steady_cpi(12)
	fetched = dict(list(steady_cpi(13).items())[4:])

	write_cache(tmp_path, cached, steady_rates())
	answer_both(abs_api, fetched, steady_rates())

	assert update_data.main(tmp_path, FIRST_DAY) == 0
	data, status, values = read_back(tmp_path)
	assert values["cpi_quarterly"] == steady_cpi(13)


def test_revised_values_replace_cached_ones(abs_api, tmp_path):
	revised = steady_cpi()
	revised["2022-Q3"] = 110.4

	write_cache(tmp_path, steady_cpi(), steady_rates())
	answer_both(abs_api, revised, steady_rates())

	assert update_data.main(tmp_path, FIRST_DAY) == 0
	data, status, values = read_back(tmp_path)
	assert values["cpi_quarterly"]["2022-Q3"] == 110.4
	assert status["series"]["cpi_quarterly"]["outcome"] == "updated"


def test_rebase_rescales_cached_only_periods(abs_api, tmp_path):
	cached = steady_cpi(12)
	rebased = {period: value / 2 for period, value
		   in list(steady_cpi(13).items())[2:]}

	write_cache(tmp_path, cached, steady_rates())
	answer_both(abs_api, rebased, steady_rates())

	assert update_data.main(tmp_path, FIRST_DAY) == 0
	data, status, values = read_back(tmp_path)
	assert values["cpi_quarterly"]["2020-Q1"] == 50.0
	assert values["cpi_quarterly"]["2020-Q2"] == 50.5
	assert values["cpi_quarterly"]["2023-Q1"] == 56.0
	assert status["series"]["cpi_quarterly"]["note"] == (
		"re-based by 0.50000")


def test_small_ratio_drift_is_not_a_rebase(abs_api, tmp_path):
	cached = steady_cpi(12)
	drifted = {period: value * 1.001 for period, value
		   in list(cached.items())[2:]}

	write_cache(tmp_path, cached, steady_rates())
	answer_both(abs_api, drifted, steady_rates())

	update_data.main(tmp_path, FIRST_DAY)
	data, status, values = read_back(tmp_path)
	assert values["cpi_quarterly"]["2020-Q1"] == 100.0
	assert status["series"]["cpi_quarterly"]["note"] is None


def test_ratio_drift_just_over_the_limit_is_a_rebase(abs_api, tmp_path):
	cached = steady_cpi(12)
	drifted = {period: value * 1.003 for period, value
		   in list(cached.items())[2:]}

	write_cache(tmp_path, cached, steady_rates())
	answer_both(abs_api, drifted, steady_rates())

	update_data.main(tmp_path, FIRST_DAY)
	data, status, values = read_back(tmp_path)
	assert values["cpi_quarterly"]["2020-Q1"] == 100.3
	assert status["series"]["cpi_quarterly"]["note"] == (
		"re-based by 1.00300")


def test_response_older_than_the_cache_is_rejected(abs_api, tmp_path):
	cached = steady_cpi(13)
	older = steady_cpi(12)

	write_cache(tmp_path, cached, steady_rates())
	answer_both(abs_api, older, steady_rates())

	assert update_data.main(tmp_path, FIRST_DAY) == 1
	data, status, values = read_back(tmp_path)
	assert values["cpi_quarterly"] == cached
	assert "older than cached 2023-Q1" in (
		status["series"]["cpi_quarterly"]["error"])


def test_rate_history_shifted_by_over_half_a_point_is_rejected(abs_api,
								tmp_path):
	shifted = {period: value + 0.6 for period, value
		   in steady_rates().items()}

	write_cache(tmp_path, steady_cpi(), steady_rates())
	answer_both(abs_api, steady_cpi(), shifted)

	assert update_data.main(tmp_path, FIRST_DAY) == 1
	data, status, values = read_back(tmp_path)
	assert values["unemployment_rate"] == steady_rates()
	assert "different series" in (
		status["series"]["unemployment_rate"]["error"])


def test_rate_revisions_within_half_a_point_are_accepted(abs_api,
							   tmp_path):
	revised = {period: value + 0.4 for period, value
		   in steady_rates().items()}

	write_cache(tmp_path, steady_cpi(), steady_rates())
	answer_both(abs_api, steady_cpi(), revised)

	assert update_data.main(tmp_path, FIRST_DAY) == 0
	data, status, values = read_back(tmp_path)
	assert values["unemployment_rate"] == revised


def test_rate_series_are_never_rebased(abs_api, tmp_path):
	raised = {period: value + 0.2 for period, value
		  in steady_rates(13).items()}

	write_cache(tmp_path, steady_cpi(), steady_rates(12))
	answer_both(abs_api, steady_cpi(), dict(list(raised.items())[2:]))

	assert update_data.main(tmp_path, FIRST_DAY) == 0
	data, status, values = read_back(tmp_path)
	assert values["unemployment_rate"]["2020-01"] == 4.0
	assert values["unemployment_rate"]["2021-01"] == 4.2
	assert status["series"]["unemployment_rate"]["note"] is None


def test_two_values_for_one_period_is_rejected(abs_api, tmp_path):
	write_cache(tmp_path, steady_cpi(), steady_rates())
	answer_both(abs_api, steady_cpi(), steady_rates())
	repeated_row = "ABS:CPI:2.0.0,Q,2022-Q4,999,\n"
	abs_api.responses[CPI_KEY] += repeated_row

	assert update_data.main(tmp_path, FIRST_DAY) == 1
	data, status, values = read_back(tmp_path)
	assert values["cpi_quarterly"] == steady_cpi()
	assert "matched more than one series" in (
		status["series"]["cpi_quarterly"]["error"])


def test_rows_without_a_value_are_skipped(abs_api, tmp_path):
	answer_both(abs_api, steady_cpi(), steady_rates())
	abs_api.responses[CPI_KEY] += "ABS:CPI:2.0.0,Q,2023-Q1,,\n"

	assert update_data.main(tmp_path, FIRST_DAY) == 0
	data, status, values = read_back(tmp_path)
	assert "2023-Q1" not in values["cpi_quarterly"]


def test_too_few_observations_after_merging_is_rejected(abs_api,
							 tmp_path,
							 monkeypatch):
	stricter_rates = SMALL_SERIES[1]._replace(
		fewest_observations=FEWEST_OBSERVATIONS + 1)

	monkeypatch.setattr(update_data, "SERIES",
			    [SMALL_SERIES[0], stricter_rates])
	answer_both(abs_api, steady_cpi(), steady_rates(FEWEST_OBSERVATIONS))

	assert update_data.main(tmp_path, FIRST_DAY) == 1
	status = json.loads((tmp_path / "status.json").read_text())
	assert "after merging with the cache" in (
		status["series"]["unemployment_rate"]["error"])


def test_no_cpi_fetched_or_cached_writes_nothing(abs_api, tmp_path):
	abs_api.fail(CPI_KEY, urllib.error.URLError("timed out"))
	abs_api.answer(RATE_KEY, steady_rates())

	with pytest.raises(SystemExit) as stopped:
		update_data.main(tmp_path, FIRST_DAY)
	assert stopped.value.code == update_data.NO_DATA_MESSAGE
	assert not (tmp_path / "data.json").exists()


def test_latest_month_is_the_annual_change_of_monthly_cpi():
	monthly = {"2025-09": 120.0, "2026-08": 122.0, "2026-09": 123.0}
	data = {"cpi_monthly": as_observations(monthly)}

	assert update_data.latest_monthly_change(data) == {
		"period": "2026-09", "annual_change": 2.5}


def test_latest_month_needs_the_month_a_year_earlier():
	monthly = {"2025-10": 120.0, "2026-09": 123.0}
	data = {"cpi_monthly": as_observations(monthly)}

	assert update_data.latest_monthly_change(data) is None
	assert update_data.latest_monthly_change({}) is None


@pytest.mark.parametrize("file_name", ["data.json", "status.json"])
def test_corrupt_cache_stops_the_run_and_writes_nothing(abs_api, tmp_path,
							file_name):
	write_cache(tmp_path, steady_cpi(), steady_rates(), {"series": {}})
	answer_both(abs_api, steady_cpi(13), steady_rates())
	corrupt_file = tmp_path / file_name
	whole = corrupt_file.read_text()
	half_written = whole[:len(whole) // 2]
	corrupt_file.write_text(half_written)
	before = {path.name: path.read_text()
		  for path in tmp_path.iterdir()}

	with pytest.raises(SystemExit) as stopped:
		update_data.main(tmp_path, FIRST_DAY)
	assert file_name in str(stopped.value.code)
	assert {path.name: path.read_text()
		for path in tmp_path.iterdir()} == before


def test_failed_write_leaves_previous_data_file_intact(abs_api, tmp_path,
							monkeypatch):
	write_cache(tmp_path, steady_cpi(), steady_rates())
	answer_both(abs_api, steady_cpi(13), steady_rates())
	previous = (tmp_path / "data.json").read_text()

	def write_half_then_fail(path, text, *arguments, **options):
		with open(path, "w") as file:
			file.write(text[:len(text) // 2])
		raise OSError("No space left on device")

	monkeypatch.setattr(update_data.pathlib.Path, "write_text",
			    write_half_then_fail)
	with pytest.raises(OSError):
		update_data.main(tmp_path, FIRST_DAY)
	assert (tmp_path / "data.json").read_text() == previous
	assert sorted(path.name for path in tmp_path.iterdir()) == [
		"data.json"]


def test_a_zero_cached_index_value_fails_the_series_not_skipped(abs_api,
								 tmp_path):
	cached = steady_cpi()
	cached["2021-Q1"] = 0.0

	write_cache(tmp_path, cached, steady_rates())
	answer_both(abs_api, steady_cpi(13), steady_rates())

	assert update_data.main(tmp_path, FIRST_DAY) == 1
	data, status, values = read_back(tmp_path)
	assert values["cpi_quarterly"] == cached
	assert status["series"]["cpi_quarterly"]["outcome"] == "failed"


def test_a_value_that_is_not_json_is_never_written(tmp_path):
	write_cache(tmp_path, steady_cpi(), steady_rates())
	previous = (tmp_path / "data.json").read_text()
	data = {"cpi_quarterly": [{"period": "2023-Q1", "value": float("nan")}]}

	with pytest.raises(ValueError):
		update_data.write_results(tmp_path, data, {"series": {}})
	assert (tmp_path / "data.json").read_text() == previous


def test_merged_series_with_a_missing_period_is_rejected_and_cache_kept(
		abs_api, tmp_path):
	with_gap = steady_cpi(14)
	del with_gap["2023-Q1"]

	write_cache(tmp_path, steady_cpi(12), steady_rates())
	answer_both(abs_api, with_gap, steady_rates())

	assert update_data.main(tmp_path, FIRST_DAY) == 1
	data, status, values = read_back(tmp_path)
	assert values["cpi_quarterly"] == steady_cpi(12)
	assert "missing" in status["series"]["cpi_quarterly"]["error"]


def test_a_missing_month_is_rejected_too(abs_api, tmp_path):
	with_gap = steady_rates(14)
	del with_gap["2021-01"]

	write_cache(tmp_path, steady_cpi(), steady_rates(12))
	answer_both(abs_api, steady_cpi(), with_gap)

	assert update_data.main(tmp_path, FIRST_DAY) == 1
	data, status, values = read_back(tmp_path)
	assert values["unemployment_rate"] == steady_rates(12)
