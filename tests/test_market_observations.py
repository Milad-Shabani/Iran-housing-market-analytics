from datetime import date
from pathlib import Path
import sys

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "scripts"), str(ROOT / "src")]

from build_city_monthly import COLUMNS, RENT_COLUMNS, market_archives, tehran_district_ids
import collect_rentals_weekly as rentals
from iran_housing.observations import market_tables, month_bounds


def test_province_amounts_pool_ads_and_independent_rental_denominators():
    # The smaller city cannot appear by itself. It still contributes to the province.
    base = ["residential-rent", "apartment-rent"]
    def rows(city, count, rent_mode, rent, deposit):
        return [base + [city, "2024-06-01", 75, None, rent_mode, "مقطوع", rent, deposit]] * count
    ads = pd.DataFrame(rows("rasht", 55, "مقطوع", 8e6, 400e6)
                       + rows("lahijan", 35, "مجانی", 0, 900e6)
                       + rows("rasht", 18, "مقطوع", 16e6, 900e6)
                       + rows("gilan-e-gharb", 100, "مقطوع", 2e6, 65e6), columns=COLUMNS+RENT_COLUMNS)
    tables = dict(market_archives(ads, {"rasht": "IR-01", "lahijan": "IR-01", "gilan-e-gharb": "IR-17"}))
    dep = tables["deposit"].query("area == 'IR-01'").iloc[0]
    rent = tables["rent"].query("area == 'IR-01'").iloc[0]
    assert (dep.listings, dep.cities, dep["median"], dep.p75) == (108, 2, 400e6, 900e6)
    assert (rent.listings, rent.cities, rent["median"]) == (73, 1, 8e6)
    assert tables["sale"].empty
    assert "lahijan" not in tables["deposit"].area.tolist()


def test_district_membership_requires_tehran_and_valid_coordinates():
    ads = pd.DataFrame({"city_slug": ["tehran","tehran","rasht","tehran"],
                        "location_latitude": [35.7333,37.28,35.7333,None],
                        "location_longitude": [51.4231,49.58,51.4231,51.4231]})
    matched = tehran_district_ids(ads)
    assert matched.index.tolist() == [0] and matched.iloc[0] in {str(i) for i in range(1,23)}


def test_public_market_files_reconcile_with_real_observations():
    assert month_bounds("2024-02") == ("2024-02-01", "2024-02-29")
    tables = market_tables()
    gilan = pd.read_csv(ROOT / "data/geo/divar_gilan_cities.csv")
    assert gilan.city_slug.nunique() == 56 and "gilan-e-gharb" not in set(gilan.city_slug)
    for market, table in tables.items():
        assert set(table.market) == {market}
        assert table.period_start.le(table.period_end).all()
        assert table.loc[table.source == "archive", "unit"].str.startswith("source_units").all()
        assert table.loc[table.source != "archive", "unit"].str.startswith("toman_per_").all()
        assert not any((table.source == "tehran_map") & (table.period_start == "2026-10-02"))
        assert set(table.query("gilan and source == 'panel'").area) >= {"rasht","bandar-anzali","lahijan"}
        assert table.query("area_level == 'district' and source == 'archive'").area.nunique() == 22
        assert table.query("area == 'IR-01'").gilan.all()
        assert not table.query("area_level == 'district'").gilan.any()
        assert table.query("area_level == 'province' and area == 'IR-01'").areas_covered.max() > 20
        assert table.to_csv(index=False) == (ROOT / f"data/processed/market_{market}.csv").read_text()


def test_rental_card_and_weekly_acceptance_by_amount(tmp_path):
    post = {"map_post_card":{"token":"fixture","chips":[{"title":"۸۵ متر"}],
                            "price_fields":[{"title":"ودیعه:","value":"۸۰۰ میلیون"},
                                            {"title":"اجاره:","value":"رایگان"}]}}
    flat = rentals.rental_card(post)
    assert flat["deposit"] == 800e6 and flat["rent"] is None
    def initial(areas, minutes, *, category, parser):
        assert category == "apartment-rent" and parser is rentals.rental_card
        return [dict(flat, rent=12e6) for _ in range(75)]
    path=tmp_path/"rental.csv"
    assert rentals.refresh(["lahijan"], path, date(2026,11,26), collect=initial) == 0
    original=path.read_bytes()
    assert rentals.refresh(["lahijan"], path, date(2026,11,26), collect=initial) == 0
    assert path.read_bytes() == original
    def only_deposits(*args, **kwargs):
        return [flat]*70
    assert rentals.refresh(["lahijan"], path, date(2026,12,4), collect=only_deposits) == 0
    frame=pd.read_csv(path)
    assert frame.groupby("market").size().to_dict() == {"deposit":2,"rent":1}
    assert frame.neighbourhoods.eq(36).all()
