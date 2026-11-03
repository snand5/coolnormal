'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../../assets/js/app.js');

const BASE_QUARTER = '1993-Q3';
const BASE_INDEX = 100;
const TOLERANCE = 1e-9;
const QUARTERS_PER_YEAR = 4;
const TREND_GROWTH_PER_YEAR = 1.025;

function quarters_from_base(count)
{
	const quarters = [];

	for (let step = 0; step < count; step++)
		quarters.push(app.quarter_shifted_by(BASE_QUARTER, step));
	return quarters;
}

function trend_index(step, rate)
{
	return BASE_INDEX * Math.pow(1 + rate / 100, step / QUARTERS_PER_YEAR);
}

function cpi_with_gaps(percent_gaps, rate = 2.5)
{
	return quarters_from_base(percent_gaps.length).map((quarter, step) => ({
		period: quarter,
		value: trend_index(step, rate) * (1 + percent_gaps[step] / 100),
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

function load_at_rate(percent_gaps, rate)
{
	app.set_trend_rate(rate);
	app.load_data({ cpi_quarterly: cpi_with_gaps(percent_gaps, rate) });
}

function assert_close(actual, expected)
{
	assert.ok(Math.abs(actual - expected) < TOLERANCE,
		  actual + ' is not within ' + TOLERANCE + ' of ' + expected);
}

test('quarters shift across year boundaries', () => {
	assert.equal(app.quarter_shifted_by('1993-Q3', 2), '1994-Q1');
	assert.equal(app.quarter_shifted_by('1994-Q1', -1), '1993-Q4');
	assert.equal(app.quarter_shifted_by('2000-Q4', -4), '1999-Q4');
});

test('quarter and month names', () => {
	assert.equal(app.quarter_long_name('1993-Q3'),
		     'September quarter 1993');
	assert.equal(app.quarter_short_name('2026-Q1'), 'Mar 2026');
	assert.equal(app.month_long_name('2026-09'), 'September 2026');
	assert.equal(app.quarter_of_month('2026-09'), '2026-Q3');
	assert.equal(app.first_month_of_quarter('1993-Q3'), '1993-07');
	assert.equal(app.last_month_of_quarter('1993-Q3'), '1993-09');
	assert.equal(app.last_month_of_quarter('1993-Q4'), '1993-12');
	assert.equal(app.month_position('1994-01') -
		     app.month_position('1993-12'), 1);
});

test('trend grows at the selected rate from September quarter 1993', () => {
	load([0, 0, 0, 0, 0]);
	assert_close(app.trend_price_level('1993-Q3'), 100);
	assert_close(app.trend_price_level('1994-Q3'), 102.5);
	app.set_trend_rate(2);
	assert_close(app.trend_price_level('1994-Q3'), 102);
});

test('gap is CPI over trend minus one, in per cent', () => {
	load([0, 0, 0, 0, 1]);
	assert_close(app.percent_above_trend('1994-Q3'), 1);
	assert.equal(app.is_above_trend('1994-Q3'), true);
	load([0, 0, 0, 0, -1]);
	assert_close(app.percent_above_trend('1994-Q3'), -1);
	assert.equal(app.is_above_trend('1994-Q3'), false);
});

test('a gap of exactly zero counts as above trend', () => {
	load([0, 0]);
	assert.equal(app.is_above_trend('1993-Q4'), true);
});

test('annual change compares with four quarters earlier', () => {
	const series = { '1993-Q3': 100, '1994-Q3': 102.5 };

	assert_close(app.annual_change(series, '1994-Q3'), 2.5);
	assert.equal(app.annual_change(series, '1994-Q2'), null);
	assert.equal(app.annual_change(series, '1995-Q3'), null);
});

test('average inflation is the compound annual rate since 1993', () => {
	const growth_over_two_years = TREND_GROWTH_PER_YEAR ** 2 * 1.1;

	load([0, 0, 0, 0, 0, 0, 0, 0, 0]);
	assert_close(app.average_inflation_since_trend_base('1995-Q3'),
		     2.5);
	load([0, 0, 0, 0, 0, 0, 0, 0, 10]);
	assert_close(app.average_inflation_since_trend_base('1995-Q3'),
		     (Math.sqrt(growth_over_two_years) - 1) * 100);
});

test('catch-up years follow ln(1 + gap) / ln(1.025 / (1 + r))', () => {
	load([0, 0, 0, 0, 5]);
	for (const rate of [1, 1.75, 2.25]) {
		const closing = TREND_GROWTH_PER_YEAR / (1 + rate / 100);

		assert_close(app.years_back_to_trend(rate),
			     Math.log(1.05) / Math.log(closing));
	}
});

test('catch-up rates lie below the trend rate when above trend', () => {
	load([0, 0, 0, 0, 5]);
	assert.deepEqual(app.catch_up_rates(), [1, 1.25, 1.5, 1.75, 2, 2.25]);
	load_at_rate([0, 0, 0, 0, 5], 2);
	assert.deepEqual(app.catch_up_rates(), [1, 1.25, 1.5, 1.75]);
});

test('catch-up rates lie above the trend rate when below trend', () => {
	load([0, 0, 0, 0, -5]);
	assert.deepEqual(app.catch_up_rates(),
			 [2.75, 3, 3.25, 3.5, 3.75, 4]);
});

test('one quarter on the other side does not end the run', () => {
	load([0, -1, -1, 1, -0.5, 1, 2, 2, 3]);
	assert.deepEqual(app.current_run(), {
		is_above: true,
		first_quarter: '1994-Q2',
		length_in_quarters: 6,
	});
});

test('two quarters on the other side end the run', () => {
	load([0, -1, -1, 1, -0.5, -0.5, 2, 2, 3]);
	assert.deepEqual(app.current_run(), {
		is_above: true,
		first_quarter: '1995-Q1',
		length_in_quarters: 3,
	});
});

test('a run below trend is found the same way', () => {
	load([0, 1, 1, -1, 0.5, -1, -2]);
	assert.deepEqual(app.current_run(), {
		is_above: false,
		first_quarter: '1994-Q2',
		length_in_quarters: 4,
	});
});

test('September quarter 1993 is on trend by definition', () => {
	load([5, 5]);
	assert_close(app.percent_above_trend('1993-Q3'), 0);
});

test('a run never starts before September quarter 1993', () => {
	load([0, 1, 1, 1]);
	assert.equal(app.current_run().first_quarter, '1993-Q3');
	load([0, -1, 1, 1]);
	assert.equal(app.current_run().first_quarter, '1993-Q3');
});

test('wages relative to prices compare growth over the same window', () => {
	const wages = [
		{ period: '1993-Q3', value: 50 },
		{ period: '1993-Q4', value: 50.5 },
		{ period: '1994-Q1', value: 51 },
		{ period: '1994-Q2', value: 51.5 },
		{ period: '1994-Q3', value: 52 },
	];

	load([0, 0, 0, 0, 0], { wpi_quarterly: wages });
	assert_close(app.wages_relative_to_prices('1993-Q3', '1994-Q3'),
		     (1.04 / TREND_GROWTH_PER_YEAR - 1) * 100);
});

test('the wage window starts at the run and ends at the older latest', () => {
	const wages = quarters_from_base(4).map(quarter =>
		({ period: quarter, value: 100 }));

	load([0, -1, -1, 1, 1, 1], { wpi_quarterly: wages });
	assert.deepEqual(app.wage_comparison_window(), {
		first_quarter: '1994-Q2',
		last_quarter: '1994-Q2',
	});
	assert.equal(app.wage_comparison_available(), false);
});

test('the 2% and 3% paths are shown relative to the trend', () => {
	load([0, 0, 0, 0, 0]);
	assert_close(app.path_relative_to_trend(2, '1994-Q3'),
		     (1.02 / TREND_GROWTH_PER_YEAR - 1) * 100);
	assert_close(app.path_relative_to_trend(3, '1994-Q3'),
		     (1.03 / TREND_GROWTH_PER_YEAR - 1) * 100);
});

test('the monthly reading is used only once it covers the quarter', () => {
	const september = { period: '1994-09', annual_change: 2.4 };
	const august = { period: '1994-08', annual_change: 2.4 };

	load([0, 0, 0, 0, 0], { latest_month: september });
	assert.equal(app.monthly_reading_is_current(), true);
	load([0, 0, 0, 0, 0], { latest_month: august });
	assert.equal(app.monthly_reading_is_current(), false);
	load([0, 0, 0, 0, 0]);
	assert.equal(app.monthly_reading_is_current(), false);
});

test('loading data rejects two values for one period', () => {
	const repeated = [
		{ period: '1993-Q3', value: 100 },
		{ period: '1993-Q3', value: 101 },
	];

	assert.throws(() => app.load_data({ cpi_quarterly: repeated }),
		      /more than one value for a period/);
});

test('loading data requires at least one CPI observation', () => {
	assert.throws(() => app.load_data({ cpi_quarterly: [] }),
		      /at least one CPI observation/);
});

test('numbers use a true minus sign and an optional plus sign', () => {
	assert.equal(app.format_number(-1.25, 1), '−1.3');
	assert.equal(app.format_signed_number(1.25, 2), '+1.25');
	assert.equal(app.format_signed_number(-1.25, 2), '−1.25');
	assert.equal(app.format_signed_number(0, 1), '0.0');
	assert.equal(app.format_number(1.25, 2), '1.25');
});

test('a browser block is caught and reported as not run', () => {
	const blocked = () => {
		const security_error = new Error('blocked');

		security_error.name = 'SecurityError';
		throw security_error;
	};

	assert.equal(app.run_unless_blocked(blocked), false);
	assert.equal(app.run_unless_blocked(() => {}), true);
});

test('any other error is not mistaken for a browser block', () => {
	const broken = () => {
		throw new TypeError('bug');
	};

	assert.throws(() => app.run_unless_blocked(broken), TypeError);
});

test('a failed download is shown to the reader and still thrown', () => {
	const load_status = { textContent: '' };
	const broken = () => {
		throw new TypeError('bug');
	};

	globalThis.document = { getElementById: () => load_status };
	assert.throws(() => app.download_or_report(broken), TypeError);
	assert.equal(load_status.textContent, 'Download failed. ');
	delete globalThis.document;
});

test('months and quarters shift the same way: positive is later', () => {
	assert.equal(app.quarter_shifted_by('2026-Q3', -40), '2016-Q3');
	assert.equal(app.month_shifted_by_years('2026-09', -10), '2016-09');
	assert.equal(app.month_shifted_by_years('2016-09', 10), '2026-09');
});
