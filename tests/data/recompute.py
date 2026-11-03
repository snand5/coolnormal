import csv
import json
import math
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
BASE_QUARTER = "1993-Q3"
QUARTERS_PER_YEAR = 4
LOWEST_CATCH_UP_RATE_IN_HUNDREDTHS = 100
HIGHEST_CATCH_UP_RATE_IN_HUNDREDTHS = 400
CATCH_UP_STEP_IN_HUNDREDTHS = 25
SYNTHETIC_BASE_INDEX = 100
RBA_EXTRACT = "fixtures/rba-g1-interest-and-tax.csv"


def read_json(name):
	return json.loads((HERE / name).read_text())


def by_period(observations):
	return {observation["period"]: observation["value"]
		for observation in observations}


def position(quarter):
	return int(quarter[:4]) * QUARTERS_PER_YEAR + int(quarter[-1]) - 1


def quarter_at(quarter_position):
	year, index = divmod(quarter_position, QUARTERS_PER_YEAR)
	return f"{year}-Q{index + 1}"


def rba_adjustment_factors():
	lines = [line for line in (HERE / RBA_EXTRACT).read_text().splitlines()
		 if not line.startswith("#")]
	factors = {}
	factor = 1.0

	for row in csv.DictReader(lines):
		factor *= ((1 + float(row["GCPIEITCQP"]) / 100) /
			   (1 + float(row["GCPIAGSAQP"]) / 100))
		factors[row["quarter"]] = factor
	return factors


def years_from(first_quarter, quarter):
	return (position(quarter) - position(first_quarter)) / QUARTERS_PER_YEAR


class PriceLevel:
	def __init__(self, data, trend_rate):
		self.cpi = by_period(data["cpi_quarterly"])
		self.wpi = by_period(data.get("wpi_quarterly", []))
		self.trend_rate = trend_rate
		self.latest = max(self.cpi)
		self.factors = {}
		if "interest_and_tax_adjustment" in data:
			self.factors = rba_adjustment_factors()

	def price_level(self, quarter):
		adjusted = [q for q in self.factors if q <= quarter]
		factor = self.factors[max(adjusted)] if adjusted else 1.0

		return self.cpi[quarter] * factor

	def gap(self, quarter):
		growth = (1 + self.trend_rate / 100) ** years_from(BASE_QUARTER,
								   quarter)
		trend = self.price_level(BASE_QUARTER) * growth
		return (self.price_level(quarter) / trend - 1) * 100

	def above(self, quarter):
		return self.gap(quarter) >= 0

	def earlier_quarter_in_run(self, quarter, run_is_above):
		for step in (1, 2):
			earlier = quarter_at(position(quarter) - step)
			if earlier < BASE_QUARTER:
				return None
			if self.above(earlier) == run_is_above:
				return earlier
		return None

	def run(self):
		run_is_above = self.above(self.latest)
		first = self.latest
		earlier = self.earlier_quarter_in_run(first, run_is_above)

		while earlier:
			first = earlier
			earlier = self.earlier_quarter_in_run(first,
							      run_is_above)
		length = position(self.latest) - position(first) + 1
		return run_is_above, first, length

	def average_inflation(self):
		growth = (self.price_level(self.latest) /
			  self.price_level(BASE_QUARTER))
		years = years_from(BASE_QUARTER, self.latest)
		return (growth ** (1 / years) - 1) * 100

	def annual_change(self, quarter):
		year_earlier = quarter_at(position(quarter) - QUARTERS_PER_YEAR)
		return (self.cpi[quarter] / self.cpi[year_earlier] - 1) * 100

	def catch_up_rates(self):
		hundredths = range(LOWEST_CATCH_UP_RATE_IN_HUNDREDTHS,
				   HIGHEST_CATCH_UP_RATE_IN_HUNDREDTHS + 1,
				   CATCH_UP_STEP_IN_HUNDREDTHS)
		rates = [step / 100 for step in hundredths]

		if self.above(self.latest):
			return [rate for rate in rates
				if rate < self.trend_rate]
		return [rate for rate in rates
			if rate > self.trend_rate]

	def years_back_to_trend(self, rate):
		closing = (1 + self.trend_rate / 100) / (1 + rate / 100)
		return (math.log(1 + self.gap(self.latest) / 100) /
			math.log(closing))

	def wage_window(self):
		first = max(self.run()[1], min(self.wpi))
		last = min(self.latest, max(self.wpi))
		return first, last

	def wages_relative_to_prices(self):
		first, last = self.wage_window()
		wage_growth = self.wpi[last] / self.wpi[first]
		price_growth = self.cpi[last] / self.cpi[first]
		return (wage_growth / price_growth - 1) * 100


def cpi_with_gaps(percent_gaps, trend_rate):
	observations = []

	for step, percent_gap in enumerate(percent_gaps):
		growth = (1 + trend_rate / 100) ** (step / QUARTERS_PER_YEAR)
		trend = SYNTHETIC_BASE_INDEX * growth
		observations.append({
			"period": quarter_at(position(BASE_QUARTER) + step),
			"value": trend * (1 + percent_gap / 100),
		})
	return observations
