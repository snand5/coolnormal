'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../../assets/js/app.js');

const BASE_QUARTER = '1993-Q3';
const QUARTERS_PER_YEAR = 4;
const CHART_IDS = ['gap-chart', 'catch-up-chart', 'wage-chart',
		   'labour-chart'];
const FIRST_LABOUR_MONTHS = ['1993-07', '1993-08', '1993-09'];
const PAGE = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'),
			     'utf8');

function quarters_from_base(count)
{
	const quarters = [];

	for (let step = 0; step < count; step++)
		quarters.push(app.quarter_shifted_by(BASE_QUARTER, step));
	return quarters;
}

function cpi_with_gaps(percent_gaps)
{
	return quarters_from_base(percent_gaps.length).map((quarter, step) => ({
		period: quarter,
		value: 100 * Math.pow(1.025, step / QUARTERS_PER_YEAR) *
		       (1 + percent_gaps[step] / 100),
	}));
}

function monthly(values)
{
	return values.map((value, step) => ({
		period: FIRST_LABOUR_MONTHS[step],
		value: value,
	}));
}

function load(percent_gaps, extra = {})
{
	const cpi = { cpi_quarterly: cpi_with_gaps(percent_gaps) };

	app.set_trend_rate(2.5);
	app.set_chart_range(0);
	app.load_data(Object.assign(cpi, extra));
}

test('every chart has a collapsed data table named by its heading', () => {
	for (const chart_id of CHART_IDS) {
		const table = new RegExp('<details class="chart-data">\\s*' +
			'<summary>Data for this chart</summary>\\s*' +
			'<table aria-labelledby="' + chart_id + '-title">');

		assert.match(PAGE, table, chart_id);
		assert.ok(PAGE.includes('<tbody id="' + chart_id + '-data">'),
			  chart_id);
	}
});

test('view changes are announced in a status region', () => {
	const region = '<p class="visually-hidden" id="view-status" ' +
		       'role="status"></p>';

	assert.ok(PAGE.includes(region));
	load([0, 0]);
	assert.equal(app.view_summary(),
		     'Showing the 2.5% trend over the full series.');
	app.set_trend_rate(2);
	app.set_chart_range(10);
	assert.equal(app.view_summary(),
		     'Showing the 2% trend over the last 10 years.');
});

test('gap table lists every quarter since the base, newest first', () => {
	load([0, -1, -1, 1, 5]);
	const rows = app.gap_table_rows();

	assert.equal(rows.length, 5);
	assert.deepEqual(rows[0], ['Sep 1994', '+5.00']);
	assert.deepEqual(rows[1], ['Jun 1994', '+1.00']);
	assert.deepEqual(rows[2], ['Mar 1994', '−1.00']);
	assert.deepEqual(rows[4], ['Sep 1993', '0.00']);
});

test('catch-up table gives the rounded years for each rate shown', () => {
	load([0, 0, 0, 0, 5]);
	const rows = app.catch_up_table_rows();
	const rates = app.catch_up_rates();

	assert.equal(rows.length, rates.length);
	rates.forEach((rate, i) => {
		const years = Math.round(app.years_back_to_trend(rate));

		assert.deepEqual(rows[i], [rate + '%', String(years)]);
	});
});

test('wage table starts every series at 100 in the base quarter', () => {
	const wages = quarters_from_base(6).map((quarter, step) =>
		({ period: quarter, value: 100 + step }));

	load([0, -1, -1, 1, 1, 1], { wpi_quarterly: wages });
	const rows = app.wage_table_rows();
	const oldest = rows[rows.length - 1];

	assert.equal(rows[0][0], 'Dec 1994');
	assert.deepEqual(oldest, ['Jun 1994', '100.0', '100.0', '100.0']);
	assert.equal(rows[0][2], '101.9');
});

test('labour table lists both rates by month, newest first', () => {
	load([0, 0], {
		unemployment_rate: monthly([10.9, 10.8, 10.6]),
		underutilisation_rate: monthly([17.2, 17.1, 16.9]),
	});
	const rows = app.labour_table_rows();

	assert.deepEqual(rows, [
		['Sep 1993', '10.6', '16.9'],
		['Aug 1993', '10.8', '17.1'],
		['Jul 1993', '10.9', '17.2'],
	]);
});
