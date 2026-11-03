'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../../assets/js/app.js');
const expected = require('./expected-2026-10-29.json');
const cases = require('./cases.json');
const fixture = require('./' + expected.fixture);

const BASE_QUARTER = '1993-Q3';
const RUN_CASE_PATH_RATE = 2.5;
const QUARTERS_PER_YEAR = 4;
const SYNTHETIC_BASE_INDEX = 100;

function assert_close(actual, wanted, tolerance)
{
	const message = actual + ' is not within ' + tolerance +
			' of ' + wanted;

	assert.ok(Math.abs(actual - wanted) <= tolerance, message);
}

function load(data, trend_rate)
{
	app.set_trend_rate(trend_rate);
	app.set_chart_range(0);
	app.load_data(data);
}

function cpi_with_gaps(percent_gaps, trend_rate)
{
	const trend = step => SYNTHETIC_BASE_INDEX *
		Math.pow(1 + trend_rate / 100, step / QUARTERS_PER_YEAR);

	return percent_gaps.map((percent_gap, step) => ({
		period: app.quarter_shifted_by(BASE_QUARTER, step),
		value: trend(step) * (1 + percent_gap / 100),
	}));
}

function check_headline(row)
{
	const run = app.current_run();
	const comparison = app.wage_comparison_window();
	const latest = row.latest_quarter;
	const tolerance = expected.tolerance;

	assert_close(app.percent_above_trend(latest), row.percent_above_trend,
		     tolerance);
	assert.equal(run.is_above, row.is_above);
	assert.equal(run.first_quarter, row.run_first_quarter);
	assert.equal(run.length_in_quarters, row.run_length_in_quarters);
	assert_close(app.average_inflation_since_trend_base(latest),
		     row.average_inflation, tolerance);
	assert_close(app.annual_change(fixture_cpi(), latest),
		     row.annual_change, tolerance);
	assert.deepEqual([comparison.first_quarter, comparison.last_quarter],
			 row.wage_window);
	assert_close(app.wages_relative_to_prices(comparison.first_quarter,
						  comparison.last_quarter),
		     row.wages_relative_to_prices, tolerance);
}

function check_catch_up(row)
{
	const rates = row.years_back_to_trend.map(pair => pair[0]);

	assert.deepEqual(app.catch_up_rates(), rates);
	for (const [rate, years] of row.years_back_to_trend)
		assert_close(app.years_back_to_trend(rate), years,
			     expected.tolerance);
}

function fixture_cpi()
{
	const series = {};

	for (const observation of fixture.cpi_quarterly)
		series[observation.period] = observation.value;
	return series;
}

for (const row of expected.trends) {
	test('headline figures, ' + row.trend_rate + '% trend', () => {
		load(fixture, row.trend_rate);
		check_headline(row);
		check_catch_up(row);
	});
}

for (const item of cases.runs) {
	test(item.rule, () => {
		const cpi = cpi_with_gaps(item.percent_gaps,
					  RUN_CASE_PATH_RATE);
		const run = app.quarter_shifted_by(BASE_QUARTER,
						   item.run_first_step);

		load({ cpi_quarterly: cpi }, item.trend_rate);
		assert.deepEqual(app.current_run(), {
			is_above: item.is_above,
			first_quarter: run,
			length_in_quarters: item.run_length_in_quarters,
		});
	});
}

for (const item of cases.catch_up) {
	test(item.rule, () => {
		const gaps = [0, item.latest_percent_gap];
		const cpi = cpi_with_gaps(gaps, item.trend_rate);

		load({ cpi_quarterly: cpi }, item.trend_rate);
		assert.deepEqual(app.catch_up_rates(), item.rates);
		assert_close(app.years_back_to_trend(item.rate), item.years,
			     cases.tolerance);
	});
}
