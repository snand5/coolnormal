'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SITE_NAME = 'Australian Price Level vs 2.5% Trend';
const SHIPPED_TEXT_FILES = ['README.md', 'index.html', 'assets/js/app.js'];
const TARGETING_START_CLAIMS = [
	/targeting (began|start)/i,
	/start of inflation targeting/i,
	/INFLATION_TARGETING/,
	/since_targeting/,
];
const CPI_NOTE = /<p[^>]*id="cpi-note"[^>]*>([^]*?)<\/p>/;

function read(file)
{
	return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function page_cpi_note()
{
	const note = read('index.html').match(CPI_NOTE);

	assert.ok(note, 'index.html has no element with id="cpi-note"');
	return note[1].replace(/\s+/g, ' ');
}

function readme_cpi_paragraph()
{
	const paragraph = read('README.md').match(/^The price level is .*$/m);

	assert.ok(paragraph,
		  'README has no paragraph starting "The price level is"');
	return paragraph[0];
}

function assert_states_cpi_composition(text)
{
	assert.match(text, /ABS all groups CPI/);
	assert.match(text,
		     /interest charges before the September quarter 1998/);
	assert.match(text, /1999–2000 tax changes, including the GST/);
	assert.match(text, /RBA table G1/);
	assert.match(text, /as the RBA does/);
	assert.match(text, /Headline inflation is the CPI as published/);
}

test('nothing says inflation targeting began in 1993', () => {
	for (const file of SHIPPED_TEXT_FILES)
		for (const claim of TARGETING_START_CLAIMS)
			assert.doesNotMatch(read(file), claim, file);
});

test('the trend is described as running from the September quarter 1993',
     () => {
	const base_is_a_choice =
		/the September quarter 1993 is this site's choice of base/;

	assert.match(read('README.md'),
		     /2\.5 per cent a year from the September quarter 1993\./);
	assert.match(read('README.md'), base_is_a_choice);
});

test('the page states how the price level is adjusted', () => {
	assert_states_cpi_composition(page_cpi_note());
});

test('the README states how the price level is adjusted',
     () => {
	assert_states_cpi_composition(readme_cpi_paragraph());
});

test('a quarter after "from" or "since" takes "the"', () => {
	const missing_the =
		/\b(from|since) (March|June|September|December) quarter/;

	for (const file of SHIPPED_TEXT_FILES)
		assert.doesNotMatch(read(file), missing_the, file);
});

test('the page names no run start until the data says which', () => {
	const run_start_claim = /(Above|Below) trend since/;

	assert.doesNotMatch(read('index.html'), run_start_claim);
});

test('the trend is explained as a yardstick, not a trend estimate', () => {
	const explanation = /not a statistical trend estimate/;

	assert.match(read('README.md'), explanation);
});

test('the wage figure uses the RBA term, real Wage Price Index', () => {
	const old_label = /Wage Price Index vs CPI/;

	for (const file of SHIPPED_TEXT_FILES)
		assert.doesNotMatch(read(file), old_label, file);
	assert.match(read('index.html'),
		     /<dt id="wage-label">Real Wage Price Index<\/dt>/);
});

test('sentences in the page metadata say "per cent"', () => {
	const descriptions = [...read('index.html').matchAll(
		/(?:content=|"description": )"([^"]*a year[^"]*)"/g)]
		.map(match => match[1].replace(SITE_NAME, ''));

	assert.ok(descriptions.length >= 4);
	for (const text of descriptions)
		assert.doesNotMatch(text, /[0-9]%/, text);
});

test('the page metadata credits the RBA data as well as the ABS', () => {
	const descriptions = [...read('index.html').matchAll(
		/(?:content=|"description": )"([^"]*updated weekly[^"]*)"/g)]
		.map(match => match[1]);
	const short_credit = /ABS and RBA data/;
	const full_credit =
		/Australian Bureau of Statistics and Reserve Bank of Australia/;

	assert.ok(descriptions.length >= 4);
	for (const text of descriptions)
		assert.ok(short_credit.test(text) || full_credit.test(text),
			  text);
});

test('the trend rates are tied to the RBA target range', () => {
	const midpoint =
		/2\.5 per cent[^.]*midpoint of the 2–3 per cent target range/;
	const bottom = /2 per cent[^.]*bottom of that range/;

	assert.match(read('README.md'), midpoint);
	assert.match(read('README.md'), bottom);
});


test('the main chart carries no trend explanation; the README does', () => {
	assert.ok(!read('index.html').includes('id="trend-note"'));
});
