'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../../assets/js/app.js');

const BASE_QUARTER = '1993-Q3';
const QUARTERS_PER_YEAR = 4;
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

const FIRST_LABOUR_MONTHS = ['1993-07', '1993-08', '1993-09'];

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
	const data = Object.assign(cpi, extra);

	app.set_trend_rate(2.5);
	app.set_chart_range(0);
	app.load_data(data);
}

test('catch-up chart label states the years for each rate', () => {
	load([0, 0, 0, 0, 5]);
	const description = app.describe_catch_up_chart();

	for (const rate of app.catch_up_rates()) {
		const years = Math.round(app.years_back_to_trend(rate));
		const phrase = rate + ' per cent: about ' + years + ' years';

		assert.ok(description.includes(phrase), description);
	}
	assert.match(description, /2\.5% trend/);
});

test('price-level chart label states the latest gap and run start',
     () => {
	load([0, -1, -1, 1, 1, 2, 2, 3, 5]);
	const description = app.describe_gap_chart();

	assert.match(description,
		     /\+5\.0 per cent in the September quarter 1995/);
	assert.match(description, /above trend since the June quarter 1994/);
	assert.match(description, /2\.5% trend/);
});

test('wage chart label states growth since the run began', () => {
	const wages = quarters_from_base(6).map((quarter, step) =>
		({ period: quarter, value: 100 + step }));

	load([0, -1, -1, 1, 1, 1], { wpi_quarterly: wages });
	const description = app.describe_wage_chart();

	assert.match(description,
		     /June quarter 1994 to the December quarter 1994/);
	assert.match(description, /Wage Price Index rose 1\.9 per cent/);
});

test('labour chart label states the latest rates', () => {
	const unemployment = monthly([10.9, 10.8, 10.6]);
	const underutilisation = monthly([17.2, 17.1, 16.9]);

	load([0, 0], { unemployment_rate: unemployment,
		       underutilisation_rate: underutilisation });
	const description = app.describe_labour_chart();

	assert.match(description, /September 1993/);
	assert.match(description, /unemployment rate 10\.6 per cent/);
	assert.match(description, /underutilisation rate 16\.9 per cent/);
});

test('every chart has a heading its PNG title comes from', () => {
	const chart_ids = [...PAGE.matchAll(/<canvas id="([a-z-]+)"/g)]
		.map(match => match[1]);
	const heading_pattern = /<h2 class="chart-title" id="([a-z-]+)"/g;
	const heading_ids = [...PAGE.matchAll(heading_pattern)]
		.map(match => match[1]);

	assert.equal(chart_ids.length, 4);
	for (const chart_id of chart_ids) {
		const link = new RegExp('data-png-chart="' + chart_id +
					'" data-png-title="([a-z-]+)"');
		const title = PAGE.match(link);

		assert.ok(title, chart_id + ' has no PNG title');
		assert.ok(heading_ids.includes(title[1]), chart_id);
	}
	assert.match(PAGE, /<h2 class="chart-title" id="gap-chart-title">/);
});

test('labour data availability is one named check', () => {
	load([0, 0]);
	assert.equal(app.labour_data_available(), false);
	load([0, 0], { unemployment_rate: monthly([10.9, 10.8, 10.6]),
		       underutilisation_rate: monthly([17.2, 17.1, 16.9]) });
	assert.equal(app.labour_data_available(), true);
});
