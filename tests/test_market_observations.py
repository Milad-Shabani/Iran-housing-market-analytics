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


def test_supplementary_medians_and_the_known_room_denominator():
    base = ["residential-sell", "apartment-sell", "rasht", "2024-08-07"]
    rows = [base + [60, 1_800_000_000, "دو"]] * 35
    rows += [base + [100, 1_000_000_000, "یک"]] * 20
    rows += [base + [140, 2_800_000_000, None]] * 30
    ads = pd.DataFrame(rows, columns=COLUMNS + ["rooms_count"])
    ads[RENT_COLUMNS] = None
    sale = dict(market_archives(ads, {"rasht":"IR-01"}))["sale"]
    for r in sale.itertuples():
        assert (r.listings, r.median_area_m2, r.rooms_reported, r.two_bedroom_listings) == (85, 100, 55, 35)
        assert r.median_per_apartment == 1_800_000_000
        assert r.median_per_m2 == r.median == 20_000_000
        assert r.median_area_m2 * r.median_per_m2 != r.median_per_apartment


def test_weekly_profile_uses_each_amount_and_reads_previous_schema(tmp_path):
    import collect_city_weekly as weekly
    cards = [{"size_m2": 60, "rooms": 2, "rent": 18_000_000, "deposit": 300_000_000},
             {"size_m2": 100, "rooms": None, "rent": 10_000_000, "deposit": 250_000_000},
             {"size_m2": 140, "rooms": 0, "rent": 28_000_000, "deposit": 140_000_000}]
    rents = weekly.sample_profile(cards, "rent")
    assert rents == dict(median_area_m2=100, median_per_apartment=18_000_000,
                         median_per_m2=200_000, rooms_reported=2, two_bedroom_listings=1)
    assert weekly.sample_profile(cards, "deposit")["median_per_m2"] == 2_500_000
    path = tmp_path / "old.csv"
    old = weekly.HEADER[:-len(weekly.PROFILE_FIELDS)]
    path.write_text(",".join(old) + "\nrasht,2026-11-20,2026-11-14,350,32,30,40,48,abc\n")
    previous = weekly.load_rows(path, weekly.HEADER)
    weekly.save(path, weekly.HEADER, previous)
    loaded = weekly.load_rows(path, weekly.HEADER)
    assert loaded[0]["date"] == "2026-11-20" and all(loaded[0][k] == "" for k in weekly.PROFILE_FIELDS)
