# Methodology

Every step below is code in `src/iran_housing/` and is re-run by `scripts/run_pipeline.py`.
Judgement calls are listed where they are made, with their effect on the numbers.

## 1. Geography

**Tehran districts.** The 22 municipal district polygons come from
[rferdosi/tehran-districts](https://github.com/rferdosi/tehran-districts). `DistrictLocator`
(`geo.py`) assigns a point to the polygon that contains it. Points within 600 m of a polygon but
outside every one (the file is hand-digitised and has slivers) snap to the nearest district;
that affects 6 of 345 neighbourhoods and 503 of 91,836 listings.

**Neighbourhood locations.** The 1M-ad Divar release reports, for each Tehran neighbourhood,
the median latitude and longitude of its listings. Those points, run through the locator,
put 99.4% of Tehran listings inside a district. Five landmarks are checked in the tests
(Tajrish, Vanak, Azadi Tower, Chitgar lake, Shahr-e Rey).

**Cities to provinces.** Divar city slugs are matched to OpenStreetMap county names with a loose
transliteration key (`qaem-shahr` = `Qaem Shahr County`), which matches 206 of 420 cities. The
other 148 are assigned by hand in `data/geo/city_county_overrides.csv` (for example
`andisheh-new-town` → Shahriar County, `kish` → Bandar Lengeh County); 66 small towns stay
unassigned. Matched cities hold 99.5% of listings. City bubbles are drawn at the county's
representative point, which is exact for county seats and approximate otherwise (the tooltip says so).

## 2. Cross-sectional market tables (`market.py`)

The 1M-ad release publishes medians per neighbourhood and per city, not raw ads. District and
province figures are therefore **listing-weighted medians of neighbourhood (or city) medians**:
sort the units by median, walk the cumulative listing count to its midpoint. Quartiles use the
same weighted walk.

**Flags.** A neighbourhood with at least 30 listings whose median is below 45% of its district's
median is flagged `outlier_vs_district` (5 cases: Andisheh and Shahr-e Ziba in District 5,
Shemiran-no, Arjantin, Bazaar). Their price levels match nearby satellite towns rather than their
district, which points to mixed or mis-slugged listings. They are drawn on the map with a dashed
outline and left out of district figures. Neighbourhoods under 30 listings are shown and marked
`thin_sample`.

## 3. The older listing sample (`listings.py`)

3,479 individual Tehran ads with area, rooms, parking, storage, elevator and price.

| Step | Rows removed |
|---|---:|
| Area outside 20–1,000 m² (several rows hold the price in the area field) | 5 |
| Missing price or address | 23 |
| Price per m² more than 4 robust SDs from the median on the log scale | 4 |
| **Kept** | **3,447** |

The free-text address is linked to a 2024 neighbourhood slug (so it inherits real coordinates
and a district) by the same transliteration key, plus 79 hand-written links in
`data/geo/listing_name_overrides_2021.csv`. Three of those are decided by price level rather than
name: `Andisheh` (12.6 M/m²) is Andisheh new town, not the Tehran street; `Shahrake Qods`
(8.8 M/m²) is Shahr-e Qods, not Shahrak-e Gharb (77 M/m²). Result: 2,683 ads in Tehran districts,
605 in satellite towns, 159 unlocated.

**Dating the sample.** The file carries no dates. Its USD column is exactly price / 30,000, the
free-market rate of roughly 1399–1401. Its Tehran median (40.0 M toman/m²) equals the Central
Bank's transaction mean of 1401/03–1401/04 (39.4–41.7 M). Asking prices usually sit above
transaction prices, so the scrape is probably somewhat earlier; the dashboard calls it "c. 1400".
District growth multiples (c. 1400 → 1403) are only reported where the old sample has at least 15 ads.

## 4. Valuation model (`valuation.py`)

Target: `log(price)`. Features: `log(area)`, rooms, parking, storage, elevator, and
`log(neighbourhood median price per m²)`. The neighbourhood level is **target-encoded out of fold**
and shrunk toward the city median with 5 pseudo-listings, so no listing sees its own price and
small neighbourhoods do not overfit. Five-fold CV, three models:

| Model | R² (log) | Median APE | MAPE | Within ±20% |
|---|---:|---:|---:|---:|
| Hedonic OLS (used in the dashboard) | 0.882 | 15.7% | 29.3% | 61% |
| Gradient boosting (HistGradientBoosting) | 0.896 | 15.1% | 26.7% | 62% |
| Location only (area × neighbourhood median) | 0.867 | 17.3% | 32.3% | 56% |

Coefficients (90% bootstrap intervals, 300 resamples): parking +18.2% (+14.2 to +23.0),
elevator +8.5% (+4.6 to +12.1), each bedroom +9.3% (+5.0 to +13.7), storage −6.2% (−10.5 to
−2.3). The storage sign is most likely building age leaking in: storage rooms are more common in
older blocks and the dataset has no age field. Area elasticity is 1.05, so price per m² rises
about 0.5% for every 10% of extra floor area once the neighbourhood is fixed.

**In the browser.** For a neighbourhood with 1403 median price per m² *H*, median size *A₀*,
median rooms *R₀* and amenity shares (*p₀*, *s₀*, *e₀*):

```
price = H · A₀ · exp( b_area·(ln A − ln A₀) + b_rooms·(R − R₀)
                      + b_parking·(p − p₀) + b_storage·(s − s₀) + b_elevator·(e − e₀) )
```

The neighbourhood's typical listing is priced exactly at its 1403 median; the coefficients from
individual ads move the price away from it. The 80% range is the 10th–90th percentile of the
out-of-fold error ratio (×0.71 to ×1.41). An optional roll-forward multiplies by a market change
the user picks; the preset is Kilid's Mordad 1405 reading over Divar's 1403 Tehran median (+152%).

## 5. Time series and forecast (`timeseries.py`)

**Series.** The Central Bank of Iran's monthly mean price per m² of Tehran transactions:
1395/01–1399/12 from one transcription, 1400/06–1401/09 from the d-learn CBI extract (units switch
from toman to thousand rials at 1401/05 and are converted; a test fails if any consecutive month
moves more than 25% after conversion), 1402/02–1403/05 from cited press reports of the CBI figure.
91 of 101 months are present; the Kalman-filter method uses the gaps as missing, the others
interpolate in logs only for fitting.

**Backtest.** Every month with at least 36 months of history and an observation 1–24 months later
is a forecast origin (35 origins for the 12-month horizon). Each method sees only data up to the
origin. Mean absolute percentage error by horizon:

| Method | 1 mo | 3 mo | 6 mo | 12 mo | 24 mo |
|---|---:|---:|---:|---:|---:|
| Long-run growth (first-to-last average log growth) | 3.4% | **7.1%** | **12.9%** | **20.8%** | **15.2%** |
| No change | 3.6% | 8.9% | 18.2% | 32.7% | 53.7% |
| Damped trend (Holt) | **3.3%** | 8.8% | 20.2% | 33.8% | 58.9% |
| Local linear trend (Kalman) | 3.4% | 9.2% | 21.2% | 39.0% | 87.4% |
| Last-12-month momentum | 3.7% | 9.4% | 19.4% | 39.2% | 43.8% |

**Live outlook.** The official series ends at 1403/05, so the live forecast starts from Kilid's
latest reading (1405/05, 210 M toman/m²) and grows it at the long-run rate of the official series
(44.6% a year) by default. Band widths are the backtest winner's empirical 10th/25th/75th/90th
percentile of actual ÷ forecast at each horizon. The user can change the growth rate; the bands
keep their relative width.

## 6. Optional 1405 layer (`scripts/collect_divar.py`)

Divar's web map endpoint (`POST /v8/mapview/viewport`, documented at
github.com/alighaffari3000/divar-scraper, tested 1405/06/24) returns at most 200 ads per map
rectangle. The collector walks Divar's catalog of 453 Tehran neighbourhoods, requests each one with
Divar's `districts` filter over its bounding box, and splits any rectangle whose `count` exceeds
what was returned, so every ad carries the neighbourhood Divar assigns it. From each map card it keeps coordinates, the (rounded) price,
and the chips for size, rooms, building age, parking and elevator. Aggregation applies the same
rules as the 1403 data (20–1,000 m², robust 4-SD filter on log price per m²), assigns districts
by point-in-polygon, keeps Divar's neighbourhood tag when the ad sits inside that
neighbourhood's box (the nearest catalog centroid otherwise; in the first full collection 99.9% of
tags agreed with the location), and writes counts, medians and quartiles. District and Tehran price
levels are computed exactly like the 1403 figures they are compared with: the listing-weighted
median of neighbourhood medians (neighbourhoods with 10+ ads); the plain median of all ads is kept
in `meta.json` as `tehran_median_ppm2_all_ads`. Each run appends one row per district and one for
Tehran to `snapshots.csv`, which becomes a weekly series when the refresh workflow is on.

On the dashboard every figure belongs to one period: c. 1400 (the 3,447-ad sample), 1403 (the 1M-listing
dataset) or the latest collection, plus the Central Bank and Kilid months. The year bar picks the
period; an indicator without data for it is shown as missing, never carried over from another year.
Neighbourhoods that have 1405 ads but no 1403 median (70 in the first collection) appear only on the
1405 map, at Divar's catalog centroid. Rounded map prices move a median
by well under 1%.

## 7. What this project does not do

- It does not splice asking and transaction prices into one series.
- It does not estimate the 12 months between the last CBI release and the first Kilid reading.
- It does not claim the 2021 sample's date, the district boundaries or the city placements are
  survey-grade; each is labelled where it is used.
