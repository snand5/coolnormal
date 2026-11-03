'use strict';

// Usage: node accessibility.js ADDRESS OUTPUT_DIRECTORY
// Measures against WCAG 2.2; prints JSON.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const DESKTOP = { width: 1280, height: 900 };
const REFLOW_WIDTH = 320;
const DOUBLE_ZOOM_WIDTH = 640;
const PHONE_HEIGHT = 844;
const TAB_STOPS_TO_WALK = 40;
const SECONDS_TO_WAIT_FOR_FIGURES = 15;
const MILLISECONDS_PER_SECOND = 1000;
const WCAG = {
	text_ratio: 4.5,
	large_text_ratio: 3,
	non_text_ratio: 3,
	large_text_points: 18,
	large_bold_text_points: 14,
	bold_weight: 700,
	points_per_css_pixel: 0.75,
	target_css_pixels: 24,
	linear_threshold: 0.04045,
	linear_divisor: 12.92,
	gamma_offset: 0.055,
	gamma: 2.4,
	red_weight: 0.2126,
	green_weight: 0.7152,
	blue_weight: 0.0722,
	ratio_offset: 0.05,
};
const CHANNEL_MAXIMUM = 255;
const NON_TEXT_ROLES = [
	'--price', '--wages', '--unemployment', '--underutilisation',
	'--reference-line', '--outside-target-range', '--border', '--link',
	'--top-bar', '--button-border', '--button-pressed',
];

function figures_are_filled()
{
	const figure = document.getElementById('gap-value');

	return figure !== null && figure.textContent !== '—';
}

function measure_page({ non_text_roles, wcag, channel_maximum })
{
	function channels(colour)
	{
		const parts = colour.match(/[\d.]+/g).map(Number);

		return { red: parts[0], green: parts[1], blue: parts[2],
			 alpha: parts.length > 3 ? parts[3] : 1 };
	}

	function over(top, bottom)
	{
		const mix = name => top[name] * top.alpha +
			bottom[name] * (1 - top.alpha);

		return { red: mix('red'), green: mix('green'),
			 blue: mix('blue'), alpha: 1 };
	}

	function luminance(colour)
	{
		const linear = value => {
			const fraction = value / channel_maximum;

			if (fraction <= wcag.linear_threshold)
				return fraction / wcag.linear_divisor;
			return Math.pow((fraction + wcag.gamma_offset) /
					(1 + wcag.gamma_offset), wcag.gamma);
		};

		return wcag.red_weight * linear(colour.red) +
			wcag.green_weight * linear(colour.green) +
			wcag.blue_weight * linear(colour.blue);
	}

	function ratio(first, second)
	{
		const lighter = Math.max(luminance(first), luminance(second));
		const darker = Math.min(luminance(first), luminance(second));

		return (lighter + wcag.ratio_offset) /
			(darker + wcag.ratio_offset);
	}

	function background_of(element)
	{
		const layers = [];

		for (let node = element; node; node = node.parentElement) {
			const colour = channels(
				getComputedStyle(node).backgroundColor);

			if (colour.alpha > 0)
				layers.push(colour);
			if (colour.alpha === 1)
				break;
		}
		return layers.reduceRight((below, layer) => over(layer, below),
			{ red: channel_maximum, green: channel_maximum,
			  blue: channel_maximum, alpha: 1 });
	}

	function is_large(style)
	{
		const points = parseFloat(style.fontSize) *
			wcag.points_per_css_pixel;

		return points >= wcag.large_text_points ||
			(points >= wcag.large_bold_text_points &&
			 Number(style.fontWeight) >= wcag.bold_weight);
	}

	function has_own_text(element)
	{
		return [...element.childNodes].some(node =>
			node.nodeType === Node.TEXT_NODE &&
			node.textContent.trim() !== '');
	}

	function is_shown(element)
	{
		const box = element.getBoundingClientRect();

		return box.width > 0 && box.height > 0 &&
			getComputedStyle(element).visibility !== 'hidden';
	}

	function text_contrast(element)
	{
		const style = getComputedStyle(element);
		const background = background_of(element);
		const text = over(channels(style.color), background);
		const needed = is_large(style) ? wcag.large_text_ratio :
			wcag.text_ratio;

		return {
			text: element.textContent.trim().slice(0, 40),
			font: style.fontSize + ' ' + style.fontWeight,
			ratio: Math.round(ratio(text, background) * 100) / 100,
			needed: needed,
		};
	}

	function role_contrast(role)
	{
		const root = getComputedStyle(document.documentElement);
		const probe = document.createElement('i');

		probe.style.color = root.getPropertyValue(role);
		document.body.appendChild(probe);
		const colour = channels(getComputedStyle(probe).color);
		probe.remove();
		const page = background_of(document.body);

		return { role: role, ratio:
			 Math.round(ratio(colour, page) * 100) / 100,
			 needed: wcag.non_text_ratio };
	}

	function target(element)
	{
		const box = element.getBoundingClientRect();

		return { text: element.textContent.trim().slice(0, 20),
			 width: Math.round(box.width),
			 height: Math.round(box.height) };
	}

	const texts = [...document.querySelectorAll('body *')]
		.filter(element => has_own_text(element) && is_shown(element))
		.map(text_contrast);
	const controls = [...document.querySelectorAll('button, a[href]')]
		.filter(is_shown).map(target);

	return {
		text_failures: texts.filter(item => item.ratio < item.needed),
		text_checked: texts.length,
		lowest_text: texts.sort((a, b) => a.ratio - b.ratio)
			.slice(0, 5),
		non_text: non_text_roles.map(role_contrast),
		small_targets: controls.filter(item =>
			item.width < wcag.target_css_pixels ||
			item.height < wcag.target_css_pixels),
		targets_checked: controls.length,
	};
}

