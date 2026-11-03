#!/bin/sh
# Usage: tools/gate/run.sh COMMIT
# Gates COMMIT from git archive in a scratch folder outside the repository
# and prints a one-line verdict. GATE_ROOT moves the scratch folder.
set -u

GATE_ROOT=${GATE_ROOT:-/tmp/pricelevel-gate}
NODE_MAJOR=24
BROWSER_LOCK=/tmp/pricelevel-browser.lock
SECONDS_TO_WAIT_FOR_BROWSER_LOCK=1800
SECONDS_FOR_SERVER_TO_START=1
IDENTICAL_FAILURES_BEFORE_STOPPING=3

gate_directory=$(cd "$(dirname "$0")" && pwd)
repository=$(git -C "$gate_directory" rev-parse --show-toplevel)
commit=$(git -C "$repository" rev-parse --short "${1:?usage: run.sh COMMIT}")
gate_paths="tools/gate eslint.config.js"
gate_commit=$(git -C "$repository" log -1 --format=%h -- $gate_paths)
work_directory=$GATE_ROOT/$commit-$(date +%Y%m%d-%H%M%S)
source_directory=$work_directory/src
gate_log=$work_directory/gate.log
javascript_results=$work_directory/javascript-tests.tap
gate_package=$gate_directory/package.json
gate_lock=$gate_directory/package-lock.json
gate_requirements=$gate_directory/requirements.txt
html_rules=$gate_directory/htmlvalidate.json
smoke_script=$gate_directory/smoke.js
lock_and_requirements=$(cat "$gate_lock" "$gate_requirements" | sha256sum |
	cut -c1-12)
tools_directory=$GATE_ROOT/tools-$lock_and_requirements
venv_python=$tools_directory/venv/bin/python
gate_node_modules=$tools_directory/node_modules
eslint_program=$gate_node_modules/eslint/bin/eslint.js
html_validator=$gate_node_modules/html-validate/bin/html-validate.mjs
failures=""
not_run=""
counts=""

if [ -n "$(git -C "$repository" status --porcelain -- $gate_paths)" ]; then
	gate_commit="$gate_commit+uncommitted"
fi

stage()
{
	name=$1
	shift
	echo "== $name: $*" >>"$gate_log"
	if "$@" >>"$gate_log" 2>&1; then
		echo "pass $name"
	else
		echo "FAIL $name"
		failures="$failures $name"
	fi
}

skip()
{
	echo "not run $1 ($2)"
	not_run="$not_run $1 ($2)"
}

install_tools()
{
	if [ -d "$gate_node_modules" ] && [ -x "$venv_python" ]; then
		return 0
	fi
	mkdir -p "$tools_directory"
	cp "$gate_package" "$gate_lock" "$tools_directory/"
	(cd "$tools_directory" &&
		npm ci --ignore-scripts --no-audit --no-fund) &&
		python3 -m venv "$tools_directory/venv" &&
		"$venv_python" -m pip install -q -r "$gate_requirements"
}

toolchain_matches()
{
	node_major=$(node -p 'process.versions.node.split(".")[0]')
	echo "node $(node --version), wanted major $NODE_MAJOR"
	[ "$node_major" = "$NODE_MAJOR" ]
}

pinned_version()
{
	node -p "require('$1').devDependencies['$2']"
}

pins_match()
{
	commit_eslint=$(pinned_version "$source_directory/package.json" eslint)
	gate_eslint=$(pinned_version "$gate_package" eslint)
	echo "eslint: commit $commit_eslint, gate $gate_eslint"
	commit_python=$(sort "$source_directory/requirements-dev.txt")
	gate_python=$(sort "$gate_requirements")
	echo "python: commit $commit_python; gate $gate_python"
	[ "$commit_eslint" = "$gate_eslint" ] &&
		[ "$commit_python" = "$gate_python" ]
}

lint_javascript()
{
	(cd "$source_directory" &&
		NODE_PATH="$gate_node_modules" node "$eslint_program" .)
}

lint_python()
{
	(
		cd "$source_directory" || exit
		python_folders=$(ls -d scripts tests tools 2>/dev/null)
		"$venv_python" -m pyflakes $python_folders
	)
}

validate_html()
{
	(cd "$source_directory" &&
		node "$html_validator" --config "$html_rules" index.html)
}

