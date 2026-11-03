'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SITE_ADDRESS = 'https://coolnormal.com/';
const PLACEHOLDER_ADDRESS = /example\.com/;
const FILES_NAMING_THE_SITE = ['index.html', 'robots.txt', 'sitemap.xml'];
const SOCIAL_IMAGE = `${SITE_ADDRESS}assets/img/social.png`;
const ADDRESSES_IN_THE_PAGE = [
	`<link rel="canonical" href="${SITE_ADDRESS}">`,
	`<meta property="og:url" content="${SITE_ADDRESS}">`,
	`<meta property="og:image" content="${SOCIAL_IMAGE}">`,
	`<meta name="twitter:image" content="${SOCIAL_IMAGE}">`,
	`"url": "${SITE_ADDRESS}",`,
	`"contentUrl": "${SITE_ADDRESS}data/data.json"`,
];
const COPYRIGHT_LINE = /^Copyright \(c\) 2026 coolnormal\.com$/m;

function read(file)
{
	return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

test('no placeholder address is left in the shipped files', () => {
	for (const file of FILES_NAMING_THE_SITE)
		assert.doesNotMatch(read(file), PLACEHOLDER_ADDRESS, file);
});

test('the page metadata names the site address', () => {
	const page = read('index.html');

	for (const address of ADDRESSES_IN_THE_PAGE)
		assert.ok(page.includes(address), address);
});

test('robots.txt and sitemap.xml name the site address', () => {
	assert.ok(read('robots.txt').includes(
		`Sitemap: ${SITE_ADDRESS}sitemap.xml`));
	assert.ok(read('sitemap.xml').includes(`<loc>${SITE_ADDRESS}</loc>`));
});

test('the code licence names coolnormal.com as the holder', () => {
	assert.match(read('LICENSE'), COPYRIGHT_LINE);
});
