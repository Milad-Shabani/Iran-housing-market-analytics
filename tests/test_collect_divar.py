"""Tests for the optional Divar 1405 collector (parsing and aggregation, no network).

The response shapes follow Divar's web map endpoint as documented publicly
(github.com/alighaffari3000/divar-scraper, docs/DIVAR_API.md). The ads below are
test fixtures, not data: they only check that parsing and aggregation are wired correctly.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "src"))

import collect_divar as C  # noqa: E402
from iran_housing import market as M  # noqa: E402


@pytest.mark.parametrize("text,value", [
    ("۱۲٫۵ میلیارد", 12.5e9), ("۸۵۰ میلیون تومان", 850e6), ("۲۳٬۵۰۰٬۰۰۰٬۰۰۰ تومان", 23.5e9),
    ("توافقی", None), (None, None), ("12 میلیارد", 12e9),
])
def test_parse_amount(text, value):
    assert C.parse_amount(text) == value


def test_parse_chips_reads_size_rooms_age_and_icons():
    chips = [{"title": "۱۲۰ متر"}, {"title": "بدون اتاق"}, {"title": "نوساز"},
             {"icon_url_light": "https://s100.divarcdn.com/static/imgs/widget-icons/light/parking.png"},
             {"icon_url_light": "https://s100.divarcdn.com/static/imgs/widget-icons/light/elevator.png"}]
    out = C.parse_chips(chips)
    assert out == {"size_m2": 120.0, "rooms": 0.0, "age_years": 0.0, "parking": 1, "elevator": 1}


def test_parse_post_derives_price_per_m2():
    post = {"map_post_card": {"token": "T1", "price_fields": [{"title": "قیمت:", "value": "۱۵ میلیارد"}],
                              "chips": [{"title": "۱۰۰ متر"}, {"title": "۲ اتاق"}, {"title": "۱۰ سال"}]},
            "map_pin_feature": {"lat": 35.76, "lon": 51.41, "approximate_location": False}}
    row = C.parse_post(post)
    assert row["price_toman"] == 15e9 and row["price_per_m2_toman"] == 150e6
    assert row["rooms"] == 2 and row["age_years"] == 10 and row["approximate_location"] == 0
    assert C.parse_post({"map_post_card": {}}) is None


def test_zoom_stays_in_the_range_that_returns_posts():
    assert C.zoom_for((51.08, 35.55, 51.62, 35.84)) == 14
    assert 14 <= C.zoom_for((51.40, 35.70, 51.401, 35.701)) <= 17


def test_aggregate_places_ads_in_districts(tmp_path):
    rows = []
    for i in range(30):   # fixture ads around Tajrish (District 1) and Nazi-abad (District 16)
        rows.append({"token": f"a{i}", "lat": 35.8045, "lon": 51.4255, "price_per_m2_toman": 400e6 + i * 1e6,
                     "price_toman": 40e9, "size_m2": 100, "parking": 1, "elevator": 1, "collected_on": "2026-09-26"})
        rows.append({"token": f"b{i}", "lat": 35.6450, "lon": 51.4080, "price_per_m2_toman": 100e6 + i * 1e6,
                     "price_toman": 8e9, "size_m2": 80, "parking": 0, "elevator": 1, "collected_on": "2026-09-26"})
    raw = tmp_path / "raw.csv"
    pd.DataFrame(rows).to_csv(raw, index=False)
    C.aggregate(raw, out_dir=tmp_path / "out")
    d = pd.read_csv(tmp_path / "out" / "tehran_districts_1405.csv").set_index("district")
    assert set(d.index) == {1, 16}
    assert d.loc[1, "ppm2"] > d.loc[16, "ppm2"]
    assert d.loc[1, "listings"] == 30
    assert {"rooms_median", "build_year", "size_median", "price_median"} <= set(d.columns)


def test_levels_match_the_1403_method(tmp_path):
    """District and Tehran levels are listing-weighted medians of neighbourhood medians."""
    base = {"price_toman": 40e9, "size_m2": 100, "parking": 1, "elevator": 1, "collected_on": "2026-09-26"}
    rows = [{**base, "token": f"t{i}", "slug": "tajrish", "lat": 35.8040, "lon": 51.4294,
             "price_per_m2_toman": 400e6 + i * 1e6} for i in range(30)]
    rows += [{**base, "token": f"n{i}", "slug": "niavaran", "lat": 35.8177, "lon": 51.4690,
              "price_per_m2_toman": 450e6 + i * 1e6} for i in range(12)]
    raw = tmp_path / "raw.csv"
    pd.DataFrame(rows).to_csv(raw, index=False)
    C.aggregate(raw, out_dir=tmp_path / "out")
    h = pd.read_csv(tmp_path / "out" / "tehran_neighbourhoods_1405.csv").set_index("slug")
    d = pd.read_csv(tmp_path / "out" / "tehran_districts_1405.csv").set_index("district")
    expected = M.wquantile(h.ppm2, h.listings, 0.5)
    assert set(h.index) == {"tajrish", "niavaran"} and set(h.district) == {1}
    assert d.loc[1, "ppm2"] == pytest.approx(expected)
    meta = json.loads((tmp_path / "out" / "meta.json").read_text())
    assert meta["tehran_median_ppm2"] == pytest.approx(expected)


def test_live_layer_is_optional():
    has = (ROOT / "data/raw/divar_1405/tehran_districts_1405.csv").exists()
    assert (M.load_divar_1405() is not None) == has


def test_snapshots_accumulate_across_runs(tmp_path):
    base = {"lat": 35.8045, "lon": 51.4255, "price_toman": 40e9, "size_m2": 100, "parking": 1, "elevator": 1}
    out = tmp_path / "out"
    for day, level in (("2026-09-19", 400e6), ("2026-09-26", 420e6)):
        rows = [{**base, "token": f"{day}-{i}", "price_per_m2_toman": level + i * 1e6, "collected_on": day}
                for i in range(20)]
        raw = tmp_path / f"{day}.csv"
        pd.DataFrame(rows).to_csv(raw, index=False)
        C.aggregate(raw, out_dir=out)
    snaps = pd.read_csv(out / "snapshots.csv", dtype={"scope": str})
    tehran = snaps[snaps.scope == "tehran"].set_index("collected_on")
    assert list(tehran.index) == ["2026-09-19", "2026-09-26"]
    assert tehran.loc["2026-09-26", "ppm2"] > tehran.loc["2026-09-19", "ppm2"]


def test_catalog_covers_every_1403_neighbourhood():
    cat = pd.read_csv(ROOT / "data/geo/divar_tehran_neighbourhoods.csv")
    hoods = pd.read_csv(ROOT / "data/raw/divar_1m/tehran_neighborhood_summary.csv")
    assert cat.slug.is_unique and len(cat) >= 400
    assert set(hoods.neighborhood_slug) <= set(cat.slug)


def test_dropped_connections_are_retried(monkeypatch):
    import http.client
    import io
    calls = {"n": 0}

    def flaky(req, timeout=None):
        calls["n"] += 1
        if calls["n"] == 1:
            raise http.client.RemoteDisconnected("Remote end closed connection without response")
        return io.BytesIO(b'{"posts": []}')
    monkeypatch.setattr(C.urllib.request, "urlopen", flaky)
    monkeypatch.setattr(C.time, "sleep", lambda s: None)
    assert C._http("https://example.invalid", {"x": 1}) == {"posts": []}
    assert calls["n"] == 2
