'use strict';

const TREND_RATE_CHOICES = ['2.5', '2'];
const RANGE_YEAR_CHOICES = ['0', '10', '20'];
const TARGET_RANGE_LOW = 2;
const TARGET_RANGE_HIGH = 3;
const TREND_BASE_QUARTER = '1993-Q3';
const LOWEST_SAFE_CATCH_UP_RATE = 1;
const HIGHEST_REASONABLE_CATCH_UP_RATE = 4;
const CATCH_UP_RATE_STEP = 0.25;
const DAYS_BEFORE_UPDATES_COUNT_AS_STOPPED = 14;
const MILLISECONDS_PER_DAY = 86400000;
const QUARTERS_PER_YEAR = 4;
const RECENT_QUARTERS_SHOWN = 12;
const ROUNDING_TOLERANCE = 1e-9;
const CHART_FONT = 'Arial,Helvetica,sans-serif';
const CHART_FONT_SIZE_IN_PIXELS = 12;
const LINE_HOVER_RADIUS_IN_PIXELS = 3;
const WIDEST_BAR_IN_PIXELS = 44;
const BAR_LABEL_LIFT_IN_PIXELS = 4;
const DASH_PATTERN_IN_PIXELS = [4, 4];
const TICK_LABEL_GAP_IN_PIXELS = 12;
const SWATCH_KINDS = Object.freeze({
	'key-line': 'line',
	'key-box': 'box',
	'key-marker': 'marker',
});
const PNG_LAYOUT_IN_PIXELS = Object.freeze({
	margin: 16,
	title_space: 56,
	footer_space: 30,
	title_baseline: 22,
	title_font_size: 15,
	legend_baseline: 44,
	swatch_width: 20,
	swatch_box_height: 10,
	swatch_line_height: 2,
	swatch_marker_width: 2,
	swatch_marker_height: 12,
	swatch_lift: 4,
	text_offset: 25,
	entry_gap: 16,
	source_font_size: 11,
	source_baseline_from_bottom: 11,
});
const QUARTER_ABBREVIATIONS = { 1: 'Mar', 2: 'Jun', 3: 'Sep', 4: 'Dec' };
const QUARTER_NAMES = { 1: 'March', 2: 'June', 3: 'September', 4: 'December' };
const MONTH_ABBREVIATIONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul',
			     'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_PER_QUARTER = 3;
const MONTHS_PER_YEAR = 12;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
		     'July', 'August', 'September', 'October', 'November',
		     'December'];
const LOAD_FAILURE_MESSAGE =
	'Data could not be loaded. Reload the page or download the JSON. ';
const DOWNLOAD_FAILURE_MESSAGE = 'Download failed. ';
const FEED_FILE = 'data/rba-feeds.json';
const FEED_ENTRIES_SHOWN = 5;
const FEED_LINK_PREFIX = 'https://www.rba.gov.au/';
const SERIES_DESCRIPTIONS = {
	cpi_quarterly: 'quarterly CPI',
	wpi_quarterly: 'Wage Price Index',
	cpi_monthly: 'monthly CPI',
	unemployment_rate: 'unemployment rate',
	underutilisation_rate: 'underutilisation rate',
};

let trend_rate = 2.5;
let chart_range_years = 0;
let cpi_by_quarter = {};
let wpi_by_quarter = {};
let cpi_quarters = [];
let latest_quarter = '';
let latest_wpi_quarter = '';
let latest_monthly_change = null;
let unemployment_by_month = {};
let underutilisation_by_month = {};
let labour_months = [];
let drawn_charts = [];

function element_by_id(id)
{
	return document.getElementById(id);
}

function theme_colour(name)
{
	const page_style = getComputedStyle(document.documentElement);

	return page_style.getPropertyValue(name).trim();
}

function only_one(items, description)
{
	if (items.length !== 1)
		throw new Error('Expected exactly one ' + description +
				', found ' + items.length);
	return items[0];
}

function at_least_one(items, description)
{
	if (items.length === 0)
		throw new Error('Expected at least one ' + description +
				', found none');
	return items;
}

function run_unless_blocked(action)
{
	try {
		action();
	} catch (error) {
		if (error.name !== 'SecurityError')
			throw error;
		return false;
	}
	return true;
}

function download_or_report(export_file)
{
	try {
		export_file();
	} catch (error) {
		element_by_id('load-status').textContent =
			DOWNLOAD_FAILURE_MESSAGE;
		throw error;
	}
}

function format_number(value, decimal_places = 1)
{
	const digits = Math.abs(value).toFixed(decimal_places);

	if (value < 0)
		return '\u2212' + digits;
	return digits;
}

function format_signed_number(value, decimal_places = 1)
{
	const unsigned = format_number(value, decimal_places);

	if (value > 0)
		return '+' + unsigned;
	return unsigned;
}

function quarter_year(quarter)
{
	return quarter.slice(0, 4);
}

function quarter_number(quarter)
{
	return Number(quarter.slice(6));
}

function quarter_short_name(quarter)
{
	return QUARTER_ABBREVIATIONS[quarter_number(quarter)] + ' ' +
	       quarter_year(quarter);
}

function quarter_long_name(quarter)
{
	return QUARTER_NAMES[quarter_number(quarter)] + ' quarter ' +
	       quarter_year(quarter);
}

function quarter_position(quarter)
{
	return Number(quarter_year(quarter)) * QUARTERS_PER_YEAR +
	       quarter_number(quarter) - 1;
}

function quarter_shifted_by(quarter, quarters_to_add)
{
	const position = quarter_position(quarter) + quarters_to_add;
	const year = Math.floor(position / QUARTERS_PER_YEAR);

	return year + '-Q' + (position % QUARTERS_PER_YEAR + 1);
}

function month_year(month)
{
	return month.slice(0, 4);
}

function month_number(month)
{
	return Number(month.slice(5));
}

function month_position(month)
{
	return Number(month_year(month)) * MONTHS_PER_YEAR +
	       month_number(month) - 1;
}

function month_short_name(month)
{
	return MONTH_ABBREVIATIONS[month_number(month) - 1] + ' ' +
	       month_year(month);
}

function month_long_name(month)
{
	return MONTH_NAMES[month_number(month) - 1] + ' ' + month_year(month);
}

function quarter_of_month(month)
{
	const quarter = Math.ceil(month_number(month) / MONTHS_PER_QUARTER);

	return month_year(month) + '-Q' + quarter;
}

function first_month_of_quarter(quarter)
{
	const month = quarter_number(quarter) * MONTHS_PER_QUARTER -
		      (MONTHS_PER_QUARTER - 1);

	return quarter_year(quarter) + '-' + String(month).padStart(2, '0');
}

