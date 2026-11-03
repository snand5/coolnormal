'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../../assets/js/app.js');

const ROOT = path.join(__dirname, '..', '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const STYLE_SHEET = fs.readFileSync(
	path.join(ROOT, 'assets', 'css', 'style.css'), 'utf8');
const QUARTERS_PER_YEAR = 4;
const TREND_GROWTH_PER_YEAR = 1.025;
const SECONDARY_FIGURES = ['headline-inflation-label', 'wage-label',
			   'labour-label', 'average-inflation-label'];

function headline_figures()
{
	const start = PAGE.indexOf('<dl class="headline-figures">');

	return PAGE.slice(start, PAGE.indexOf('</dl>', start));
}

function rule_body(selector)
{
	const start = STYLE_SHEET.indexOf(selector + ' {');

	assert.notEqual(start, -1, 'style.css has no rule ' + selector);
	return STYLE_SHEET.slice(start, STYLE_SHEET.indexOf('}', start));
}

test('the gap is the first headline figure, with the run under it',
     () => {
	const labels = [...headline_figures().matchAll(/<dt id="([a-z-]+)"/g)]
		.map(match => match[1]);
	const primary = headline_figures().split('</div>')[0];

	assert.deepEqual(labels, ['gap-label'].concat(SECONDARY_FIGURES));
	assert.match(primary, /class="primary-figure"/);
	assert.match(primary, /id="gap-value"/);
	assert.match(primary, /id="run-summary"/);
	assert.doesNotMatch(PAGE, /id="run-(label|value)"/);
});

test('the primary value is the largest figure; the others are equal',
     () => {
	assert.match(rule_body('.headline-figures .primary-figure dd b'),
		     /font-size: 1\.25rem;/);
	assert.match(rule_body('.headline-figures dd'),
		     /font-size: \.9375rem;/);
	assert.doesNotMatch(rule_body('.headline-figures dd b'),
			    /font-size/);
	assert.match(rule_body('.headline-figures .run-summary'),
		     /font-size: \.875rem;/);
});

test('the run reads as one sentence', () => {
	const trend = step =>
		Math.pow(TREND_GROWTH_PER_YEAR, step / QUARTERS_PER_YEAR);
	const cpi = [0, -1, -1, 1, 1, 2].map((gap, step) => ({
		period: app.quarter_shifted_by('1993-Q3', step),
		value: 100 * (1 + gap / 100) * trend(step),
	}));

	app.set_trend_rate(2.5);
	app.load_data({ cpi_quarterly: cpi });
	assert.equal(app.run_summary(),
		     'Above trend since the June quarter 1994 (3 quarters)');
});

test('in the narrow band the gap takes a full row, the rest 2 by 2',
     () => {
	const narrow = STYLE_SHEET.indexOf(
		'@media (max-width: 860px) {\n\t.headline-figures {');
	const block = STYLE_SHEET.slice(narrow,
					STYLE_SHEET.indexOf('\n}', narrow));

	assert.notEqual(narrow, -1, 'no narrow-band headline rules');
	assert.match(block,
		     /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
	assert.match(block, /\.primary-figure {\n\t\tgrid-column: 1 \/ -1;/);
});
