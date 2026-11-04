# Australian Price Level vs 2.5% Trend

<https://coolnormal.com/>

A static page comparing Australia's consumer price level with a path growing 2.5 per cent a year from the September quarter 1993. It shows the current gap, how many years it would take to close at different inflation rates, whether wage rates have kept pace since prices went above trend, and what the labour market looked like along the way.

This is an independent site, not affiliated with the Reserve Bank of Australia or the Australian Bureau of Statistics. The RBA targets inflation of 2–3 per cent; it does not target the price level. The 2.5 and 2 per cent trends are this site's yardsticks, not RBA policy.

The price level is the ABS all groups CPI adjusted, as the RBA does, for interest charges before the September quarter 1998 and the 1999–2000 tax changes, including the GST, using RBA table G1. From the December quarter 2000 it moves exactly with the CPI as published. Headline inflation is the CPI as published.

## How the figures are calculated

- **Trend:** the CPI of the September quarter 1993 grown at 2.5 per cent a year, the midpoint of the 2–3 per cent target range that the RBA aims for, or at 2 per cent, the bottom of that range (chosen on the page). It is a fixed yardstick path, not a statistical trend estimate. The RBA dates its inflation target to the early 1990s; the September quarter 1993 is this site's choice of base.
- **Gap:** the price level divided by the trend, minus one, in per cent. Overshoots and undershoots both count.
- **Above or below trend since:** the first quarter of the current run on one side of the trend. A single quarter on the other side is treated as noise and does not end the run.
- **Years to get back on trend:** `ln(1 + gap) / ln((1 + trend rate) / (1 + r))` for average inflation `r` from 1 to 4 per cent a year, with the gap and rates as fractions.
- **Long-run average:** compound annual growth of the price level since the September quarter 1993.
- **Wages:** the CPI, the Wage Price Index and the trend, each indexed to 100 at the quarter prices crossed the trend. The headline figure is the real Wage Price Index: the WPI deflated by the CPI as published over the same quarters. The WPI measures hourly rates of pay for the same jobs, excluding bonuses; it is not household income.
- **Labour market:** the unemployment rate and the underutilisation rate (unemployed plus underemployed), with months when prices were above trend shaded.

## Data

Every ABS series comes from the ABS Data API and is refreshed weekly. If the ABS is unavailable, the page keeps showing the last good data and says so.

| Series | ABS key |
|---|---|
| CPI, all groups, eight capital cities, quarterly | `ABS,CPI,2.0.0/1.10001.10.50.Q` |
| CPI, all groups, eight capital cities, monthly | `ABS,CPI,2.0.0/1.10001.10.50.M` |
| Wage Price Index, total hourly rates of pay excluding bonuses, seasonally adjusted | `ABS,WPI,1.2.0/1.THRPEB.7.TOT.20.AUS.Q` |
| Unemployment rate, persons 15 and over, seasonally adjusted, monthly | `ABS,LF,1.0.0/M13.3.1599.20.AUS.M` |
| Underutilisation rate, persons 15 and over, seasonally adjusted, monthly | `ABS,LF_UNDER,1.0.1/M24.3.1599.20.AUS.M` |

Based on Australian Bureau of Statistics data, licensed under CC BY 4.0. The calculations on this site are not the ABS's.

The adjustment for interest charges and the 1999–2000 tax changes uses RBA statistical table G1, Consumer Price Inflation (quarterly changes in the CPI and in the CPI excluding interest charges and tax changes of 1999–2000, both seasonally adjusted; series GCPIAGSAQP and GCPIEITCQP, December quarter 1993 to September quarter 2000). Source: Reserve Bank of Australia 2026.

The sidebar lists the newest item from each of three RBA RSS feeds (media releases, the Statement on Monetary Policy and speeches), fetched with the weekly update: titles, dates and links only. Source: Reserve Bank of Australia, licensed under CC BY 4.0. This site is not endorsed by the RBA.

## Running it locally

```
python3 -m http.server 8000
```

Then open http://localhost:8000. To refresh the data from the ABS, run `python3 scripts/update_data.py`.

## Tests

```
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
npm run lint && npm test
npm run lint:python && npm run test:python
```

## Licence

Text, charts and data: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (see `LICENSE-CONTENT.md`). Code: MIT (see `LICENSE`). Chart.js is included under its own MIT licence.