function last_month_of_quarter(quarter)
{
	const month = quarter_number(quarter) * MONTHS_PER_QUARTER;

	return quarter_year(quarter) + '-' + String(month).padStart(2, '0');
}

function month_shifted_by_years(month, years_to_add)
{
	const year = Number(month_year(month)) + years_to_add;

	return year + month.slice(4);
}

function australian_date(iso_date)
{
	const date = new Date(iso_date + 'T00:00:00');
	const style = { day: 'numeric', month: 'short', year: 'numeric' };

	return date.toLocaleDateString('en-AU', style);
}

function series_by_period(observations)
{
	const series = {};

	for (const observation of observations)
		series[observation.period] = observation.value;
	if (Object.keys(series).length !== observations.length)
		throw new Error('Data has more than one value for a period');
	return series;
}

function periods_missing(series, position_of)
{
	const periods = Object.keys(series).sort();

	if (periods.length === 0)
		return 0;
	return position_of(periods[periods.length - 1]) -
	       position_of(periods[0]) + 1 - periods.length;
}

function contiguous(series, position_of, name)
{
	const missing = periods_missing(series, position_of);

	if (missing !== 0)
		throw new Error('Expected no missing periods in ' + name +
				', found ' + missing);
	return series;
}

function load_data(data)
{
	at_least_one(data.cpi_quarterly, 'CPI observation');
	cpi_by_quarter = contiguous(series_by_period(data.cpi_quarterly),
				    quarter_position, 'cpi_quarterly');
	wpi_by_quarter = contiguous(series_by_period(data.wpi_quarterly || []),
				    quarter_position, 'wpi_quarterly');
	cpi_quarters = Object.keys(cpi_by_quarter).sort();
	latest_quarter = cpi_quarters[cpi_quarters.length - 1];
	latest_wpi_quarter = Object.keys(wpi_by_quarter).sort().pop() || '';
	latest_monthly_change = data.latest_monthly_change || null;
	unemployment_by_month = contiguous(
		series_by_period(data.unemployment_rate || []),
		month_position, 'unemployment_rate');
	underutilisation_by_month = contiguous(
		series_by_period(data.underutilisation_rate || []),
		month_position, 'underutilisation_rate');
	labour_months = Object.keys(unemployment_by_month).sort()
		.filter(month => month in underutilisation_by_month);
}

function years_since_trend_base(quarter)
{
	const quarters_elapsed = quarter_position(quarter) -
		quarter_position(TREND_BASE_QUARTER);

	return quarters_elapsed / QUARTERS_PER_YEAR;
}

function trend_price_level(quarter)
{
	const growth = Math.pow(1 + trend_rate / 100,
				years_since_trend_base(quarter));

	return cpi_by_quarter[TREND_BASE_QUARTER] * growth;
}

function percent_above_trend(quarter)
{
	return (cpi_by_quarter[quarter] / trend_price_level(quarter) - 1) * 100;
}

function is_above_trend(quarter)
{
	return percent_above_trend(quarter) >= 0;
}

function annual_change(series, quarter)
{
	const year_earlier =
		series[quarter_shifted_by(quarter, -QUARTERS_PER_YEAR)];

	if (series[quarter] === undefined || year_earlier === undefined)
		return null;
	return (series[quarter] / year_earlier - 1) * 100;
}

function wages_relative_to_prices(first_quarter, last_quarter)
{
	const wage_growth = wpi_by_quarter[last_quarter] /
			    wpi_by_quarter[first_quarter];
	const price_growth = cpi_by_quarter[last_quarter] /
			     cpi_by_quarter[first_quarter];

	return (wage_growth / price_growth - 1) * 100;
}

function trend_growth_between(first_quarter, last_quarter)
{
	const quarters = quarter_position(last_quarter) -
			 quarter_position(first_quarter);

	return Math.pow(1 + trend_rate / 100, quarters / QUARTERS_PER_YEAR);
}

function path_relative_to_trend(path_rate, quarter)
{
	const relative_growth = (1 + path_rate / 100) / (1 + trend_rate / 100);
	const years = years_since_trend_base(quarter);

	return (Math.pow(relative_growth, years) - 1) * 100;
}

function years_back_to_trend(average_inflation)
{
	const price_to_trend_ratio = 1 +
		percent_above_trend(latest_quarter) / 100;
	const yearly_closing = (1 + trend_rate / 100) /
			       (1 + average_inflation / 100);

	return Math.log(price_to_trend_ratio) / Math.log(yearly_closing);
}

function average_inflation_since_trend_base(quarter)
{
	const growth = cpi_by_quarter[quarter] /
		       cpi_by_quarter[TREND_BASE_QUARTER];
	const years = years_since_trend_base(quarter);

	return (Math.pow(growth, 1 / years) - 1) * 100;
}

function earlier_quarter_in_run(quarter, run_is_above)
{
	const previous = quarter_shifted_by(quarter, -1);
	const one_before_previous = quarter_shifted_by(quarter, -2);

	if (previous < TREND_BASE_QUARTER)
		return null;
	if (is_above_trend(previous) === run_is_above)
		return previous;
	if (one_before_previous < TREND_BASE_QUARTER)
		return null;
	if (is_above_trend(one_before_previous) === run_is_above)
		return one_before_previous;
	return null;
}

function current_run()
{
	const run_is_above = is_above_trend(latest_quarter);
	let first_quarter = latest_quarter;
	let earlier_quarter = earlier_quarter_in_run(first_quarter,
						     run_is_above);

	while (earlier_quarter) {
		first_quarter = earlier_quarter;
		earlier_quarter = earlier_quarter_in_run(first_quarter,
							 run_is_above);
	}
	return {
		is_above: run_is_above,
		first_quarter: first_quarter,
		length_in_quarters: quarter_position(latest_quarter) -
				    quarter_position(first_quarter) + 1,
	};
}

function later_of_quarters(quarter, other_quarter)
{
	return quarter > other_quarter ? quarter : other_quarter;
}

function earlier_of_quarters(quarter, other_quarter)
{
	return quarter < other_quarter ? quarter : other_quarter;
}

function wage_comparison_window()
{
	const wage_quarters = at_least_one(Object.keys(wpi_by_quarter).sort(),
					   'Wage Price Index observation');
	const run_start = current_run().first_quarter;
	const first_quarter = later_of_quarters(run_start, wage_quarters[0]);
	const last_quarter = earlier_of_quarters(latest_quarter,
						 latest_wpi_quarter);

	return { first_quarter: first_quarter, last_quarter: last_quarter };
}

function wage_comparison_available()
{
	if (!latest_wpi_quarter)
		return false;

	const comparison = wage_comparison_window();

	return comparison.first_quarter < comparison.last_quarter;
}

