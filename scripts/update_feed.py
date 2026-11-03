import collections
import datetime
import http.client
import json
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as element_tree

from update_data import (DEFAULT_DATA_DIRECTORY, LONGEST_ERROR_MESSAGE_KEPT,
			 USER_AGENT, read_json, replace_file)

FEED_FILE = "rba-feeds.json"
LINK_PREFIX = "https://www.rba.gov.au/"
ISO_DATE_LENGTH = len("2026-11-03")
LARGEST_FEED_IN_BYTES = 1_000_000
SECONDS_TO_WAIT_FOR_RBA = 60
NOT_MODIFIED = 304
RSS_1_0 = {"rss": "http://purl.org/rss/1.0/",
	   "dc": "http://purl.org/dc/elements/1.1/"}


Feed = collections.namedtuple("Feed", "name address")

FEEDS = [
	Feed(name="media_releases",
	     address="https://www.rba.gov.au/rss/rss-cb-media-releases.xml"),
	Feed(name="statement_on_monetary_policy",
	     address="https://www.rba.gov.au/rss/rss-cb-smp.xml"),
	Feed(name="speeches",
	     address="https://www.rba.gov.au/rss/rss-cb-speeches.xml"),
]


class FeedLooksWrong(Exception):
	pass


def iso_date(text):
	date = text.strip()[:ISO_DATE_LENGTH]

	try:
		return datetime.date.fromisoformat(date).isoformat()
	except ValueError:
		raise FeedLooksWrong(f"date {text!r} is not an ISO date") from None


def entry_from_item(item):
	title = item.findtext("rss:title", namespaces=RSS_1_0)
	link = item.findtext("rss:link", namespaces=RSS_1_0)
	date = item.findtext("dc:date", namespaces=RSS_1_0)

	if not (title and link and date):
		raise FeedLooksWrong("an item has no title, link or date")
	link = link.strip()
	if not link.startswith(LINK_PREFIX):
		raise FeedLooksWrong(f"link {link!r} is not on {LINK_PREFIX}")
	return {"title": title.strip(), "link": link, "date": iso_date(date)}


def latest_entry(feed_bytes):
	root = element_tree.fromstring(feed_bytes)
	items = root.findall("rss:item", RSS_1_0)

	if not items:
		raise FeedLooksWrong("the feed has no items")
	entries = [entry_from_item(item) for item in items]
	return max(entries, key=lambda entry: entry["date"])


def read_reply(request):
	with urllib.request.urlopen(request,
				    timeout=SECONDS_TO_WAIT_FOR_RBA) as reply:
		feed_bytes = reply.read(LARGEST_FEED_IN_BYTES + 1)
		last_modified = reply.headers.get("Last-Modified")

	if len(feed_bytes) > LARGEST_FEED_IN_BYTES:
		raise FeedLooksWrong(f"the feed is over {LARGEST_FEED_IN_BYTES} bytes")
	return feed_bytes, last_modified


def fetch_feed(address, last_modified):
	headers = {"User-Agent": USER_AGENT}

	if last_modified:
		headers["If-Modified-Since"] = last_modified
	request = urllib.request.Request(address, headers=headers)
	try:
		return read_reply(request)
	except urllib.error.HTTPError as error:
		if error.code == NOT_MODIFIED:
			return None, last_modified
		raise


def refresh_feed(address, feed):
	feed_bytes, last_modified = fetch_feed(address,
					       feed.get("last_modified"))

	if feed_bytes is None:
		return "unchanged"
	feed["latest_entry"] = latest_entry(feed_bytes)
	feed["last_modified"] = last_modified
	return "updated"


def refresh_and_record(address, feed):
	try:
		outcome = refresh_feed(address, feed)
		feed["error"] = None
	except (OSError, http.client.HTTPException, element_tree.ParseError,
		FeedLooksWrong) as error:
		outcome = "failed"
		feed["error"] = str(error)[:LONGEST_ERROR_MESSAGE_KEPT]
	return outcome


def main(data_directory=DEFAULT_DATA_DIRECTORY, today=None):
	path = data_directory / FEED_FILE
	feeds = read_json(path, {"feeds": {}})
	outcomes = {}

	feeds["checked"] = today or datetime.date.today().isoformat()
	for source in FEEDS:
		feed = feeds["feeds"].setdefault(source.name, {})
		outcomes[source.name] = refresh_and_record(source.address, feed)
	data_directory.mkdir(exist_ok=True)
	replace_file(path, json.dumps(feeds, indent="\t"))
	for name, outcome in outcomes.items():
		print(f"{name}: {outcome}")
	return 1 if "failed" in outcomes.values() else 0


if __name__ == "__main__":
	sys.exit(main())