javascript_tests()
{
	(
		cd "$source_directory" || exit
		node --test --test-reporter=tap "tests/**/*.test.js"
	) >"$javascript_results" 2>&1
	result=$?
	cat "$javascript_results"
	passed=$(sed -n 's/^# pass //p' "$javascript_results")
	total=$(sed -n 's/^# tests //p' "$javascript_results")
	skipped=$(sed -n 's/^# skipped //p' "$javascript_results")
	todo=$(sed -n 's/^# todo //p' "$javascript_results")
	counts="$counts JS ${passed:-0}/${total:-0}"
	counts="$counts (skipped ${skipped:-?}, todo ${todo:-?});"
	[ "$result" -eq 0 ] && [ "${skipped:-1}" = 0 ] && [ "${todo:-1}" = 0 ]
}

python_tests()
{
	(
		cd "$source_directory" || exit
		export PYTHONDONTWRITEBYTECODE=1
		"$venv_python" -m pytest -q -rs -p no:cacheprovider tests
	) >"$work_directory/python-tests.txt" 2>&1
	result=$?
	cat "$work_directory/python-tests.txt"
	summary=$(tail -n 1 "$work_directory/python-tests.txt")
	counts="$counts Python: $summary;"
	[ "$result" -eq 0 ] && ! echo "$summary" | grep -q "skipped"
}

free_port()
{
	python3 -c 'import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])'
}

browser_smoke()
{
	port=$(free_port)
	(
		cd "$source_directory" || exit
		exec python3 -m http.server --bind 127.0.0.1 "$port"
	) >"$work_directory/server.log" 2>&1 &
	server=$!
	page_address=http://127.0.0.1:$port/
	screenshot_directory=$work_directory/screenshots
	sleep "$SECONDS_FOR_SERVER_TO_START"
	mkdir -p "$screenshot_directory"
	(
		flock -w "$SECONDS_TO_WAIT_FOR_BROWSER_LOCK" 9 || exit
		export NODE_PATH="$gate_node_modules"
		node "$smoke_script" "$page_address" "$screenshot_directory"
	) 9>"$BROWSER_LOCK"
	result=$?
	kill "$server"
	return "$result"
}

check_circuit_breaker()
{
	history=$GATE_ROOT/history.log
	echo "$commit|${failures:- none}" >>"$history"
	[ -z "$failures" ] && return 0
	identical=$(tail -n "$IDENTICAL_FAILURES_BEFORE_STOPPING" "$history" |
		cut -d'|' -f2 | sort -u | wc -l)
	lines=$(tail -n "$IDENTICAL_FAILURES_BEFORE_STOPPING" "$history" |
		wc -l)
	if [ "$lines" -eq "$IDENTICAL_FAILURES_BEFORE_STOPPING" ] &&
		[ "$identical" -eq 1 ]; then
		echo "CIRCUIT BREAKER: the last $lines runs failed the same stages ($failures). Stop gating and investigate."
	fi
}

mkdir -p "$source_directory"
git -C "$repository" archive "$commit" | tar -x -C "$source_directory"
echo "gate $commit from git archive into $source_directory (gate scripts $gate_commit)" |
	tee "$gate_log"

stage toolchain toolchain_matches
stage install-gate-tools install_tools
if [ -f "$source_directory/package.json" ] &&
	[ -f "$source_directory/requirements-dev.txt" ]; then
	stage tool-pins pins_match
else
	skip tool-pins "no package.json or requirements-dev.txt in $commit"
fi
if [ ! -f "$source_directory/eslint.config.js" ]; then
	cp "$repository/eslint.config.js" "$source_directory/"
	echo "eslint.config.js not in $commit; using gate's ($gate_commit)" |
		tee -a "$gate_log"
fi
stage lint-javascript lint_javascript
stage lint-python lint_python
stage validate-html validate_html
if ls "$source_directory"/tests/*/*.test.js >/dev/null 2>&1; then
	stage javascript-tests javascript_tests
else
	skip javascript-tests "no tests/**/*.test.js in $commit"
fi
if ls "$source_directory"/tests/*/test_*.py >/dev/null 2>&1; then
	stage python-tests python_tests
else
	skip python-tests "no tests/**/test_*.py in $commit"
fi
stage browser-smoke browser_smoke
check_circuit_breaker

verdict=PASSED
[ -n "$failures" ] && verdict=FAILED
echo
platform="Linux, Node $(node --version), Python $(python3 --version | cut -d' ' -f2), Chromium headless shell (Playwright 1.62.1)"
echo "$(date '+%Y-%m-%d %H:%M %Z') | $commit | $platform | tools/gate/run.sh $commit (gate scripts $gate_commit) | VERDICT $verdict;$counts not run:${not_run:- none}; failed:${failures:- none}; log $gate_log" |
	tee -a "$gate_log"
[ "$verdict" = PASSED ]