function monthly_reading_is_current()
{
	const quarter_end = last_month_of_quarter(latest_quarter);

	return latest_monthly_change !== null &&
	       latest_monthly_change.period >= quarter_end;
}

function show_monthly_headline_inflation()
{
	const reading = latest_monthly_change;

	element_by_id('headline-inflation-label').textContent =
		'Headline inflation, year to ' +
		month_long_name(reading.period) + ' (monthly CPI)';
	element_by_id('headline-inflation-value').textContent =
		format_number(reading.annual_change, 1) + '%';
}

function show_quarterly_headline_inflation()
{
	const year_ended_change = annual_change(cpi_by_quarter, latest_quarter);

	element_by_id('headline-inflation-label').textContent =
		'Headline inflation, year to the ' +
		quarter_long_name(latest_quarter);
	element_by_id('headline-inflation-value').textContent =
		format_number(year_ended_change, 1) + '%';
}

function show_headline_inflation()
{
	if (monthly_reading_is_current())
		show_monthly_headline_inflation();
	else
		show_quarterly_headline_inflation();
}

function show_titles()
{
	const title = 'Australian Price Level vs ' + trend_rate + '% Trend';

	element_by_id('page-title').textContent = title;
	document.title = title;
	element_by_id('gap-chart-title').textContent =
		'Price level vs ' + trend_rate + '% trend from the ' +
		quarter_long_name(TREND_BASE_QUARTER);
	element_by_id('gap-legend-label').textContent =
		'Price level vs ' + trend_rate + '% trend';
}

function run_summary()
{
	const run = current_run();
	const side = run.is_above ? 'Above' : 'Below';

	return side + ' trend since the ' +
	       quarter_long_name(run.first_quarter) + ' (' +
	       run.length_in_quarters + ' quarters)';
}

function show_gap_figures()
{
	const average_inflation =
		average_inflation_since_trend_base(latest_quarter);
	const gap = percent_above_trend(latest_quarter);

	element_by_id('gap-label').textContent = 'Price level vs ' +
		trend_rate + '% trend from the ' +
		quarter_long_name(TREND_BASE_QUARTER) + ', ' +
		quarter_long_name(latest_quarter);
	element_by_id('gap-value').textContent =
		format_signed_number(gap, 1) + '%';
	element_by_id('run-summary').textContent = run_summary();
	element_by_id('average-inflation-label').textContent =
		'Average inflation, ' + quarter_long_name(TREND_BASE_QUARTER) +
		' to ' + quarter_long_name(latest_quarter);
	element_by_id('average-inflation-value').textContent =
		format_number(average_inflation, 1) + '% a year';
}

function show_wage_comparison()
{
	const label = element_by_id('wage-label');
	const comparison = wage_comparison_window();
	const change = wages_relative_to_prices(comparison.first_quarter,
						comparison.last_quarter);

	label.textContent = 'Real Wage Price Index, ' +
		quarter_long_name(comparison.first_quarter) + ' to ' +
		quarter_long_name(comparison.last_quarter);
	element_by_id('wage-value').textContent =
		format_signed_number(change, 1) + '%';
}

function show_wage_figure()
{
	const has_comparison = wage_comparison_available();

	element_by_id('wage-label').parentElement.hidden = !has_comparison;
	if (has_comparison)
		show_wage_comparison();
}

function text_cell(text)
{
	const cell = document.createElement('td');

	cell.textContent = text;
	return cell;
}

function number_cell(text)
{
	const cell = text_cell(text);

	cell.className = 'number';
	return cell;
}

function recent_quarter_row(quarter)
{
	const row = document.createElement('tr');
	const price_change = annual_change(cpi_by_quarter, quarter);
	const wage_change = annual_change(wpi_by_quarter, quarter);
	const wage_text = wage_change === null ?
			  '\u2014' : format_number(wage_change, 1);
	const gap_text = format_signed_number(percent_above_trend(quarter), 1);

	row.appendChild(text_cell(quarter_short_name(quarter)));
	row.appendChild(number_cell(format_number(price_change, 1)));
	row.appendChild(number_cell(wage_text));
	row.appendChild(number_cell(gap_text));
	return row;
}

function fill_recent_quarters()
{
	const table_body = element_by_id('recent-quarters');
	const recent = cpi_quarters.slice(-RECENT_QUARTERS_SHOWN).reverse();

	table_body.replaceChildren(...recent.map(recent_quarter_row));
}

function rate_closes_gap(rate)
{
	if (is_above_trend(latest_quarter))
		return rate < trend_rate - ROUNDING_TOLERANCE;
	return rate > trend_rate + ROUNDING_TOLERANCE;
}

function catch_up_rates()
{
	const rates = [];
	let rate = LOWEST_SAFE_CATCH_UP_RATE;

	while (rate <= HIGHEST_REASONABLE_CATCH_UP_RATE + ROUNDING_TOLERANCE) {
		if (rate_closes_gap(rate))
			rates.push(Math.round(rate * 100) / 100);
		rate += CATCH_UP_RATE_STEP;
	}
	return rates;
}

function draw_reference_line(chart, value)
{
	const area = chart.chartArea;
	const y_position = chart.scales.y.getPixelForValue(value);
	const context = chart.ctx;

	if (y_position < area.top || y_position > area.bottom)
		return;
	context.save();
	context.setLineDash(DASH_PATTERN_IN_PIXELS);
	context.strokeStyle = theme_colour('--reference-line');
	context.lineWidth = 1;
	context.beginPath();
	context.moveTo(area.left, y_position);
	context.lineTo(area.right, y_position);
	context.stroke();
	context.restore();
}

function reference_line_plugin(value)
{
	return {
		id: 'reference-line-' + value,
		afterDatasetsDraw: chart => draw_reference_line(chart, value),
	};
}

function draw_bar_labels(chart, years)
{
	const context = chart.ctx;
	const bars = chart.getDatasetMeta(0).data;

	only_one(chart.data.datasets, 'catch-up dataset');
	context.save();
	context.fillStyle = theme_colour('--text');
	context.font = CHART_FONT_SIZE_IN_PIXELS + 'px ' + CHART_FONT;
	context.textAlign = 'center';
	bars.forEach((bar, index) =>
		context.fillText(Math.round(years[index]), bar.x,
				 bar.y - BAR_LABEL_LIFT_IN_PIXELS));
	context.restore();
}

function bar_label_plugin(years)
{
	return {
		id: 'bar-labels',
		afterDatasetsDraw: chart => draw_bar_labels(chart, years),
	};
}

