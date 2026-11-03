'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../../assets/js/app.js');

const PAGE = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'),
			     'utf8');
const NOVEMBER = {
	title: 'Statement on Monetary Policy',
	link: 'https://www.rba.gov.au/publications/smp/2026/nov/',
	date: '2026-11-03',
};

test('only entries that link to the RBA are shown', () => {
	const elsewhere = Object.assign({}, NOVEMBER,
					{ link: 'https://example.org/' });
	const script = Object.assign({}, NOVEMBER,
				     { link: 'javascript:alert(1)' });
	const untitled = Object.assign({}, NOVEMBER, { title: '' });
	const undated = Object.assign({}, NOVEMBER, { date: '3 Nov 2026' });
	const feeds = { feeds: {
		media_releases: { latest_entry: elsewhere },
		statement_on_monetary_policy: { latest_entry: NOVEMBER },
		speeches: { latest_entry: script },
		bulletin: { latest_entry: untitled },
		research: { latest_entry: undated },
	} };

	assert.deepEqual(app.feed_entries_shown(feeds), [NOVEMBER]);
	assert.deepEqual(app.feed_entries_shown({}), []);
});

test('the latest entry of each feed is shown, newest first', () => {
	const speech = Object.assign({}, NOVEMBER, {
		title: 'Opening Statement',
		link: 'https://www.rba.gov.au/speeches/2026/',
		date: '2026-10-28',
	});
	const feeds = { feeds: {
		speeches: { latest_entry: speech },
		statement_on_monetary_policy: { latest_entry: NOVEMBER },
		media_releases: { error: 'HTTP 503' },
	} };

	assert.deepEqual(app.feed_entries_shown(feeds), [NOVEMBER, speech]);
});

test('the feed is credited to the RBA with the year', () => {
	assert.equal(app.feed_credit([NOVEMBER]), 'Source: RBA 2026.');
});

test('the feed box is in the page and hidden until it has entries', () => {
	assert.match(PAGE, /<section class="sidebar" id="rba-feed" hidden/);
	assert.ok(PAGE.includes('<ul class="feed-entries" ' +
				'id="rba-feed-entries"></ul>'));
	for (const feed of ['media-releases', 'smp', 'speeches'])
		assert.ok(PAGE.includes('href="https://www.rba.gov.au/rss/' +
					'rss-cb-' + feed + '.xml"'), feed);
});
