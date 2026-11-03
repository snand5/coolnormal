'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const STYLES = fs.readFileSync(
	path.join(__dirname, '..', '..', 'assets', 'css', 'style.css'), 'utf8');

function media_block(query)
{
	const start = STYLES.indexOf('@media ' + query + ' {');
	let depth = 0;

	assert.ok(start >= 0, 'no @media ' + query);
	for (let i = STYLES.indexOf('{', start); i < STYLES.length; i++) {
		depth += { '{': 1, '}': -1 }[STYLES[i]] || 0;
		if (depth === 0)
			return STYLES.slice(start, i + 1);
	}
	return STYLES.slice(start);
}

test('forced colours keep the legend swatches and show the choice', () => {
	const block = media_block('(forced-colors: active)');
	const pressed =
		/\[aria-pressed="true"\][^{]*\{[^}]*background: Highlight;/;
	const pressed_kept =
		/\[aria-pressed="true"\][^{]*\{\s*forced-color-adjust: none;/;

	assert.match(block, /\.legend i \{\s*forced-color-adjust: none;/);
	assert.match(block, pressed);
	assert.match(block, /color: HighlightText;/);
	assert.match(block, pressed_kept);
});

test('printing drops the controls and keeps each chart whole', () => {
	const block = media_block('print');
	const controls =
		/\.chart-controls,[^{]*\.link-button,[^{]*\.chart-data/;

	assert.match(block, controls);
	assert.match(block, /display: none;/);
	assert.match(block, /\.chart-box[^{]*\{[^}]*break-inside: avoid;/);
	assert.match(block, /\.legend i \{[^}]*print-color-adjust: exact;/);
});

test('font sizes follow the reader\'s browser setting', () => {
	assert.doesNotMatch(STYLES, /font-size: [0-9.]+px/);
});