function fill_page_background(chart)
{
	const context = chart.ctx;

	context.save();
	context.globalCompositeOperation = 'destination-over';
	context.fillStyle = theme_colour('--background');
	context.fillRect(0, 0, chart.width, chart.height);
	context.restore();
}

function line_dataset(label, values, style_changes = {})
{
	const price_colour = theme_colour('--price');
	const dataset = {
		label: label,
		data: values,
		borderColor: price_colour,
		backgroundColor: price_colour,
		borderWidth: 2,
		pointRadius: 0,
		pointHoverRadius: LINE_HOVER_RADIUS_IN_PIXELS,
		tension: 0,
	};

	return Object.assign(dataset, style_changes);
}

function x_axis_ticks()
{
	return { autoSkip: true, autoSkipPadding: TICK_LABEL_GAP_IN_PIXELS,
		 maxRotation: 0 };
}

function shows_in_tooltip(item)
{
	return !item.dataset.is_band_edge;
}

function chart_options(y_axis_title, format_tick, describe_point,
		       x_axis_changes = {})
{
	const gridlines = { color: theme_colour('--gridline') };
	const x_ticks = x_axis_ticks();
	const x_axis = Object.assign({ ticks: x_ticks, grid: gridlines },
				     x_axis_changes);
	const y_title = { display: true, text: y_axis_title };
	const y_axis = { grid: gridlines, ticks: { callback: format_tick },
			 title: y_title };
	const tooltip = { filter: shows_in_tooltip,
			  callbacks: { label: describe_point } };
	const legend = { display: false };
	const hover = { mode: 'index', intersect: false };

	return {
		responsive: true,
		maintainAspectRatio: false,
		animation: false,
		interaction: hover,
		plugins: { legend: legend, tooltip: tooltip },
		scales: { x: x_axis, y: y_axis },
	};
}

function signed_percent_tick(value)
{
	const magnitude = Math.abs(value) + '%';

	if (value < 0)
		return '\u2212' + magnitude;
	if (value > 0)
		return '+' + magnitude;
	return magnitude;
}

function plain_tick(value)
{
	return value;
}

function describe_gap_point(point)
{
	return point.dataset.label + ': ' +
	       format_signed_number(point.parsed.y, 2) + '%';
}

function first_quarter_shown(quarters)
{
	if (chart_range_years === 0)
		return quarters[0];
	return quarter_shifted_by(latest_quarter,
				  -chart_range_years * QUARTERS_PER_YEAR);
}

function draw_run_start_marker(chart, marker_index)
{
	const area = chart.chartArea;
	const x = chart.scales.x.getPixelForValue(marker_index);
	const context = chart.ctx;

	if (x < area.left || x > area.right)
		return;
	context.save();
	context.strokeStyle = theme_colour('--text');
	context.lineWidth = 1.5;
	context.beginPath();
	context.moveTo(x, area.top);
	context.lineTo(x, area.bottom);
	context.stroke();
	context.restore();
}

function run_start_marker_plugin(marker_index)
{
	return {
		id: 'run-start-marker',
		afterDatasetsDraw: chart =>
			draw_run_start_marker(chart, marker_index),
	};
}

function show_run_marker_legend(run, first_quarter_in_view)
{
	const label = element_by_id('run-marker-legend-label');
	const side = run.is_above ? 'Above' : 'Below';
	const outside_view = run.first_quarter < first_quarter_in_view ?
			     ' (before this view)' : '';

	label.textContent = side + ' trend since the ' +
		quarter_long_name(run.first_quarter) + outside_view;
}

function band_edge_style()
{
	return { borderWidth: 0, borderColor: 'transparent',
		 pointHoverRadius: 0, is_band_edge: true };
}

function quarters_since_trend_base()
{
	return cpi_quarters.filter(quarter => quarter >= TREND_BASE_QUARTER);
}

function path_label(rate)
{
	return 'Path at ' + rate + '% a year';
}

function path_values(quarters, rate)
{
	return quarters.map(quarter => path_relative_to_trend(rate, quarter));
}

function draw_gap_chart()
{
	const quarters = quarters_since_trend_base();
	const labels = quarters.map(quarter_short_name);
	const band_edge = band_edge_style();
	const shaded_to_previous = Object.assign({ fill: '-1',
		backgroundColor: theme_colour('--target-range') },
		band_edge);
	const gap_line = line_dataset('Vs trend',
				      quarters.map(percent_above_trend));
	const low_path = line_dataset(path_label(TARGET_RANGE_LOW),
		path_values(quarters, TARGET_RANGE_LOW), band_edge);
	const high_path = line_dataset(path_label(TARGET_RANGE_HIGH),
		path_values(quarters, TARGET_RANGE_HIGH), shaded_to_previous);
	const run = current_run();
	const first_in_view = first_quarter_shown(quarters);
	const first_label = quarter_short_name(first_in_view);
	const visible_range = { min: first_label };
	const options = chart_options(
		'Per cent above (+) or below (\u2212) trend',
		signed_percent_tick, describe_gap_point, visible_range);
	const chart_data = { labels: labels,
			     datasets: [gap_line, low_path, high_path] };

	show_run_marker_legend(run, first_in_view);
	drawn_charts.push(new Chart(element_by_id('gap-chart'), {
		type: 'line',
		data: chart_data,
		plugins: [reference_line_plugin(0),
			  run_start_marker_plugin(
				  quarters.indexOf(run.first_quarter))],
		options: options,
	}));
}

function bar_colour(rate)
{
	if (rate >= TARGET_RANGE_LOW && rate <= TARGET_RANGE_HIGH)
		return theme_colour('--price');
	return theme_colour('--outside-target-range');
}

function describe_catch_up_bar(bar)
{
	return 'At ' + bar.label + ' a year: about ' +
	       Math.round(bar.parsed.y) + ' years';
}

function draw_catch_up_chart()
{
	const rates = catch_up_rates();
	const years = rates.map(years_back_to_trend);
	const x_title = { display: true, text: 'Average inflation, % a year' };
	const x_axis_changes = { grid: { display: false }, title: x_title };
	const options = chart_options('Years to get back on trend', plain_tick,
				      describe_catch_up_bar, x_axis_changes);
	const bars = { label: 'Years', data: years,
		       maxBarThickness: WIDEST_BAR_IN_PIXELS,
		       backgroundColor: rates.map(bar_colour) };
	const chart_data = { labels: rates.map(rate => rate + '%'),
			     datasets: [bars] };

	element_by_id('catch-up-chart').parentElement.hidden =
		rates.length === 0;
	options.scales.y.beginAtZero = true;
	options.scales.y.grace = '10%';
	drawn_charts.push(new Chart(element_by_id('catch-up-chart'), {
		type: 'bar',
		data: chart_data,
		plugins: [bar_label_plugin(years)],
		options: options,
	}));
}

