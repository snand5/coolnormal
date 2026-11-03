'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../../assets/js/app.js');
const fixture = require('./fixtures/data-2026-10-29.json');
const expected = require('./expected-2026-10-29.json');

const DATA_ADDRESS = 'data/data.json';
const AGREED_MESSAGE = 'Showing the built-in copy of the data, to the ' +
	'September quarter 2026; live data unavailable. ';
const HEADLINE = expected.trends[0];

function serve_nothing(addresses)
{
	return address => {
		addresses.push(address);
		return Promise.reject(new Error('offline'));
	};
}

function serve_not_found(addresses)
{
	return address => {
		addresses.push(address);
		return Promise.resolve({ ok: false, status: 404 });
	};
}

function serve_fixture(addresses)
{
	return address => {
		const read = () => Promise.resolve(fixture);

		addresses.push(address);
		return Promise.resolve({ ok: true, status: 200, json: read });
	};
}

function set_up(server, built_in_data)
{
	const addresses = [];

	globalThis.fetch = server(addresses);
	globalThis.window = { BUILT_IN_DATA: built_in_data };
	return addresses;
}

function fake_page()
{
	const elements = {};

	globalThis.document = {
		getElementById: id => {
			elements[id] = elements[id] || { textContent: 'unset' };
			return elements[id];
		},
	};
	return elements;
}

function headline_gap(data)
{
	app.set_trend_rate(HEADLINE.trend_rate);
	app.set_chart_range(0);
	app.load_data(data);
	return app.percent_above_trend(HEADLINE.latest_quarter);
}

test('failed fetch uses the built-in copy', async () => {
	const addresses = set_up(serve_nothing, fixture);
	const loaded = await app.load_site_data();

	assert.deepEqual(addresses, [DATA_ADDRESS]);
	assert.equal(loaded.source, 'built-in copy');
	assert.equal(loaded.data, fixture);
});

test('data.json not found uses the built-in copy', async () => {
	set_up(serve_not_found, fixture);
	const loaded = await app.load_site_data();

	assert.equal(loaded.source, 'built-in copy');
});

test('calculations on the built-in copy match the headline table',
     async () => {
	set_up(serve_nothing, fixture);
	const loaded = await app.load_site_data();
	const gap = headline_gap(loaded.data);

	assert.ok(Math.abs(gap - HEADLINE.percent_above_trend) <=
		  expected.tolerance);
});

test('working fetch is live, even with a built-in copy', async () => {
	set_up(serve_fixture, { cpi_quarterly: [] });
	const loaded = await app.load_site_data();

	assert.equal(loaded.source, 'live');
	assert.equal(loaded.data, fixture);
});

test('failed fetch and no built-in copy is a load error', async () => {
	set_up(serve_nothing, undefined);

	await assert.rejects(app.load_site_data());
});

test('the page says it shows the built-in copy, and to which quarter',
     () => {
	const elements = fake_page();

	headline_gap(fixture);
	app.report_data_source('built-in copy');
	assert.equal(elements['load-status'].textContent, AGREED_MESSAGE);
	app.report_data_source('live');
	assert.equal(elements['load-status'].textContent, '');
});
