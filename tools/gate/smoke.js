'use strict';

// Usage: node smoke.js ADDRESS SCREENSHOT_DIRECTORY
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const SECONDS_TO_WAIT_FOR_FIGURES = 15;
const SECONDS_TO_WAIT_FOR_A_DOWNLOAD = 10;
const MILLISECONDS_PER_SECOND = 1000;
const EMPTY_FIGURE = '—';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const CSV_FIRST_COLUMN = 'quarter,';
const LIVE_DATA_PATH = '/data/data.json';
const HTTP_NOT_FOUND = 404;
const BUILT_IN_COPY_NOTICE = 'built-in copy';
const VIEWS = [
	{ name: 'light', colorScheme: 'light', checks_downloads: true,
	  viewport: { width: 1280, height: 900 } },
	{ name: 'dark', colorScheme: 'dark',
	  viewport: { width: 1280, height: 900 } },
	{ name: 'mobile-light', colorScheme: 'light',
	  viewport: { width: 390, height: 844 } },
	{ name: 'built-in-copy', colorScheme: 'light', without_live_data: true,
	  viewport: { width: 1280, height: 900 } },
];

function is_live_data(address)
{
	return new URL(address).pathname.endsWith(LIVE_DATA_PATH);
}

async function withhold_live_data(page)
{
	await page.route(address => is_live_data(address.href),
		route => route.fulfill({ status: HTTP_NOT_FOUND }));
}

function is_expected_error(view, message)
{
	return view.without_live_data === true &&
		is_live_data(message.location().url);
}

function figures_are_filled(empty_figure)
{
	const figure = document.getElementById('gap-value');

	return figure !== null && figure.textContent !== empty_figure;
}

async function download(page, selector, directory)
{
	const timeout = SECONDS_TO_WAIT_FOR_A_DOWNLOAD *
		MILLISECONDS_PER_SECOND;
	const [file] = await Promise.all([
		page.waitForEvent('download', { timeout: timeout })
			.catch(() => null),
		page.click(selector),
	]);

	if (file === null)
		return null;
	const saved = path.join(directory, file.suggestedFilename());

	await file.saveAs(saved);
	return fs.readFileSync(saved);
}

async function check_downloads(page, directory)
{
	const problems = [];
	const charts = await page.$$eval('[data-png-chart]', links =>
		links.map(link => link.dataset.pngChart));

	for (const chart of charts) {
		const bytes = await download(page,
			'[data-png-chart="' + chart + '"]', directory);

		if (bytes === null)
			problems.push('PNG link downloaded nothing: ' + chart);
		else if (!bytes.subarray(0, PNG_SIGNATURE.length)
			.equals(PNG_SIGNATURE))
			problems.push('PNG download is not a PNG: ' + chart);
	}
	const csv = await download(page, '#csv-download', directory);

	if (csv === null || !csv.toString('utf8').startsWith(CSV_FIRST_COLUMN))
		problems.push('CSV download has no quarter column');
	if ((await page.textContent('#load-status')).includes('failed'))
		problems.push('page reports a failed download');
	return problems.concat(charts.length === 0 ?
		['no PNG links found'] : []);
}

async function check_view(browser, address, screenshot_directory, view)
{
	const context = await browser.newContext({ acceptDownloads: true,
		colorScheme: view.colorScheme, viewport: view.viewport });
	const page = await context.newPage();
	const origin = new URL(address).origin;
	const problems = [];

	page.on('console', message => {
		if (message.type() === 'error' &&
		    !is_expected_error(view, message))
			problems.push('console error: ' + message.text());
	});
	page.on('pageerror', error =>
		problems.push('page error: ' + error.message));
	page.on('request', request => {
		if (new URL(request.url()).origin !== origin)
			problems.push('outside request: ' + request.url());
	});
	if (view.without_live_data)
		await withhold_live_data(page);
	await page.goto(address);
	await page.waitForFunction(figures_are_filled, EMPTY_FIGURE, {
		timeout: SECONDS_TO_WAIT_FOR_FIGURES * MILLISECONDS_PER_SECOND,
	}).catch(() => problems.push('headline figures never filled'));
	if (view.without_live_data &&
	    !(await page.textContent('#load-status'))
		    .includes(BUILT_IN_COPY_NOTICE))
		problems.push('no built-in copy notice without live data');
	if (view.checks_downloads && problems.length === 0)
		problems.push(...await check_downloads(page,
						      screenshot_directory));
	await page.screenshot({ fullPage: true,
		path: path.join(screenshot_directory, view.name + '.png') });
	await context.close();
	return problems;
}

async function main()
{
	const [address, screenshot_directory] = process.argv.slice(2);
	const browser = await chromium.launch({ headless: true });
	let failed = 0;

	for (const view of VIEWS) {
		const problems = await check_view(browser, address,
						  screenshot_directory, view);

		console.log(view.name + ': ' + problems.length + ' problems');
		problems.forEach(problem => console.log('  ' + problem));
		failed += problems.length;
	}
	await browser.close();
	process.exitCode = failed === 0 ? 0 : 1;
}

main();