function describe_wage_point(point)
{
	return point.dataset.label + ': ' + point.parsed.y.toFixed(1);
}

function draw_wage_chart()
{
	if (wage_comparison_available())
		draw_wage_comparison_chart();
}

function wage_index_series()
{
	const comparison = wage_comparison_window();
	const base = comparison.first_quarter;
	const quarters = cpi_quarters.filter(quarter =>
		quarter >= base && quarter <= comparison.last_quarter);
	const indexed = series => quarters.map(quarter =>
		series[quarter] / series[base] * 100);

	return {
		base: base,
		quarters: quarters,
		cpi: indexed(cpi_by_quarter),
		wpi: indexed(wpi_by_quarter),
		trend: quarters.map(quarter =>
			trend_growth_between(base, quarter) * 100),
	};
}

function draw_wage_comparison_chart()
{
	const series = wage_index_series();
	const wage_style = { borderColor: theme_colour('--wages'),
			     backgroundColor: theme_colour('--wages') };
	const trend_style = { borderColor: theme_colour('--reference-line'),
			      backgroundColor: theme_colour('--reference-line'),
			      borderWidth: 1,
			      borderDash: DASH_PATTERN_IN_PIXELS };
	const datasets = [
		line_dataset('CPI', series.cpi),
		line_dataset('Wage Price Index', series.wpi, wage_style),
		line_dataset(trend_rate + '% trend', series.trend, trend_style),
	];
	const options = chart_options(quarter_long_name(series.base) + ' = 100',
				      plain_tick, describe_wage_point);

	element_by_id('wage-chart-title').textContent =
		'CPI and Wage Price Index since prices went ' +
		(current_run().is_above ? 'above' : 'below') + ' trend';
	element_by_id('wage-trend-legend-label').textContent =
		trend_rate + '% trend';
	drawn_charts.push(new Chart(element_by_id('wage-chart'), {
		type: 'line',
		data: { labels: series.quarters.map(quarter_short_name),
			datasets: datasets },
		options: options,
	}));
}

function labour_data_available()
{
	return labour_months.length > 0;
}

function show_labour_reading()
{
	const label = element_by_id('labour-label');
	const latest = labour_months[labour_months.length - 1];

	label.textContent = 'Unemployment and underutilisation, ' +
		month_long_name(latest);
	element_by_id('labour-value').textContent =
		unemployment_by_month[latest].toFixed(1) + '% and ' +
		underutilisation_by_month[latest].toFixed(1) + '%';
}

function show_labour_figure()
{
	const has_data = labour_data_available();

	element_by_id('labour-label').parentElement.hidden = !has_data;
	if (has_data)
		show_labour_reading();
}

function describe_gap_chart()
{
	const run = current_run();
	const side = run.is_above ? 'above' : 'below';
	const gap = percent_above_trend(latest_quarter);

	return 'Price level relative to the ' + trend_rate +
	       '% trend, quarterly from the ' +
	       quarter_long_name(TREND_BASE_QUARTER) + ': ' +
	       format_signed_number(gap, 1) + ' per cent in the ' +
	       quarter_long_name(latest_quarter) + ', ' + side +
	       ' trend since the ' + quarter_long_name(run.first_quarter) +
	       '. The range between paths at ' + TARGET_RANGE_LOW + ' and ' +
	       TARGET_RANGE_HIGH + ' per cent a year is shaded.';
}

function describe_catch_up_rate(rate)
{
	return rate + ' per cent: about ' +
	       Math.round(years_back_to_trend(rate)) + ' years';
}

function describe_catch_up_chart()
{
	const rates = catch_up_rates().map(describe_catch_up_rate);

	return 'Years for the price level to return to the ' + trend_rate +
	       '% trend, by average inflation: ' + rates.join('; ') + '.';
}

function percent_growth(series, first_quarter, last_quarter)
{
	return (series[last_quarter] / series[first_quarter] - 1) * 100;
}

function describe_wage_chart()
{
	const comparison = wage_comparison_window();
	const first = comparison.first_quarter;
	const last = comparison.last_quarter;
	const trend_rise = (trend_growth_between(first, last) - 1) * 100;

	return 'CPI, Wage Price Index and the ' + trend_rate +
	       '% trend from the ' + quarter_long_name(first) + ' to the ' +
	       quarter_long_name(last) + ': CPI rose ' +
	       format_number(percent_growth(cpi_by_quarter, first, last), 1) +
	       ' per cent, the Wage Price Index rose ' +
	       format_number(percent_growth(wpi_by_quarter, first, last), 1) +
	       ' per cent and the trend ' + format_number(trend_rise, 1) +
	       ' per cent.';
}

function describe_labour_chart()
{
	const latest = labour_months[labour_months.length - 1];
	const opening =
		'Monthly unemployment and underutilisation rates, seasonally adjusted, with months when prices were above the ';

	return opening + trend_rate + '% trend shaded. In ' +
	       month_long_name(latest) +
	       ': unemployment rate ' +
	       unemployment_by_month[latest].toFixed(1) +
	       ' per cent, underutilisation rate ' +
	       underutilisation_by_month[latest].toFixed(1) + ' per cent.';
}

function set_chart_description(chart_id, description)
{
	element_by_id(chart_id).setAttribute('aria-label', description);
}

function newest_first(rows)
{
	return rows.slice().reverse();
}

function gap_table_rows()
{
	const row = quarter => [
		quarter_short_name(quarter),
		format_signed_number(percent_above_trend(quarter), 2),
	];

	return newest_first(quarters_since_trend_base().map(row));
}

function catch_up_table_rows()
{
	const row = rate => [
		rate + '%',
		String(Math.round(years_back_to_trend(rate))),
	];

	return catch_up_rates().map(row);
}

function wage_table_rows()
{
	const series = wage_index_series();
	const row = (quarter, i) => [
		quarter_short_name(quarter),
		series.cpi[i].toFixed(1),
		series.wpi[i].toFixed(1),
		series.trend[i].toFixed(1),
	];

	return newest_first(series.quarters.map(row));
}

function labour_table_rows()
{
	const row = month => [
		month_short_name(month),
		unemployment_by_month[month].toFixed(1),
		underutilisation_by_month[month].toFixed(1),
	];

	return newest_first(labour_months_since_trend_base().map(row));
}

function data_row(cells)
{
	const row = document.createElement('tr');
	const heading = document.createElement('th');

	heading.scope = 'row';
	heading.textContent = cells[0];
	row.appendChild(heading);
	cells.slice(1).forEach(text => row.appendChild(number_cell(text)));
	return row;
}

