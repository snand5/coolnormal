'use strict';

const { builtinRules } = require('eslint/use-at-your-own-risk');

const TAB_WIDTH = 8;
const LINE_LIMIT = 80;
const LINE_THAT_IS_ONLY_A_MESSAGE = '^\\s*([\'"`]).*\\1[\\s,;)+]*$';

const BROWSER_GLOBALS = [
	'Blob', 'Chart', 'MutationObserver', 'URL', 'devicePixelRatio',
	'document', 'fetch', 'getComputedStyle', 'history', 'location',
	'matchMedia', 'module', 'setTimeout', 'window',
];
const NODE_GLOBALS = [
	'Buffer', 'URL', '__dirname', '__filename', 'console', 'module', 'process',
	'require',
];
const PAGE_GLOBALS_IN_BROWSER_CALLBACKS = [
	'Node', 'document', 'getComputedStyle', 'window',
];

function recommended_rules()
{
	const rules = {};

	for (const [name, rule] of builtinRules) {
		if (rule.meta.docs && rule.meta.docs.recommended)
			rules[name] = 'error';
	}
	return rules;
}

function read_only(names)
{
	return Object.fromEntries(names.map(name => [name, 'readonly']));
}

const readme_rules = {
	eqeqeq: 'error',
	'no-implicit-coercion': 'error',
	'no-shadow': 'error',
	'max-depth': ['error', 3],
	'max-len': ['error', {
		code: LINE_LIMIT,
		tabWidth: TAB_WIDTH,
		ignorePattern: LINE_THAT_IS_ONLY_A_MESSAGE,
	}],
	'no-var': 'error',
	'prefer-const': 'error',
};

module.exports = [
	{
		ignores: [
			'assets/vendor/**',
			'data/**',
			'node_modules/**',
			'.venv/**',
		],
	},
	{
		files: ['**/*.js'],
		languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs' },
		linterOptions: { reportUnusedDisableDirectives: 'error' },
		rules: Object.assign(recommended_rules(), readme_rules),
	},
	{
		files: ['assets/js/**/*.js'],
		languageOptions: { globals: read_only(BROWSER_GLOBALS) },
	},
	{
		files: ['tests/**/*.js', 'tools/**/*.js', 'eslint.config.js'],
		languageOptions: { globals: read_only(NODE_GLOBALS) },
	},
	{
		files: ['tools/gate/smoke.js', 'tools/gate/accessibility.js'],
		languageOptions: {
			globals: read_only(PAGE_GLOBALS_IN_BROWSER_CALLBACKS),
		},
	},
];
