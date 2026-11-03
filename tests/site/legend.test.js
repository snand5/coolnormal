'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../../assets/js/app.js');

const PAGE = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'),
			     'utf8');
const SMALLEST_TICK_GAP_IN_PIXELS = 8;

function legend_swatch_classes()
{
	return [...PAGE.matchAll(/<i class="([a-z -]+)"><\/i>/g)]
		.map(match => match[1].split(' '));
}

test('every legend swatch has a kind the PNG legend can draw', () => {
	const kinds = legend_swatch_classes().map(app.swatch_kind);

	assert.ok(kinds.length > 0);
	assert.ok(kinds.every(kind => ['line', 'box', 'marker'].includes(kind)),
		  kinds.join(', '));
});

test('the run-start marker is drawn as a marker, not a box', () => {
	assert.equal(app.swatch_kind(['key-marker']), 'marker');
	assert.equal(app.swatch_kind(['key-line', 'price']), 'line');
	assert.equal(app.swatch_kind(['key-box', 'target-range']), 'box');
});

test('x-axis labels keep a gap so they never touch', () => {
	const ticks = app.x_axis_ticks();

	assert.equal(ticks.autoSkip, true);
	assert.ok(ticks.autoSkipPadding >= SMALLEST_TICK_GAP_IN_PIXELS);
});

test('the target-range band edges stay out of the tooltip', () => {
	const band_edge = { dataset: app.band_edge_style() };
	const gap_line = { dataset: { label: 'Vs trend' } };

	assert.equal(app.shows_in_tooltip(band_edge), false);
	assert.equal(app.shows_in_tooltip(gap_line), true);
});