function fill_chart_data(chart_id, rows)
{
	const table_body = element_by_id(chart_id + '-data');

	table_body.replaceChildren(...rows.map(data_row));
	table_body.closest('details').hidden = rows.length === 0;
}

function fill_chart_data_tables()
{
	const wage_rows = wage_comparison_available() ? wage_table_rows() : [];
	const labour_rows = labour_data_available() ? labour_table_rows() : [];

	fill_chart_data('gap-chart', gap_table_rows());
	fill_chart_data('catch-up-chart', catch_up_table_rows());
	fill_chart_data('wage-chart', wage_rows);
	fill_chart_data('labour-chart', labour_rows);
}

function show_chart_descriptions()
{
	set_chart_description('gap-chart', describe_gap_chart());
	set_chart_description('catch-up-chart', describe_catch_up_chart());
	if (wage_comparison_available())
		set_chart_description('wage-chart', describe_wage_chart());
	if (labour_data_available())
		set_chart_description('labour-chart', describe_labour_chart());
}

function show_figures()
{
	show_titles();
	show_headline_inflation();
	show_gap_figures();
	show_wage_figure();
	show_labour_figure();
	fill_recent_quarters();
	show_chart_descriptions();
	fill_chart_data_tables();
}

function draw_charts()
{
	drawn_charts.forEach(chart => chart.destroy());
	drawn_charts = [];
	Chart.defaults.font.family = CHART_FONT;
	Chart.defaults.font.size = CHART_FONT_SIZE_IN_PIXELS;
	Chart.defaults.color = theme_colour('--muted-text');
	draw_gap_chart();
	draw_catch_up_chart();
	draw_wage_chart();
	draw_labour_section();
}

function draw()
{
	if (!latest_quarter)
		return;
	show_figures();
	if (window.Chart)
		draw_charts();
	else
		element_by_id('load-status').textContent =
			'Charts unavailable: the chart library did not load. ';
}

function days_since(iso_date)
{
	const then = new Date(iso_date + 'T00:00:00');

	return (Date.now() - then) / MILLISECONDS_PER_DAY;
}

function failing_series_note(status, failing_names)
{
	const dates = failing_names.map(name =>
		status.series[name].failing_since);
	const names = failing_names.map(name =>
		SERIES_DESCRIPTIONS[name] || name);
	const earliest = dates.sort()[0];

	return ' ABS source unavailable since ' + australian_date(earliest) +
	       ' for ' + names.join(', ') + '; showing the last data held.';
}

function freshness_note(status)
{
	const all_series = status.series || {};
	const failing_names = Object.keys(all_series)
		.filter(name => all_series[name].failing_since);
	let note = 'Checked ' + australian_date(status.checked) + '.';

	if (days_since(status.checked) > DAYS_BEFORE_UPDATES_COUNT_AS_STOPPED)
		note += ' Automatic updates have not run since then.';
	if (failing_names.length > 0)
		note += failing_series_note(status, failing_names);
	return note;
}

function month_was_above_trend(month)
{
	const quarter = quarter_of_month(month);

	if (!(quarter in cpi_by_quarter) || quarter < TREND_BASE_QUARTER)
		return false;
	return is_above_trend(quarter);
}

function shade_months_above_trend(chart, months)
{
	const area = chart.chartArea;
	const x_axis = chart.scales.x;
	const column_width = x_axis.getPixelForValue(1) -
			     x_axis.getPixelForValue(0);
	const context = chart.ctx;

	context.save();
	context.fillStyle = theme_colour('--above-trend');
	context.beginPath();
	context.rect(area.left, area.top, area.right - area.left,
		     area.bottom - area.top);
	context.clip();
	months.forEach((month, index) => {
		const left = x_axis.getPixelForValue(index) - column_width / 2;

		if (month_was_above_trend(month))
			context.fillRect(left, area.top, column_width,
					 area.bottom - area.top);
	});
	context.restore();
}

function above_trend_shading_plugin(months)
{
	return {
		id: 'above-trend-shading',
		beforeDatasetsDraw: chart =>
			shade_months_above_trend(chart, months),
	};
}

function describe_labour_point(point)
{
	return point.dataset.label + ': ' + point.parsed.y.toFixed(1) + '%';
}

function first_month_shown(months)
{
	const latest = months[months.length - 1];

	if (chart_range_years === 0)
		return months[0];
	return month_shifted_by_years(latest, -chart_range_years);
}

function labour_months_since_trend_base()
{
	const first_month = first_month_of_quarter(TREND_BASE_QUARTER);

	return labour_months.filter(month => month >= first_month);
}

function draw_labour_chart()
{
	const months = labour_months_since_trend_base();
	const unemployment_style = {
		borderColor: theme_colour('--unemployment'),
		backgroundColor: theme_colour('--unemployment') };
	const underutilisation_style = {
		borderColor: theme_colour('--underutilisation'),
		backgroundColor: theme_colour('--underutilisation') };
	const datasets = [
		line_dataset('Unemployment rate',
			months.map(month => unemployment_by_month[month]),
			unemployment_style),
		line_dataset('Underutilisation rate',
			months.map(month => underutilisation_by_month[month]),
			underutilisation_style),
	];
	const visible_range = {
		min: month_short_name(first_month_shown(months)) };
	const options = chart_options('Per cent of the labour force',
		value => value + '%', describe_labour_point, visible_range);

	element_by_id('above-trend-legend-label').textContent =
		'Prices above ' + trend_rate + '% trend';
	options.scales.y.beginAtZero = true;
	drawn_charts.push(new Chart(element_by_id('labour-chart'), {
		type: 'line',
		data: { labels: months.map(month_short_name),
			datasets: datasets },
		plugins: [above_trend_shading_plugin(months)],
		options: options,
	}));
}

function draw_labour_section()
{
	const section = element_by_id('labour-chart').closest('.chart-box');
	const is_hidden = !labour_data_available();

	section.hidden = is_hidden;
	element_by_id('labour-chart-title').hidden = is_hidden;
	if (labour_data_available())
		draw_labour_chart();
}

function show_freshness(status)
{
	const freshness = element_by_id('freshness');

	if (status && status.checked)
		freshness.textContent = freshness_note(status);
	else
		freshness.textContent = 'Update status unreadable.';
}

function is_shown_entry(entry)
{
	return typeof entry.title === 'string' && entry.title !== '' &&
	       typeof entry.date === 'string' &&
	       typeof entry.link === 'string' &&
	       entry.link.startsWith(FEED_LINK_PREFIX);
}

function newest_first_by_date(entry, other_entry)
{
	return other_entry.date.localeCompare(entry.date);
}

