import importlib.util
import io
import json
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "update_data.py"
FIXTURE = (pathlib.Path(__file__).resolve().parent / "fixtures" /
	   "data-2026-10-29.json")
TODAY = "2026-10-30"


def load_update_script():
	spec = importlib.util.spec_from_file_location("update_data", SCRIPT)
	module = importlib.util.module_from_spec(spec)

	spec.loader.exec_module(module)
	return module


update_data = load_update_script()
SERIES_BY_NAME = {series.name: series for series in update_data.SERIES}
CACHED = json.loads(FIXTURE.read_text())


class Reply(io.BytesIO):
	def __enter__(self):
		return self

	def __exit__(self, *details):
		self.close()


def reply_text(observations):
	lines = ["TIME_PERIOD,OBS_VALUE"]

	lines += [f"{period},{value}" for period, value in observations]
	return "\n".join(lines)


def cached_observations(name):
	return [(observation["period"], observation["value"])
		for observation in CACHED[name]]


def with_last_replaced(name, period=None, value=None):
	observations = cached_observations(name)
	last_period, last_value = observations[-1]

	observations[-1] = (period or last_period, value or last_value)
	return observations


def serve(monkeypatch, replies):
	def urlopen(request, timeout):
		key = request.full_url.split("/data/")[1].split("?")[0]
		name = next(series.name for series in update_data.SERIES
			    if series.key == key)
		observations = replies.get(name, cached_observations(name))
		return Reply(reply_text(observations).encode())

	monkeypatch.setattr(urllib.request, "urlopen", urlopen)


def strict_json(text):
	def refuse(constant):
		raise ValueError(f"{constant} is not JSON")

	return json.loads(text, parse_constant=refuse)


def run_once(monkeypatch, data_directory, replies, cached=None):
	cache_text = json.dumps(cached) if cached else FIXTURE.read_text()

	(data_directory / "data.json").write_text(cache_text)
	serve(monkeypatch, replies)
	return update_data.main(data_directory, TODAY)
