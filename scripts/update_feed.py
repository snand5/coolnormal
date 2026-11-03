import collections
import datetime
import json
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as element_tree

from update_data import (DEFAULT_DATA_DIRECTORY, LONGEST_ERROR_MESSAGE_KEPT,
			 USER_AGENT, read_json, replace_file)

FEED_FILE = "rba-feeds.json"
LINK_PREFIX = "https://www.rba.gov.au/"
ENTRIES_KEPT = 3
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


def entry_from_item(item):
	title = item.findtext("rss:title", namespaces=RSS_1_0)
	link = item.findtext("rss:link", namespaces=RSS_1_0)
	date = item.findtext("dc:date", namespaces=RSS_1_0)

	if not (title and link and date):
		raise FeedLooksWrong("an item has no title, link or date")
	if not link.strip().startswith(LINK_PREFIX):
		raise FeedLooksWrong(f"link {link!r} is not on {LINK_PREFIX}")
	return {"title": title.strip(), "link": link.strip(), "date": date[:10]}


def parse_feed(feed_text):
	root = element_tree.fromstring(feed_text)
	items = root.findall("rss:item", RSS_1_0)

	if not items:
		raise FeedLooksWrong("the feed has no items")
	return [entry_from_item(item) for item in items[:ENTRIES_KEPT]]


def read_reply(request):
	with urllib.request.urlopen(request,
				    timeout=SECONDS_TO_WAIT_FOR_RBA) as reply:
		feed_text = reply.read().decode("utf-8")

		return feed_text, reply.headers.get("Last-Modified")


def fetch_feed(address, last_modified):
	headers = {"User-Agent": USER_AGENT}

	if last_modified:
		headers["If-Modified-Since"] = last_modified
	request = urllib.request.Request(address, headers=headers)
	try:
		return read_reply(request)
	except urllib.error.HTTPError as error:
		if error.code != NOT_MODIFIED:
			raise
		return None, last_modified


def refresh_feed(address, feed):
	last_modified = feed.get("last_modified")
	feed_text, last_modified = fetch_feed(address, last_modified)

	if feed_text is None:
		return "unchanged"
	feed["entries"] = parse_feed(feed_text)
	feed["last_modified"] = last_modified
	return "updated"


def refresh_and_record(address, feed):
	try:
		outcome = refresh_feed(address, feed)
		feed["error"] = None
	except (OSError, element_tree.ParseError, FeedLooksWrong) as error:
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
