import io
import json
import urllib.error

import pytest

from conftest import load_feed_script

update_feed = load_feed_script()

FIRST_DAY = "2026-11-03"
NEXT_DAY = "2026-11-10"
LAST_MODIFIED = "Tue, 03 Nov 2026 02:45:05 GMT"
SMP_ADDRESS = "https://www.rba.gov.au/rss/rss-cb-smp.xml"
ITEM = """
  <item rdf:about="{link}">
    <title>{title}</title>
    <link>{link}</link>
    <dc:date>{date}</dc:date>
  </item>"""
FEED = """<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
	 xmlns:dc="http://purl.org/dc/elements/1.1/"
	 xmlns="http://purl.org/rss/1.0/">
  <channel rdf:about="https://www.rba.gov.au/rss/rss-cb-smp.xml">
    <title>Statements on Monetary Policy</title>
    <link>https://www.rba.gov.au/publications/smp/</link>
    <description>Issued four times a year.</description>
  </channel>{items}
</rdf:RDF>"""


def feed_text(*entries):
	items = "".join(ITEM.format(title=title, link=link, date=date)
			for title, link, date in entries)

	return FEED.format(items=items)


OTHER_FEED = feed_text(("Media release",
			"https://www.rba.gov.au/media-releases/2026/",
			"2026-11-01T09:00+11:00"))


def statement(month, date):
	return ("Statement on Monetary Policy",
		f"https://www.rba.gov.au/publications/smp/2026/{month}/",
		date)


class Reply(io.BytesIO):
	def __init__(self, text, last_modified):
		super().__init__(text.encode("utf-8"))
		self.headers = {"Last-Modified": last_modified}

	def __enter__(self):
		return self

	def __exit__(self, *exception):
		self.close()


class FakeRba:
	def __init__(self):
		self.requests = []
		self.response = None

	def urlopen(self, request, timeout):
		self.requests.append(request)
		if request.full_url != SMP_ADDRESS:
			return Reply(OTHER_FEED, LAST_MODIFIED)
		if isinstance(self.response, Exception):
			raise self.response
		return Reply(self.response, LAST_MODIFIED)


@pytest.fixture
def rba(monkeypatch):
	fake = FakeRba()

	monkeypatch.setattr(update_feed.urllib.request, "urlopen", fake.urlopen)
	return fake


def read_all(data_directory):
	return json.loads((data_directory / update_feed.FEED_FILE).read_text())


def read_feed(data_directory):
	return read_all(data_directory)["feeds"]["statement_on_monetary_policy"]


def smp_requests(rba):
	return [request for request in rba.requests
		if request.full_url == SMP_ADDRESS]


def test_entries_keep_title_link_and_date(rba, tmp_path):
	rba.response = feed_text(statement("nov", "2026-11-03T14:30+11:00"))

	assert update_feed.main(tmp_path, FIRST_DAY) == 0
	assert read_feed(tmp_path)["entries"] == [{
		"title": "Statement on Monetary Policy",
		"link": "https://www.rba.gov.au/publications/smp/2026/nov/",
		"date": "2026-11-03"}]


def test_only_the_latest_entries_are_kept(rba, tmp_path):
	months = ["nov", "aug", "may", "feb"]
	rba.response = feed_text(*[statement(month, "2026-01-01T00:00+11:00")
				   for month in months])

	update_feed.main(tmp_path, FIRST_DAY)
	entries = read_feed(tmp_path)["entries"]

	assert len(entries) == update_feed.ENTRIES_KEPT
	assert entries[0]["link"].endswith("/nov/")


def test_a_link_away_from_the_rba_is_rejected(rba, tmp_path):
	rba.response = feed_text(("Elsewhere", "https://example.org/",
				  "2026-11-03T14:30+11:00"))

	assert update_feed.main(tmp_path, FIRST_DAY) == 1
	assert "entries" not in read_feed(tmp_path)


def test_request_names_the_site_and_asks_only_for_changes(rba, tmp_path):
	rba.response = feed_text(statement("nov", "2026-11-03T14:30+11:00"))
	update_feed.main(tmp_path, FIRST_DAY)
	update_feed.main(tmp_path, NEXT_DAY)
	first, second = smp_requests(rba)

	assert first.get_header("User-agent") == update_feed.USER_AGENT
	assert first.get_header("If-modified-since") is None
	assert second.get_header("If-modified-since") == LAST_MODIFIED


def test_not_modified_keeps_the_entries(rba, tmp_path):
	rba.response = feed_text(statement("nov", "2026-11-03T14:30+11:00"))
	update_feed.main(tmp_path, FIRST_DAY)
	rba.response = urllib.error.HTTPError(SMP_ADDRESS, 304,
					      "Not Modified", {}, None)

	assert update_feed.main(tmp_path, NEXT_DAY) == 0
	assert read_all(tmp_path)["checked"] == NEXT_DAY
	assert len(read_feed(tmp_path)["entries"]) == 1


def test_failed_fetch_keeps_the_entries_and_records_the_error(rba,
							      tmp_path):
	rba.response = feed_text(statement("nov", "2026-11-03T14:30+11:00"))
	update_feed.main(tmp_path, FIRST_DAY)
	rba.response = urllib.error.URLError("no route to host")

	assert update_feed.main(tmp_path, NEXT_DAY) == 1
	feed = read_feed(tmp_path)
	assert len(feed["entries"]) == 1
	assert "no route to host" in feed["error"]


def test_every_relevant_rba_feed_is_fetched(rba, tmp_path):
	rba.response = feed_text(statement("nov", "2026-11-03T14:30+11:00"))
	update_feed.main(tmp_path, FIRST_DAY)
	addresses = sorted(request.full_url for request in rba.requests)

	assert addresses == [
		"https://www.rba.gov.au/rss/rss-cb-media-releases.xml",
		"https://www.rba.gov.au/rss/rss-cb-smp.xml",
		"https://www.rba.gov.au/rss/rss-cb-speeches.xml",
	]
