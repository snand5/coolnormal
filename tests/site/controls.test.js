'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const STYLE_SHEET = fs.readFileSync(
	path.join(ROOT, 'assets', 'css', 'style.css'), 'utf8');
const CHART_COUNT = 4;

test('nothing is a link to nowhere acting as a button', () => {
	assert.doesNotMatch(PAGE, /href="#"/);
});

test('the PNG and CSV downloads are buttons', () => {
	const png_buttons = PAGE.match(
		/<button type="button" class="link-button" data-png-chart=/g);

	assert.equal(png_buttons.length, CHART_COUNT);
	assert.match(PAGE, new RegExp('<button type="button" ' +
		'class="link-button" id="csv-download">CSV</button>'));
});

test('download buttons look like the links beside them', () => {
	const start = STYLE_SHEET.indexOf('.link-button {');
	const rule = STYLE_SHEET.slice(start, STYLE_SHEET.indexOf('}', start));

	assert.notEqual(start, -1, 'style.css has no .link-button rule');
	assert.match(rule, /color: var\(--link\);/);
	assert.match(rule, /background: none;/);
	assert.match(rule, /border: 0;/);
});

test('download buttons are at least 24 px targets', () => {
	const start = STYLE_SHEET.indexOf('.link-button {');
	const rule = STYLE_SHEET.slice(start, STYLE_SHEET.indexOf('}', start));

	assert.match(rule, /min-height: 24px;/);
	assert.match(rule, /min-width: 24px;/);
});
