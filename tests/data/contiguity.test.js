'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../../assets/js/app.js');
const fixture = require('./fixtures/data-2026-10-29.json');

const SERIES_THE_PAGE_LOADS = [
	'cpi_quarterly', 'wpi_quarterly', 'unemployment_rate',
	'underutilisation_rate',
];
const TREND_RATE = 2.5;

function copy_of_fixture()
{
	return JSON.parse(JSON.stringify(fixture));
}

function without_middle_period(name)
{
	const data = copy_of_fixture();
	const observations = data[name];

	observations.splice(Math.floor(observations.length / 2), 1);
	return data;
}

function load(data)
{
	app.set_trend_rate(TREND_RATE);
	app.set_chart_range(0);
	app.load_data(data);
}

test('contiguous data loads', () => {
	assert.doesNotThrow(() => load(copy_of_fixture()));
});

for (const name of SERIES_THE_PAGE_LOADS) {
	test('missing period in ' + name + ' is a load error, not below trend',
	     () => {
		assert.throws(() => load(without_middle_period(name)),
			      new RegExp(name));
	});
}
