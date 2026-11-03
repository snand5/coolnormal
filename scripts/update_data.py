import collections
import csv
import datetime
import io
import json
import math
import os
import pathlib
import re
import statistics
import sys
import urllib.request

ABS_DATA_API = "https://data.api.abs.gov.au/rest/data/"
DEFAULT_DATA_DIRECTORY = pathlib.Path(__file__).resolve().parent.parent / "data"
SECONDS_TO_WAIT_FOR_ABS = 120
USER_AGENT = "coolnormal.com price-level update (+https://coolnormal.com/)"
FEWEST_OBSERVATIONS_IN_A_WORKING_RESPONSE = 8
LARGEST_RATIO_DRIFT_THAT_IS_NOT_A_REBASE = 0.002
LARGEST_TYPICAL_RATE_REVISION_IN_POINTS = 0.5
LARGEST_RATIO_SPREAD_FROM_MEDIAN = 0.005
LONGEST_ERROR_MESSAGE_KEPT = 300
DECIMAL_PLACES_STORED = 4
DECIMAL_PLACES_OF_ANNUAL_CHANGE = 1
NO_DATA_MESSAGE = "No CPI data at all, fetched or cached; nothing written."
UNREADABLE_FILE_MESSAGE = "{path} could not be read ({error}); nothing written."
PARTIAL_FILE_SUFFIX = ".partial"
BUILT_IN_DATA_FILE = "built-in-data.js"
BUILT_IN_DATA_PREFIX = "window.BUILT_IN_DATA = "
BUILT_IN_DATA_SUFFIX = ";\n"
PERIODS_PER_YEAR = {"Q": 4, "M": 12}
PERIOD_FORMS = {
	"Q": re.compile(r"[0-9]{4}-Q[1-4]"),
	"M": re.compile(r"[0-9]{4}-(0[1-9]|1[0-2])"),
}

Series = collections.namedtuple(
	"Series",
	"name key first_period fewest_observations_after_merge is_index")

SERIES = [
	Series(name="cpi_quarterly", key="ABS,CPI,2.0.0/1.10001.10.50.Q",
	       first_period="1985-Q1", fewest_observations_after_merge=160,
	       is_index=True),
	Series(name="wpi_quarterly",
	       key="ABS,WPI,1.2.0/1.THRPEB.7.TOT.20.AUS.Q",
	       first_period="1997-Q3", fewest_observations_after_merge=110,
	       is_index=True),
	Series(name="cpi_monthly", key="ABS,CPI,2.0.0/1.10001.10.50.M",
	       first_period="2024-01", fewest_observations_after_merge=12,
	       is_index=True),
	Series(name="unemployment_rate",
	       key="ABS,LF,1.0.0/M13.3.1599.20.AUS.M",
	       first_period="1978-02", fewest_observations_after_merge=500,
	       is_index=False),
	Series(name="underutilisation_rate",
	       key="ABS,LF_UNDER,1.0.1/M24.3.1599.20.AUS.M",
	       first_period="1978-02", fewest_observations_after_merge=500,
	       is_index=False),
]


class SeriesLooksWrong(Exception):
	pass


def only_one_value_per_period(rows):
	periods = collections.Counter(row["TIME_PERIOD"] for row in rows)
	repeated = {period: count for period, count in periods.items()
		    if count > 1}

	if repeated:
		first_repeated_period = min(repeated)
		count = repeated[first_repeated_period]
		raise SeriesLooksWrong(f"{count} values for "
				       f"{first_repeated_period}: the key "
				       f"matched more than one series")
	return {row["TIME_PERIOD"]: float(row["OBS_VALUE"]) for row in rows}


def frequency(series):
	return series.key.rsplit(".", 1)[-1]


def check_observation(row, period_form):
	period = row["TIME_PERIOD"]

	if not period_form.fullmatch(period):
		raise SeriesLooksWrong(f"period {period!r} is not in the form "
				       f"{period_form.pattern}")
	if not math.isfinite(float(row["OBS_VALUE"])):
		raise SeriesLooksWrong(f"value {row['OBS_VALUE']!r} for "
				       f"{period} is not a finite number")