function describe_focus()
{
	const element = document.activeElement;
	const style = getComputedStyle(element);

	return {
		element: element.tagName.toLowerCase() +
			(element.id ? '#' + element.id : ''),
		text: element.textContent.trim().slice(0, 30),
		outline: style.outlineStyle + ' ' + style.outlineWidth,
	};
}

async function open(browser, address, options)
{
	const context = await browser.newContext(options);
	const page = await context.newPage();

	await page.goto(address);
	await page.waitForFunction(figures_are_filled, null, {
		timeout: SECONDS_TO_WAIT_FOR_FIGURES * MILLISECONDS_PER_SECOND,
	});
	return { context: context, page: page };
}

async function walk_keyboard(page, output_directory)
{
	const stops = [];

	for (let step = 0; step < TAB_STOPS_TO_WALK; step++) {
		await page.keyboard.press('Tab');
		const stop = await page.evaluate(describe_focus);

		if (stops.length > 0 && stop.element === 'body')
			break;
		stops.push(stop);
	}
	await page.focus('[data-trend-rate="2"]');
	await page.screenshot({
		path: path.join(output_directory, 'focus-trend-button.png'),
		clip: { x: 0, y: 150, width: 1280, height: 150 } });
	await page.keyboard.press('Space');
	const pressed_after_space = await page.getAttribute(
		'[data-trend-rate="2"]', 'aria-pressed');
	return { stops: stops,
		 trend_2_pressed_after_space: pressed_after_space };
}

async function page_width(browser, address, width, scale)
{
	const view = await open(browser, address, {
		viewport: { width: width, height: PHONE_HEIGHT },
		deviceScaleFactor: scale });
	const widths = await view.page.evaluate(() => ({
		content: document.documentElement.scrollWidth,
		viewport: window.innerWidth }));

	await view.page.screenshot({ fullPage: true,
		path: path.join(process.argv[3], 'width-' + width + '.png') });
	await view.context.close();
	return widths;
}

async function main()
{
	const [address, output_directory] = process.argv.slice(2);
	const browser = await chromium.launch({ headless: true });
	const report = {};

	for (const scheme of ['light', 'dark']) {
		const view = await open(browser, address,
			{ colorScheme: scheme, viewport: DESKTOP });

		report[scheme] = await view.page.evaluate(measure_page, {
			non_text_roles: NON_TEXT_ROLES, wcag: WCAG,
			channel_maximum: CHANNEL_MAXIMUM });
		if (scheme === 'light')
			report.keyboard = await walk_keyboard(view.page,
							      output_directory);
		await view.context.close();
	}
	report.reflow_320 = await page_width(browser, address,
					     REFLOW_WIDTH, 1);
	report.zoom_200 = await page_width(browser, address,
					   DOUBLE_ZOOM_WIDTH, 2);
	await browser.close();
	fs.writeFileSync(path.join(output_directory, 'accessibility.json'),
			 JSON.stringify(report, null, '\t'));
	console.log(JSON.stringify(report, null, '\t'));
}

main();
