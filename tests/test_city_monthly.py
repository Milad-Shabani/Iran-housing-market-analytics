"""Tests for the independent Divar apartment city-month archive."""
from pathlib import Path
import sys

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "scripts"), str(ROOT / "src")]

from build_city_monthly import COLUMNS, summarize_city_months
from iran_housing.export import city_monthly_block


def test_aggregate_coverage_and_quantiles_exclude_other_categories():
    common = ["residential-sell", "apartment-sell", "tehran", "2024-06-01", 100]
    rows = [common + [1e9] for _ in range(25)] + [common + [3e9] for _ in range(25)]
    rows += [["residential-rent", "apartment-rent", "tehran", "2024-06-01", 100, 1e9]]
    rows += [common[:2] + ["karaj", "2024-06-01", 100, 2e9] for _ in range(49)]
    rows += [common[:4] + [1, 1e8], common + [0], common + [1e14]]
    table, usable = summarize_city_months(pd.DataFrame(rows, columns=COLUMNS))
    assert usable == 99
    assert table.to_dict("records") == [
        {"city_slug": "tehran", "month": "2024-06", "listings": 50, "median": 20000000,
         "p25": 10000000, "p75": 30000000},
    ]


def test_published_archive_reconciles_and_has_real_monthly_gaps():
    block = city_monthly_block()
    cities = {c["s"]: c["rows"] for c in block["cities"]}
    meta = block["meta"]
    rows = [r for c in cities.values() for r in c]
    assert len(cities) == meta["cities"] == 81
    assert len(rows) == meta["city_months"] == 577
    assert sum(r[1] for r in rows) == meta["displayed_listings"] == 274983
    assert all(r[1] >= 50 and 0 < r[3] <= r[2] <= r[4] for r in rows)
    assert {r[0] for r in cities["mashhad"]} >= {"2024-05", "2024-12"}
    assert "2025-01" not in {r[0] for r in cities["mashhad"]}
    assert [r for r in cities["tehran"] if r[0] == "2024-12"] == [
        ["2024-12", 11508, 87623957, 59615385, 126153846],
    ]


def test_rental_sample_requires_both_fixed_positive_amounts():
    from build_city_monthly import summarize_rentals, RENT_COLUMNS
    common = ["residential-rent", "apartment-rent", "shiraz", "2024-06-01", 100, None]
    fixed = ["مقطوع", "مقطوع"]
    paired = [common + fixed + [1e7, 5e8] for _ in range(50)]
    excluded = [common + fixed + [0, 6e8], common + fixed + [1e7, 0],
                common + ["توافقی", "مقطوع", 2e7, 4e8], common + fixed + [None, 4e8]]
    t, usable = summarize_rentals(pd.DataFrame(paired + excluded, columns=COLUMNS + RENT_COLUMNS))
    assert usable == t.listings.item() == 50
    assert t.rent_median.item() == 1e7 and t.deposit_median.item() == 5e8
    block = city_monthly_block("rentals")
    assert block["meta"]["cities"] == 66
    assert block["meta"]["displayed_listings"] == 142524
    for city in block["cities"]:
        assert city["fa"]
        for month, n, rent, rent_lo, rent_hi, deposit, dep_lo, dep_hi in city["rows"]:
            assert n >= 50 and 0 < rent_lo <= rent <= rent_hi and 0 < dep_lo <= deposit <= dep_hi
