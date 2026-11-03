import json

from abs_stub import ROOT, run_once, update_data, with_last_replaced

AGREED_PREFIX = "window.BUILT_IN_DATA = "
AGREED_SUFFIX = ";\n"
AGREED_FILE = "built-in-data.js"
STALE_COPY = AGREED_PREFIX + "{}" + AGREED_SUFFIX
WORKFLOW = ROOT / ".github" / "workflows" / "update-data.yml"
PAGE = ROOT / "index.html"


def texts(data_directory):
	data_text = (data_directory / "data.json").read_text()
	copy_text = (data_directory / AGREED_FILE).read_text()
	return data_text, copy_text


def assert_copy_matches(data_directory):
	data_text, copy_text = texts(data_directory)

	assert copy_text == AGREED_PREFIX + data_text + AGREED_SUFFIX


def test_agreed_names():
	assert update_data.BUILT_IN_DATA_FILE == AGREED_FILE
	assert update_data.BUILT_IN_DATA_PREFIX == AGREED_PREFIX
	assert update_data.BUILT_IN_DATA_SUFFIX == AGREED_SUFFIX


def test_built_in_copy_text_wraps_the_data_text_unchanged():
	data_text = '{"cpi_quarterly":[{"period":"1993-Q3","value":42.45}]}'

	assert (update_data.built_in_copy_text(data_text) ==
		AGREED_PREFIX + data_text + AGREED_SUFFIX)


def test_update_writes_a_built_in_copy_identical_to_data_json(monkeypatch,
							      tmp_path):
	assert run_once(monkeypatch, tmp_path, {}) == 0
	assert_copy_matches(tmp_path)


def test_run_with_a_failed_series_keeps_the_two_identical(monkeypatch,
							   tmp_path):
	replies = {"cpi_quarterly": with_last_replaced("cpi_quarterly",
							value="NaN")}

	assert run_once(monkeypatch, tmp_path, replies) == 1
	assert_copy_matches(tmp_path)


def test_stale_copy_is_rewritten_when_data_is_unchanged(monkeypatch,
							 tmp_path):
	(tmp_path / AGREED_FILE).write_text(STALE_COPY)

	assert run_once(monkeypatch, tmp_path, {}) == 0
	assert_copy_matches(tmp_path)


def test_missing_copy_is_written(monkeypatch, tmp_path):
	assert not (tmp_path / AGREED_FILE).exists()
	run_once(monkeypatch, tmp_path, {})
	assert_copy_matches(tmp_path)


def test_committed_copy_equals_committed_data_json():
	assert_copy_matches(ROOT / "data")


def test_workflow_commits_the_built_in_copy():
	add_lines = [line for line in WORKFLOW.read_text().splitlines()
		     if "git add" in line]

	assert add_lines
	assert any("data/" + AGREED_FILE in line for line in add_lines)


def test_page_loads_the_copy_before_app_js():
	page = PAGE.read_text()
	copy_tag = f'<script src="data/{AGREED_FILE}"></script>'
	app_tag = '<script src="assets/js/app.js"></script>'

	assert copy_tag in page
	assert page.index(copy_tag) < page.index(app_tag)


def test_copy_parses_back_to_the_same_data(monkeypatch, tmp_path):
	run_once(monkeypatch, tmp_path, {})
	data_text, copy_text = texts(tmp_path)
	inner = copy_text[len(AGREED_PREFIX):-len(AGREED_SUFFIX)]

	assert json.loads(inner) == json.loads(data_text)
