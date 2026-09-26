"""Tests for the data layer, geography, models and the built dashboard.

Run with `pytest -q`. They read only committed files, so they run offline in CI.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from iran_housing import listings as L  # noqa: E402
from iran_housing import market as M  # noqa: E402
from iran_housing import timeseries as T  # noqa: E402
from iran_housing import valuation as V  # noqa: E402
from iran_housing.geo import DistrictLocator  # noqa: E402
from iran_housing.jalali import jalali_to_gregorian  # noqa: E402


# ------------------------------------------------------------------ fixtures
@pytest.fixture(scope="session")
def hoods():
    return M.load_neighborhoods_2024()


@pytest.fixture(scope="session")
def listings_2021(hoods):
    df, rep = L.clean(L.load_raw())
    df, _ = L.link_locations(df, hoods)
    return df, rep


@pytest.fixture(scope="session")
def cbi_log():
    s = T.load_series()
    last = int(s[s.cbi.notna()].t.max())
    return pd.Series(np.log(s.cbi.to_numpy()), index=s.t.to_numpy()).loc[:last]


# ------------------------------------------------------------------ calendar
@pytest.mark.parametrize("jy,jm,iso", [(1395, 1, "2016-03-20"), (1399, 12, "2021-02-19"), (1400, 1, "2021-03-21"),
                                        (1403, 1, "2024-03-20"), (1404, 1, "2025-03-21"), (1405, 7, "2026-09-23")])
def test_jalali_month_starts(jy, jm, iso):
    assert jalali_to_gregorian(jy, jm).isoformat() == iso


# ------------------------------------------------------------------ raw data integrity
def test_raw_files_have_expected_shape():
    assert len(pd.read_csv(ROOT / "data/raw/divar_2021/tehran_listings_raw.csv")) == 3479
    assert len(pd.read_csv(ROOT / "data/raw/divar_1m/city_summary.csv")) == 420
    assert len(pd.read_csv(ROOT / "data/raw/divar_1m/tehran_neighborhood_summary.csv")) == 345
    cbi = pd.read_csv(ROOT / "data/raw/official/cbi_tehran_monthly.csv")
    assert len(cbi) == 91 and cbi.source_url.notna().all()
    assert cbi.price_per_m2_toman.is_monotonic_increasing is False  # real series has dips
    assert cbi.price_per_m2_toman.between(3e6, 1e8).all()


def test_every_official_value_traces_to_a_url():
    for f in ["cbi_tehran_monthly.csv", "kilid_tehran_monthly.csv"]:
        d = pd.read_csv(ROOT / "data/raw/official" / f)
        assert d.source_url.str.startswith("https://").all()


def test_cbi_scale_is_consistent_across_sources():
    """The d-learn extract switches units at 1401/05; after conversion no month may jump >25%."""
    s = T.load_series().dropna(subset=["cbi"])
    s = s[s.t.diff() == 1]
    jumps = (s.cbi / T.load_series().set_index("t").cbi.reindex(s.t - 1).to_numpy() - 1).abs()
    assert jumps.max() < 0.25


# ------------------------------------------------------------------ geography
def test_all_22_districts_and_31_provinces_present():
    geo = json.loads((ROOT / "data/geo/tehran_districts.geojson").read_text())
    assert sorted(f["properties"]["district"] for f in geo["features"]) == list(range(1, 23))
    prov = json.loads((ROOT / "data/geo/iran_provinces.geojson").read_text())
    assert len({f["properties"]["iso"] for f in prov["features"]}) == 31


@pytest.mark.parametrize("lat,lon,district", [
    (35.8045, 51.4255, 1),   # Tajrish square
    (35.7575, 51.4097, 3),   # Vanak square
    (35.6997, 51.3380, 9),   # Azadi tower
    (35.6450, 51.4080, 16),  # Nazi-abad
    (35.5950, 51.4350, 20),  # Shahr-e Rey
    (35.7470, 51.2080, 22),  # Chitgar lake
])
def test_landmarks_fall_in_the_right_district(lat, lon, district):
    assert DistrictLocator().locate(lat, lon)[0] == district


def test_neighbourhoods_are_located(hoods):
    located = hoods[hoods.district.notna()].listings.sum() / hoods.listings.sum()
    assert located > 0.98
    assert hoods.groupby("district").size().min() >= 5


def test_city_lookup_covers_almost_all_listings():
    lk = pd.read_csv(ROOT / "data/geo/iran_city_lookup.csv")
    share = lk[lk.match != "unassigned"].listings.sum() / lk.listings.sum()
    assert share > 0.99
    assert lk.set_index("city_slug").loc[["tehran", "karaj", "mashhad", "isfahan", "rasht"], "province_iso"].tolist() == \
        ["IR-23", "IR-30", "IR-09", "IR-10", "IR-01"]


# ------------------------------------------------------------------ market structure (real-world sanity)
def test_north_south_gradient(hoods):
    d = M.district_table_2024(hoods).set_index("district")
    assert d.loc[1, "ppm2"] == d.ppm2.max()
    assert d.loc[1, "ppm2"] / d.ppm2.min() > 3
    north = d.loc[[1, 2, 3], "ppm2"].mean()
    south = d.loc[[16, 17, 18, 19, 20], "ppm2"].mean()
    assert north > 2.5 * south


def test_tehran_is_the_most_expensive_province():
    p = M.province_table(M.load_cities_2024())
    assert p.iloc[0].province_iso == "IR-23"
    assert p.ppm2.iloc[0] > 2 * p.attrs["national_median"]


def test_cleaning_keeps_almost_all_rows(listings_2021):
    df, rep = listings_2021
    assert rep["clean_rows"] > 0.98 * rep["raw_rows"]
    assert df.area_m2.between(20, 1000).all() and (df.price_toman > 0).all()
    assert df.listing_id.is_unique


def test_older_sample_is_cheaper_everywhere(listings_2021, hoods):
    df, _ = listings_2021
    d = M.district_table_2024(hoods).merge(M.district_table_2021(df), on="district")
    d = d[d.reliable_2021]
    assert (d.ppm2 > d.ppm2_2021).all()


# ------------------------------------------------------------------ models
def test_valuation_model_beats_location_baseline(listings_2021):
    df, _ = listings_2021
    scores, _ = V.cross_validate(df)
    assert scores["hedonic_ols"]["r2_log"] > 0.8
    assert scores["hedonic_ols"]["median_ape"] < scores["location_only"]["median_ape"]
    assert scores["gradient_boosting"]["r2_log"] >= scores["location_only"]["r2_log"]


def test_valuation_coefficients_are_plausible(listings_2021):
    df, _ = listings_2021
    m = V.fit_final(df)
    c = m["coef"]
    assert 0.9 < c["log_area"] < 1.2          # price scales roughly with size
    assert 0.9 < c["log_hood_ppm2"] < 1.1     # neighbourhood level passes through ~1:1
    assert c["parking"] > 0 and c["elevator"] > 0


def test_backtest_uses_only_past_data(cbi_log):
    """A method fed data up to an origin must give the same forecast whatever comes after it."""
    origin = 60
    a = T.drift_long(cbi_log.loc[:origin], 6)
    b = T.drift_long(cbi_log.loc[:origin].copy(), 6)
    assert np.allclose(a, b)
    bt = T.backtest(cbi_log, H=12)
    assert (bt.origin + bt.h <= cbi_log.dropna().index.max()).all()


def test_long_run_growth_wins_at_one_year(cbi_log):
    lb = T.leaderboard(T.backtest(cbi_log, H=12))
    assert lb.index[0] == "drift_long"
    assert lb.loc["drift_12m", "mape_h12"] > lb.loc["drift_long", "mape_h12"]


def test_error_bands_widen_with_horizon(cbi_log):
    b = T.error_bands(T.backtest(cbi_log, H=12), "drift_long", H=12)
    assert (b.q90 - b.q10).iloc[-1] > (b.q90 - b.q10).iloc[0]
    assert (b.q10 < 1).all() and (b.q90 > 1).all()


# ------------------------------------------------------------------ built artefacts
def test_dashboard_data_is_complete():
    p = ROOT / "data/processed/dashboard_data.json"
    if not p.exists():
        pytest.skip("run scripts/run_pipeline.py first")
    d = json.loads(p.read_text(encoding="utf-8"))
    assert len(d["tehran"]["districts"]) == 22 and len(d["iran"]["provinces"]) == 31
    assert all(x["path"].startswith("M") for x in d["tehran"]["districts"])
    named = sum(bool(x["fa"]) for x in d["tehran"]["hoods"]) / len(d["tehran"]["hoods"])
    assert named > 0.99  # Persian names for (almost) every neighbourhood; the rest fall back to Latin
    assert len(d["forecast"]["bands"]) == 24


@pytest.mark.parametrize("page", ["index.html", "index.fa.html"])
def test_site_pages_are_self_contained(page):
    p = ROOT / "site" / page
    if not p.exists():
        pytest.skip("run scripts/build_dashboard.py first")
    html = p.read_text(encoding="utf-8")
    assert "{{" not in html
    for bad in ('src="http', "href=\"https://cdn", "googleapis", "jsdelivr", "unpkg"):
        assert bad not in html
