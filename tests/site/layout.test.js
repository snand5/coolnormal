'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const STYLE_SHEET = fs.readFileSync(
	path.join(__dirname, '..', '..', 'assets', 'css', 'style.css'), 'utf8');
const NARROW_LAYOUT = '@media (max-width: 860px) {\n\t.columns {';

function block_after(marker)
{
	const start = STYLE_SHEET.indexOf(marker);

	assert.notEqual(start, -1, 'style.css has no ' + marker);
	return STYLE_SHEET.slice(start, STYLE_SHEET.indexOf('}', start));
}

test('the narrow layout lets the column shrink below its content',
     () => {
	const columns = block_after(NARROW_LAYOUT).split('.columns {')[1];

	assert.match(columns, /grid-template-columns: minmax\(0, 1fr\);/);
});

test('the trend buttons wrap instead of widening the page', () => {
	assert.match(block_after('.chart-controls .trend-group {'),
		     /flex-wrap: wrap;/);
});
