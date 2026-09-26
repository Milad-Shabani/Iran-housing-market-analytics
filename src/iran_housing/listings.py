"""Listing-level Divar data for Tehran (3,479 ads, circa 1400 / 2021).

Cleaning rules (every dropped row is counted in the returned report):
  1. `Area` arrives as text with thousands separators; a few rows hold the price in
     the area field. Keep 20 m2 <= area <= 1,000 m2.
  2. Price must be present and positive.
  3. Price per m2 must sit within 4 robust standard deviations (median/MAD on the log
     scale) - removes data-entry slips such as a missing zero, not genuine luxury units.

Each ad's free-text neighbourhood is then linked to the 2024 Divar neighbourhood
slugs, which carry real median listing coordinates, and from there to a municipal
district by point-in-polygon. Satellite towns are linked to their city slug instead.
"""
from __future__ import annotations

import re

import numpy as np
import pandas as pd

from .geo import DistrictLocator
from .paths import GEO, RAW


def norm(name: str) -> str:
    """Loose transliteration key: 'Yousef Abad' ~ 'yousef-abad', 'Punak' ~ 'poonak'."""
    s = re.sub(r"[^a-z]", "", str(name).lower())
    for a, b in [("ou", "u"), ("oo", "u"), ("ee", "i"), ("iy", "i"), ("ey", "ei"), ("gh", "q"),
                 ("kh", "x"), ("w", "v"), ("aa", "a"), ("eh", "e"), ("ah", "a"), ("ie", "i")]:
        s = s.replace(a, b)
    return re.sub(r"(.)\1", r"\1", s)


def load_raw() -> pd.DataFrame:
    return pd.read_csv(RAW / "divar_2021" / "tehran_listings_raw.csv")


def clean(raw: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    df = raw.copy()
    report = {"raw_rows": int(len(df))}
    df["area_m2"] = pd.to_numeric(df["Area"].astype(str).str.replace(",", "", regex=False), errors="coerce")
    ok_area = df["area_m2"].between(20, 1000)
    report["dropped_bad_area"] = int((~ok_area).sum())
    df = df[ok_area]
    ok_price = df["Price"].notna() & (df["Price"] > 0) & df["Address"].notna()
    report["dropped_missing_price_or_address"] = int((~ok_price).sum())
    df = df[ok_price].copy()

    df["price_toman"] = df["Price"].astype(float)
    df["ppm2"] = df["price_toman"] / df["area_m2"]
    lp = np.log(df["ppm2"])
    mad = np.median(np.abs(lp - lp.median())) * 1.4826
    ok_pp = ((lp - lp.median()).abs() / mad) <= 4
    report["dropped_ppm2_outliers"] = int((~ok_pp).sum())
    df = df[ok_pp].copy()

    df = df.rename(columns={"Room": "rooms", "Parking": "parking", "Warehouse": "storage",
                            "Elevator": "elevator", "Address": "address"})
    for c in ["parking", "storage", "elevator"]:
        df[c] = df[c].astype(bool).astype(int)
    df["rooms"] = df["rooms"].astype(int)
    df = df[["address", "area_m2", "rooms", "parking", "storage", "elevator", "price_toman", "ppm2"]]
    df = df.reset_index(drop=True)
    df.insert(0, "listing_id", [f"D21-{i + 1:05d}" for i in range(len(df))])
    report["clean_rows"] = int(len(df))
    return df, report


def link_locations(df: pd.DataFrame, hoods_2024: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Attach 2024 neighbourhood slug / coordinates / district, or satellite-city slug."""
    ov = pd.read_csv(GEO / "listing_name_overrides_2021.csv")
    ov_map = {r.address: (r.target_type, r.target) for r in ov.itertuples()}
    slug_by_key = {norm(s): s for s in hoods_2024["slug"]}
    geo = hoods_2024.set_index("slug")

    rows = []
    for addr in df["address"].unique():
        kind, target = ov_map.get(addr, (None, None))
        if kind is None and norm(addr) in slug_by_key:
            kind, target = "neighborhood", slug_by_key[norm(addr)]
            how = "name_match"
        else:
            how = "author_assigned" if kind else "unlinked"
        rec = {"address": addr, "link": how, "slug_2024": None, "city_slug": None,
               "lat": np.nan, "lon": np.nan, "district": np.nan}
        if kind == "neighborhood":
            rec["slug_2024"] = target
            rec["lat"], rec["lon"] = geo.at[target, "lat"], geo.at[target, "lon"]
            rec["district"] = geo.at[target, "district"]
        elif kind == "district":
            rec["district"] = float(target)
        elif kind == "city":
            rec["city_slug"] = target
        rows.append(rec)
    link = pd.DataFrame(rows)
    out = df.merge(link, on="address", how="left")
    out["location_type"] = np.select(
        [out["district"].notna(), out["city_slug"].notna()],
        ["tehran_district", "satellite_town"], default="unlocated")
    rep = out["location_type"].value_counts().to_dict()
    rep["addresses"] = int(link.shape[0])
    rep["addresses_linked"] = int((link.link != "unlinked").sum())
    return out, {k: int(v) for k, v in rep.items()}


def locate_2024(hoods: pd.DataFrame) -> pd.DataFrame:
    loc = DistrictLocator()
    res = [loc.locate(a, b) for a, b in zip(hoods["lat"], hoods["lon"])]
    hoods = hoods.copy()
    hoods["district"] = [r[0] for r in res]
    hoods["location_check"] = [r[1] for r in res]
    return hoods