function feed_entries_shown(feeds_file)
{
	const feeds = Object.values(feeds_file.feeds || {});
	const entries = feeds.flatMap(feed => feed.entries || []);

	return entries.filter(is_shown_entry)
		.sort(newest_first_by_date)
		.slice(0, FEED_ENTRIES_SHOWN);
}

function feed_source_text(entries)
{
	return 'Source: RBA ' + entries[0].date.slice(0, 4) + '.';
}

function feed_entry_item(entry)
{
	const item = document.createElement('li');
	const link = document.createElement('a');

	link.setAttribute('href', entry.link);
	link.textContent = entry.title;
	item.append(link, ', ' + australian_date(entry.date));
	return item;
}

function show_feed(feeds_file)
{
	const entries = feed_entries_shown(feeds_file);

	if (entries.length === 0)
		return;
	element_by_id('rba-feed-entries').replaceChildren(
		...entries.map(feed_entry_item));
	element_by_id('rba-feed-source').textContent =
		feed_source_text(entries);
	element_by_id('rba-feed').hidden = false;
}

function hide_feed()
{
	element_by_id('rba-feed').hidden = true;
}

function report_missing_status()
{
	element_by_id('freshness').textContent = 'Update status unavailable.';
}

function save_file(file_name, contents)
{
	const link = document.createElement('a');

	link.href = URL.createObjectURL(contents);
	link.download = file_name;
	document.body.appendChild(link);
	link.click();
	setTimeout(() => {
		URL.revokeObjectURL(link.href);
		link.remove();
	}, 0);
}

function png_title(button)
{
	return element_by_id(button.dataset.pngTitle).textContent;
}

function png_source(button)
{
	return button.parentElement.querySelector('.source-text').textContent;
}

function scaled_png_layout(scale)
{
	const layout = {};

	for (const [name, size] of Object.entries(PNG_LAYOUT_IN_PIXELS))
		layout[name] = size * scale;
	layout.chart_font_size = CHART_FONT_SIZE_IN_PIXELS * scale;
	return layout;
}

function blank_png_canvas(chart_canvas, layout)
{
	const image = document.createElement('canvas');

	image.width = chart_canvas.width + layout.margin * 2;
	image.height = chart_canvas.height + layout.title_space +
		       layout.footer_space;
	return image;
}

function swatch_kind(class_names)
{
	const kind_class = only_one(class_names.filter(name =>
		name in SWATCH_KINDS), 'legend swatch kind');

	return SWATCH_KINDS[kind_class];
}

function legend_entry(key_span)
{
	const swatch = key_span.querySelector('i');
	const swatch_style = getComputedStyle(swatch);
	const kind = swatch_kind([...swatch.classList]);

	return {
		text: key_span.textContent.trim(),
		colour: kind === 'line' ? swatch_style.borderTopColor :
			swatch_style.backgroundColor,
		kind: kind,
	};
}

function legend_entries(canvas)
{
	const legend = canvas.closest('.chart-box').querySelector('.legend');
	const key_spans = [...legend.children].filter(span =>
		span.querySelector('i'));

	return key_spans.map(legend_entry);
}

function swatch_size(entry, layout)
{
	const sizes = {
		line: [layout.swatch_width, layout.swatch_line_height],
		box: [layout.swatch_width, layout.swatch_box_height],
		marker: [layout.swatch_marker_width,
			 layout.swatch_marker_height],
	};
	const [width, height] = sizes[entry.kind];

	return { width: width, height: height };
}

function draw_png_legend(context, entries, layout)
{
	const top = layout.legend_baseline;
	let x = layout.margin;

	context.font = layout.chart_font_size + 'px ' + CHART_FONT;
	for (const entry of entries) {
		const swatch = swatch_size(entry, layout);
		const swatch_left = x +
			(layout.swatch_width - swatch.width) / 2;
		const text_width = context.measureText(entry.text).width;

		context.fillStyle = entry.colour;
		context.fillRect(swatch_left,
				 top - swatch.height / 2 - layout.swatch_lift,
				 swatch.width, swatch.height);
		context.fillStyle = theme_colour('--muted-text');
		context.fillText(entry.text, x + layout.text_offset, top);
		x += layout.text_offset + text_width + layout.entry_gap;
	}
}

function export_png(button)
{
	const chart_id = button.dataset.pngChart;
	const canvas = element_by_id(chart_id);
	const layout = scaled_png_layout(devicePixelRatio);
	const image = blank_png_canvas(canvas, layout);
	const context = image.getContext('2d');
	const file_name = chart_id + '-' + latest_quarter + '.png';

	context.fillStyle = theme_colour('--background');
	context.fillRect(0, 0, image.width, image.height);
	context.fillStyle = theme_colour('--text');
	context.font = layout.title_font_size + 'px ' + CHART_FONT;
	context.fillText(png_title(button), layout.margin,
			 layout.title_baseline);
	draw_png_legend(context, legend_entries(canvas), layout);
	context.drawImage(canvas, layout.margin, layout.title_space);
	context.fillStyle = theme_colour('--muted-text');
	context.font = layout.source_font_size + 'px ' + CHART_FONT;
	context.fillText(png_source(button) + ' ' + location.host,
			 layout.margin,
			 image.height - layout.source_baseline_from_bottom);
	image.toBlob(png => save_file(file_name, png), 'image/png');
}

function csv_row(quarter)
{
	const price_change = annual_change(cpi_by_quarter, quarter);
	const wage_change = annual_change(wpi_by_quarter, quarter);
	const since_trend_base = quarter >= TREND_BASE_QUARTER;

	return [
		quarter,
		cpi_by_quarter[quarter],
		price_change === null ? '' : price_change.toFixed(3),
		since_trend_base ? percent_above_trend(quarter).toFixed(3) : '',
		wpi_by_quarter[quarter] ?? '',
		wage_change === null ? '' : wage_change.toFixed(3),
	];
}

function export_csv()
{
	const trend_column = 'vs_' + String(trend_rate).replace('.', '_') +
			     'pct_trend_pct';
	const header = ['quarter', 'cpi_index', 'cpi_year_ended_pct',
			trend_column, 'wpi_index', 'wpi_year_ended_pct'];
	const rows = [header].concat(cpi_quarters.map(csv_row));
	const text = rows.map(row => row.join(',')).join('\n');
	const file_name = 'price-level-vs-' + trend_rate + 'pct-trend-' +
			  latest_quarter + '.csv';

	save_file(file_name, new Blob([text], { type: 'text/csv' }));
}

function mark_pressed(buttons, data_name, chosen_value)
{
	for (const button of buttons)
		button.setAttribute('aria-pressed',
				    String(Number(button.dataset[data_name]) ===
					   chosen_value));
}

