'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const LITERALS_JOINED_ACROSS_LINES = {
	'assets/js/app.js': /'\s*\+\s*\n\s*'/,
	'tests/data/built-in-copy.test.js': /'\s*\+\s*\n\s*'/,
	'scripts/update_data.py': /SeriesLooksWrong\(f?"[^\n]*"\s*\n\s*f?"/,
	'tools/gate/run.sh': /\becho [^\n]*\\\n/,
};

function read(file)
{
	return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

test('user-visible messages are never split across lines', () => {
	const checks = Object.entries(LITERALS_JOINED_ACROSS_LINES);

	for (const [file, split] of checks)
		assert.doesNotMatch(read(file), split, file);
});

test('shell scripts use no backslash line continuations', () => {
	assert.doesNotMatch(read('tools/gate/run.sh'), /\\\n/);
});
