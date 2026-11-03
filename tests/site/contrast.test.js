'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const STYLE_SHEET = fs.readFileSync(
	path.join(__dirname, '..', '..', 'assets', 'css', 'style.css'), 'utf8');
const TEXT_CONTRAST = 4.5;
const NON_TEXT_CONTRAST = 3;
const LIGHT_OFFSET = 0.05;
const LINEAR_THRESHOLD = 0.03928;
const LINEAR_DIVISOR = 12.92;
const GAMMA_OFFSET = 0.055;
const GAMMA_DIVISOR = 1.055;
const GAMMA = 2.4;
const CHANNEL_WEIGHTS = [0.2126, 0.7152, 0.0722];
const CHANNEL_MAXIMUM = 255;

const DARK_THEME = '@media (prefers-color-scheme: dark) {\n\t:root';

function rule_body(selector)
{
	const start = STYLE_SHEET.indexOf(selector + ' {');

	assert.notEqual(start, -1, 'style.css has no rule ' + selector);
	return STYLE_SHEET.slice(start, STYLE_SHEET.indexOf('}', start));
}

function colour_roles(selector)
{
	const roles = {};
	const pattern = /(--[a-z-]+):\s*(#[0-9a-f]{6});/g;

	for (const [, name, colour] of rule_body(selector).matchAll(pattern))
		roles[name] = colour;
	return roles;
}

const THEMES = {
	light: colour_roles(':root'),
	dark: colour_roles(DARK_THEME),
};

function linear_channel(hex_pair)
{
	const channel = parseInt(hex_pair, 16) / CHANNEL_MAXIMUM;

	if (channel <= LINEAR_THRESHOLD)
		return channel / LINEAR_DIVISOR;
	return Math.pow((channel + GAMMA_OFFSET) / GAMMA_DIVISOR, GAMMA);
}

function relative_luminance(colour)
{
	const pairs = [colour.slice(1, 3), colour.slice(3, 5), colour.slice(5)];

	return pairs.map(linear_channel).reduce((sum, channel, index) =>
		sum + channel * CHANNEL_WEIGHTS[index], 0);
}

function contrast(first, second)
{
	const luminances = [relative_luminance(first),
			    relative_luminance(second)];
	const [lighter, darker] = luminances.sort((a, b) => b - a);

	return (lighter + LIGHT_OFFSET) / (darker + LIGHT_OFFSET);
}

function assert_contrast(theme, foreground, background, needed)
{
	const roles = THEMES[theme];
	const ratio = contrast(roles[foreground], roles[background]);

	assert.ok(ratio >= needed, theme + ': ' + foreground + ' on ' +
		  background + ' is ' + ratio.toFixed(2) + ':1, needs ' +
		  needed);
}

for (const theme of Object.keys(THEMES)) {
	test(theme + ': headline labels on the panel are readable',
	     () => {
		assert_contrast(theme, '--panel-muted-text', '--panel',
				TEXT_CONTRAST);
	});

	test(theme + ': button borders show a button is there', () => {
		assert_contrast(theme, '--button-border', '--background',
				NON_TEXT_CONTRAST);
		assert_contrast(theme, '--button-border', '--button',
				NON_TEXT_CONTRAST);
	});

	test(theme + ': a pressed button differs from an unpressed one',
	     () => {
		assert_contrast(theme, '--button-pressed', '--button',
				NON_TEXT_CONTRAST);
	});

	test(theme + ': button text is readable when pressed or hovered',
	     () => {
		assert_contrast(theme, '--button-pressed-text',
				'--button-pressed', TEXT_CONTRAST);
		assert_contrast(theme, '--button-hover-text', '--button-hover',
				TEXT_CONTRAST);
	});
}

test('controls and labels use the roles, not colour literals', () => {
	const pattern = /#[0-9a-f]{3,6}\b/i;

	assert.match(rule_body('.headline-figures dt'),
		     /color: var\(--panel-muted-text\)/);
	assert.match(rule_body('.chart-controls button'),
		     /border: 1px solid var\(--button-border\)/);
	for (const state of [':hover', ':active', '[aria-pressed="true"]'])
		assert.doesNotMatch(rule_body('.chart-controls button' + state),
				    pattern, state);
});