def parse_abs_reply(reply_text, series):
	rows = [row for row in csv.DictReader(io.StringIO(reply_text))
		if row.get("OBS_VALUE")]
	period_form = PERIOD_FORMS[frequency(series)]

	for row in rows:
		check_observation(row, period_form)
	return only_one_value_per_period(rows)


def fetch_from_abs(series):
	address = (f"{ABS_DATA_API}{series.key}"
		   f"?startPeriod={series.first_period}")
	request_headers = {"Accept": "application/vnd.sdmx.data+csv",
			   "User-Agent": USER_AGENT}
	request = urllib.request.Request(address, headers=request_headers)

	with urllib.request.urlopen(request,
				    timeout=SECONDS_TO_WAIT_FOR_ABS) as reply:
		reply_text = reply.read().decode("utf-8")
	return parse_abs_reply(reply_text, series)


def overlapping_periods(cached, fetched):
	return [period for period in fetched if period in cached]


def rebase_ratio(cached, fetched):
	overlap = overlapping_periods(cached, fetched)

	if not overlap:
		return 1.0
	return statistics.median(fetched[period] / cached[period]
				 for period in overlap)


def largest_ratio_spread(cached, fetched):
	overlap = overlapping_periods(cached, fetched)
	ratio = rebase_ratio(cached, fetched)

	return max((abs(fetched[period] / cached[period] / ratio - 1)
		    for period in overlap), default=0.0)


def typical_rate_revision(cached, fetched):
	overlap = overlapping_periods(cached, fetched)

	if not overlap:
		return 0.0
	return statistics.median(abs(fetched[period] - cached[period])
				 for period in overlap)


def check_index_history(cached, fetched):
	spread = largest_ratio_spread(cached, fetched)

	if spread > LARGEST_RATIO_SPREAD_FROM_MEDIAN:
		raise SeriesLooksWrong(f"past values moved by up to "
				       f"{spread:.2%} against the median "
				       f"ratio; the key may now point at a "
				       f"different series")


def check_rate_history(cached, fetched):
	revision = typical_rate_revision(cached, fetched)

	if revision > LARGEST_TYPICAL_RATE_REVISION_IN_POINTS:
		raise SeriesLooksWrong(f"past rates moved by a median of "
				       f"{revision:.2f} points; the key may "
				       f"now point at a different series")


def merge_with_cache(cached, fetched, is_index):
	ratio = rebase_ratio(cached, fetched) if is_index else 1.0
	was_rebased = abs(ratio - 1) > LARGEST_RATIO_DRIFT_THAT_IS_NOT_A_REBASE

	if was_rebased:
		cached = {period: value * ratio
			  for period, value in cached.items()}
	merged = dict(sorted({**cached, **fetched}.items()))
	rebase_note = f"re-based by {ratio:.5f}" if was_rebased else None
	return merged, rebase_note


def check_fetched(cached, fetched):
	if len(fetched) < FEWEST_OBSERVATIONS_IN_A_WORKING_RESPONSE:
		raise SeriesLooksWrong(f"only {len(fetched)} observations "
				       f"returned")
	if cached and max(fetched) < max(cached):
		raise SeriesLooksWrong(f"latest period {max(fetched)} is older "
				       f"than cached {max(cached)}")


def period_position(period, periods_per_year):
	year, number = period.split("-")
	return int(year) * periods_per_year + int(number.removeprefix("Q")) - 1


def periods_missing(merged, periods_per_year):
	first = period_position(min(merged), periods_per_year)
	latest = period_position(max(merged), periods_per_year)

	return latest - first + 1 - len(merged)


def check_merged(series, merged):
	periods_per_year = PERIODS_PER_YEAR[frequency(series)]

	if len(merged) < series.fewest_observations_after_merge:
		raise SeriesLooksWrong(f"only {len(merged)} observations after "
				       f"merging with the cache")
	missing = periods_missing(merged, periods_per_year)
	if missing:
		raise SeriesLooksWrong(f"{missing} periods missing between "
				       f"{min(merged)} and {max(merged)}")


def observations(series_values):
	return [{"period": period, "value": round(value, DECIMAL_PLACES_STORED)}
		for period, value in series_values.items()]