function range_buttons()
{
	return document.querySelectorAll('[data-range-years]');
}

function trend_buttons()
{
	return document.querySelectorAll('[data-trend-rate]');
}

function set_chart_range(years)
{
	chart_range_years = years;
}

function set_trend_rate(rate)
{
	trend_rate = rate;
}

function show_view_choices()
{
	mark_pressed(range_buttons(), 'rangeYears', chart_range_years);
	mark_pressed(trend_buttons(), 'trendRate', trend_rate);
}

function save_view_in_address()
{
	const view = '#r=' + chart_range_years + '&t=' + trend_rate;

	run_unless_blocked(() => history.replaceState(null, '', view));
}

function read_view_from_address()
{
	const address = location.hash || '';
	const range = address.match(/r=(\d+)/);
	const rate = address.match(/t=([\d.]+)/);

	if (range && RANGE_YEAR_CHOICES.includes(range[1]))
		set_chart_range(Number(range[1]));
	if (rate && TREND_RATE_CHOICES.includes(rate[1]))
		set_trend_rate(Number(rate[1]));
	show_view_choices();
}

function view_summary()
{
	const span = chart_range_years === 0 ? 'the full series' :
		     'the last ' + chart_range_years + ' years';

	return 'Showing the ' + trend_rate + '% trend over ' + span + '.';
}

function announce_view()
{
	element_by_id('view-status').textContent = view_summary();
}

function choose_trend_rate(rate)
{
	set_trend_rate(rate);
	show_view_choices();
	save_view_in_address();
	draw();
	announce_view();
}

function choose_chart_range(years)
{
	set_chart_range(years);
	show_view_choices();
	save_view_in_address();
	draw();
	announce_view();
}

function download_png(button)
{
	download_or_report(() => export_png(button));
}

function download_csv()
{
	if (latest_quarter)
		download_or_report(export_csv);
}

function bind_controls()
{
	const png_buttons = document.querySelectorAll('[data-png-chart]');

	for (const button of trend_buttons())
		button.addEventListener('click', () =>
			choose_trend_rate(Number(button.dataset.trendRate)));
	for (const button of range_buttons())
		button.addEventListener('click', () =>
			choose_chart_range(Number(button.dataset.rangeYears)));
	for (const button of png_buttons)
		button.addEventListener('click', () => download_png(button));
	element_by_id('csv-download').addEventListener('click', download_csv);
}

function watch_theme_changes()
{
	const dark_mode = matchMedia('(prefers-color-scheme: dark)');

	if (dark_mode.addEventListener)
		dark_mode.addEventListener('change', draw);
}

function fetch_json(address)
{
	return fetch(address, { cache: 'no-store' }).then(response => {
		if (!response.ok)
			throw new Error('HTTP ' + response.status);
		return response.json();
	});
}

function use_built_in_copy(load_error)
{
	if (!window.BUILT_IN_DATA)
		throw load_error;
	return { data: window.BUILT_IN_DATA, source: 'built-in copy' };
}

function load_site_data()
{
	return fetch_json('data/data.json')
		.then(data => ({ data: data, source: 'live' }))
		.catch(use_built_in_copy);
}

function built_in_copy_message()
{
	return 'Showing the built-in copy of the data, to the ' +
	       quarter_long_name(latest_quarter) + '; live data unavailable. ';
}

function report_data_source(source)
{
	const load_status = element_by_id('load-status');

	if (source === 'live')
		load_status.textContent = '';
	else if (source === 'built-in copy')
		load_status.textContent = built_in_copy_message();
	else
		throw new Error('Unknown data source: ' + source);
}

function show_site(loaded)
{
	load_data(loaded.data);
	report_data_source(loaded.source);
	draw();
	return fetch_json('data/status.json')
		.then(show_freshness, report_missing_status);
}

function show_load_error()
{
	element_by_id('load-status').textContent = LOAD_FAILURE_MESSAGE;
}

function start()
{
	run_unless_blocked(read_view_from_address);
	bind_controls();
	watch_theme_changes();
	if (window.Chart)
		Chart.register({ id: 'page-background',
				 beforeDraw: fill_page_background });
	load_site_data()
		.then(show_site)
		.catch(show_load_error);
	fetch_json(FEED_FILE)
		.then(show_feed)
		.catch(hide_feed);
}

function functions_for_tests()
{
	return {
		quarter_shifted_by: quarter_shifted_by,
		signed_percent_tick: signed_percent_tick,
		month_shifted_by_years: month_shifted_by_years,
		quarter_long_name: quarter_long_name,
		quarter_short_name: quarter_short_name,
		month_long_name: month_long_name,
		quarter_of_month: quarter_of_month,
		first_month_of_quarter: first_month_of_quarter,
		format_number: format_number,
		format_signed_number: format_signed_number,
		month_position: month_position,
		last_month_of_quarter: last_month_of_quarter,
		run_unless_blocked: run_unless_blocked,
		download_or_report: download_or_report,
		load_data: load_data,
		set_trend_rate: set_trend_rate,
		set_chart_range: set_chart_range,
		trend_price_level: trend_price_level,
		percent_above_trend: percent_above_trend,
		is_above_trend: is_above_trend,
		annual_change: annual_change,
		average_inflation_since_trend_base:
			average_inflation_since_trend_base,
		years_back_to_trend: years_back_to_trend,
		catch_up_rates: catch_up_rates,
		current_run: current_run,
		wages_relative_to_prices: wages_relative_to_prices,
		wage_comparison_window: wage_comparison_window,
		wage_comparison_available: wage_comparison_available,
		path_relative_to_trend: path_relative_to_trend,
		monthly_reading_is_current: monthly_reading_is_current,
		load_site_data: load_site_data,
		describe_gap_chart: describe_gap_chart,
		run_summary: run_summary,
		swatch_kind: swatch_kind,
		x_axis_ticks: x_axis_ticks,
		describe_catch_up_chart: describe_catch_up_chart,
		describe_wage_chart: describe_wage_chart,
		describe_labour_chart: describe_labour_chart,
		report_data_source: report_data_source,
		band_edge_style: band_edge_style,
		shows_in_tooltip: shows_in_tooltip,
		gap_table_rows: gap_table_rows,
		catch_up_table_rows: catch_up_table_rows,
		wage_table_rows: wage_table_rows,
		labour_table_rows: labour_table_rows,
		view_summary: view_summary,
		labour_data_available: labour_data_available,
		feed_entries_shown: feed_entries_shown,
		feed_source_text: feed_source_text,
	};
}

if (typeof window === 'undefined')
	module.exports = functions_for_tests();
else
	start();
