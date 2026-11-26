"""Comparable, dated observations for the dashboard's sale, rent and deposit views."""
from __future__ import annotations

from calendar import monthrange
from datetime import date

import pandas as pd

from .market import load_comparable_divar_snapshots
from .paths import DATA, GEO, RAW

MARKETS = ("sale", "rent", "deposit")
PROFILE_FIELDS = ["median_area_m2", "median_per_apartment", "median_per_m2", "rooms_reported", "two_bedroom_listings"]
FIELDS = ["market", "source", "area_level", "area", "period_start", "period_end", "unit",
          "listings", "median", "p25", "p75", "areas_covered"] + PROFILE_FIELDS


def month_bounds(month):
    year, number = map(int, month.split("-"))
    return month + "-01", date(year, number, monthrange(year, number)[1]).isoformat()


def profile_values(row):
    # Earlier surveys recorded the headline amount and quartiles only.
    return [getattr(row, field, None) for field in PROFILE_FIELDS]


def market_tables():
    gilan = pd.read_csv(GEO / "divar_gilan_cities.csv")
    members = set(gilan.city_slug)
    sale_panels = pd.read_csv(RAW / "divar_weekly" / "city_snapshots.csv")
    rent_path = RAW / "divar_weekly" / "rental_snapshots.csv"
    rentals = pd.read_csv(rent_path) if rent_path.exists() else pd.DataFrame(columns=["market"])
    snapshots = load_comparable_divar_snapshots()
    district_counts = snapshots[snapshots.scope != "tehran"].groupby("collected_on").scope.nunique()
    tables = {}
    for market in MARKETS:
        records = []
        archive = pd.read_csv(DATA / "market_archive" / (market + ".csv"))
        archive_unit = "source_units_per_m2" if market == "sale" else "source_units_per_apartment"
        for r in archive.itertuples(index=False):
            records.append([market, "archive", r.level, r.area, *month_bounds(r.month), archive_unit,
                            r.listings, r.median, r.p25, r.p75, r.cities if r.level == "province" else None, *profile_values(r)])
        if market == "sale":
            for r in snapshots.itertuples(index=False):
                city = r.scope == "tehran"
                records.append([market, "tehran_map", "city" if city else "district", "tehran" if city else r.scope,
                                r.collected_on, r.collected_on, "toman_per_m2", r.listings, r.ppm2, r.ppm2_p25,
                                r.ppm2_p75, district_counts[r.collected_on] if city else None, *profile_values(r)])
            for r in sale_panels.itertuples(index=False):
                records.append([market, "panel", "city", r.city, r.date, r.date, "toman_per_m2",
                                r.listings, r.median_toman_m2, r.p25_toman_m2, r.p75_toman_m2, r.neighbourhoods, *profile_values(r)])
        else:
            for r in rentals[rentals.market == market].itertuples(index=False):
                records.append([market, "panel", "city", r.city, r.date, r.date, "toman_per_apartment",
                                r.listings, r.median_toman, r.p25_toman, r.p75_toman, r.neighbourhoods, *profile_values(r)])
        table = pd.DataFrame(records, columns=FIELDS)
        amounts = ["listings", "median", "p25", "p75"]
        if (table.duplicated(["source", "area_level", "area", "period_start"]).any()
                or not table.listings.gt(0).all() or not table.p25.gt(0).all()
                or not (table.p25.le(table["median"]) & table["median"].le(table.p75)).all()):
            raise ValueError(f"Invalid observations in {market}")
        table[amounts] = table[amounts].round().astype("int64")
        headline = "median_per_m2" if market == "sale" else "median_per_apartment"
        table[headline] = table[headline].fillna(table["median"])
        for field in ("areas_covered", "median_per_m2", "median_per_apartment", "rooms_reported", "two_bedroom_listings"):
            table[field] = table[field].round().astype("Int64")
        if (table.two_bedroom_listings.gt(table.rooms_reported).any()
                or table.rooms_reported.gt(table.listings).any()
                or table.median_area_m2.dropna().lt(20).any()
                or not table[headline].eq(table["median"]).all()):
            raise ValueError(f"Supplementary measures do not reconcile in {market}")
        table["gilan"] = (table.area_level.eq("province") & table.area.eq("IR-01")
                          | table.area_level.eq("city") & table.area.isin(members))
        tables[market] = table.sort_values(["period_start", "source", "area_level", "area"]).reset_index(drop=True)
    return tables


def dashboard_observations(tables):
    # Encode a single shared header, also used by the filtered CSV download.
    columns = list(tables["sale"].columns)
    return {"columns": columns, "markets": {market: table.astype(object).where(table.notna(), None).values.tolist()
                                            for market, table in tables.items()}}