def refresh_series(data, series):
	cached = {observation["period"]: observation["value"]
		  for observation in data.get(series.name, [])}
	fetched = fetch_from_abs(series)

	check_fetched(cached, fetched)
	if series.is_index:
		check_index_history(cached, fetched)
	else:
		check_rate_history(cached, fetched)
	merged, rebase_note = merge_with_cache(cached, fetched,
					       series.is_index)
	check_merged(series, merged)
	stored_observations = observations(merged)
	outcome = ("unchanged" if stored_observations == data.get(series.name)
		   else "updated")
	data[series.name] = stored_observations
	return outcome, max(merged), rebase_note


def record_success(series_status, outcome, latest_period, rebase_note,
		   today):
	series_status.update(outcome=outcome, last_success=today,
			     latest=latest_period, error=None,
			     failing_since=None, note=rebase_note)


def record_failure(series_status, data, series, error, today):
	cached_periods = [observation["period"]
			  for observation in data.get(series.name, [])]
	failing_since = series_status.get("failing_since") or today

	series_status.update(outcome="failed",
			     error=str(error)[:LONGEST_ERROR_MESSAGE_KEPT],
			     failing_since=failing_since,
			     latest=max(cached_periods, default=None))


def refresh_and_record(data, series_status, series, today):
	try:
		outcome, latest_period, rebase_note = refresh_series(data,
								    series)
	except Exception as error:
		record_failure(series_status, data, series, error, today)
		return "failed"
	record_success(series_status, outcome, latest_period, rebase_note,
		       today)
	return outcome


def latest_monthly_change(data):
	monthly = {observation["period"]: observation["value"]
		   for observation in data.get("cpi_monthly", [])}

	if not monthly:
		return None
	latest = max(monthly)
	year_earlier = f"{int(latest[:4]) - 1}{latest[4:]}"
	if year_earlier not in monthly:
		return None
	change = (monthly[latest] / monthly[year_earlier] - 1) * 100
	rounded_change = round(change, DECIMAL_PLACES_OF_ANNUAL_CHANGE)
	return {"period": latest, "annual_change": rounded_change}


def read_json(path, value_if_missing):
	try:
		return json.loads(path.read_text())
	except FileNotFoundError:
		return value_if_missing
	except (OSError, ValueError) as error:
		sys.exit(UNREADABLE_FILE_MESSAGE.format(path=path, error=error))


def replace_file(path, text):
	partial = path.with_name(path.name + PARTIAL_FILE_SUFFIX)

	try:
		partial.write_text(text)
		os.replace(partial, path)
	finally:
		partial.unlink(missing_ok=True)


def built_in_copy_text(data_text):
	return BUILT_IN_DATA_PREFIX + data_text + BUILT_IN_DATA_SUFFIX


def write_results(data_directory, data, status):
	data_text = json.dumps(data, separators=(",", ":"), allow_nan=False)

	data_directory.mkdir(exist_ok=True)
	replace_file(data_directory / "data.json", data_text)
	replace_file(data_directory / BUILT_IN_DATA_FILE,
		     built_in_copy_text(data_text))
	replace_file(data_directory / "status.json",
		     json.dumps(status, indent="\t", allow_nan=False))


def main(data_directory=DEFAULT_DATA_DIRECTORY, today=None):
	today = today or datetime.date.today().isoformat()
	data = read_json(data_directory / "data.json", {})
	status = read_json(data_directory / "status.json", {"series": {}})
	outcomes = {}

	status["checked"] = today
	for series in SERIES:
		series_status = status["series"].setdefault(series.name, {})
		outcomes[series.name] = refresh_and_record(data, series_status,
							   series, today)
	monthly_change = latest_monthly_change(data)
	if monthly_change is not None:
		data["latest_monthly_change"] = monthly_change
	if not data.get("cpi_quarterly"):
		sys.exit(NO_DATA_MESSAGE)

	write_results(data_directory, data, status)
	for name, outcome in outcomes.items():
		print(f"{name}: {outcome}")
	return 1 if "failed" in outcomes.values() else 0


if __name__ == "__main__":
	sys.exit(main())
