"""Cross-sectional market tables: Tehran neighbourhoods and districts, Iran cities and provinces.

All prices are asking prices from Divar listings, in toman per square metre.
District and province figures are *listing-weighted medians of neighbourhood (or
city) medians*: the upstream release publishes medians per neighbourhood/city, not
raw ads, so this is the closest statistic to a district median the data supports.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .listings import locate_2024
from .paths import GEO, RAW

OUTLIER_RATIO = 0.45   # neighbourhood median below 45% of its district's median -> flagged
MIN_LISTINGS = 30      # below this a neighbourhood median is shown but marked thin


def wquantile(values, weights, q: float) -> float:
    v = np.asarray(values, float)
    w = np.asarray(weights, float)
    m = ~np.isnan(v) & ~np.isnan(w) & (w > 0)
    v, w = v[m], w[m]
    if v.size == 0:
        return float("nan")
    order = np.argsort(v)
    v, w = v[order], w[order]
    cw = np.cumsum(w) - 0.5 * w
    return float(np.interp(q * w.sum(), cw, v))


def wmean(values, weights) -> float:
    v = np.asarray(values, float)
    w = np.asarray(weights, float)
    m = ~np.isnan(v) & (w > 0)
    return float(np.average(v[m], weights=w[m])) if m.any() else float("nan")


def load_neighborhoods_2024() -> pd.DataFrame:
    n = pd.read_csv(RAW / "divar_1m" / "tehran_neighborhood_summary.csv")
    u = pd.read_csv(RAW / "divar_1m" / "tehran_neighborhood_uncertainty.csv")
    n = n.rename(columns={
        "neighborhood_slug": "slug", "median_asking_price": "price_median",
        "median_price_per_sqm": "ppm2", "p25_price_per_sqm": "ppm2_p25", "p75_price_per_sqm": "ppm2_p75",
        "median_building_size_sqm": "size_median", "median_rooms": "rooms_median",
        "median_construction_year_jalali": "build_year", "median_latitude": "lat",
        "median_longitude": "lon", "warehouse_share": "storage_share",
        "stabilized_price_per_sqm": "ppm2_stabilized"})
    n = n.merge(u[["neighborhood_slug", "ci95_low", "ci95_high"]].rename(columns={"neighborhood_slug": "slug"}),
                on="slug", how="left")
    n = locate_2024(n)
    keep = ["slug", "listings", "price_median", "ppm2", "ppm2_p25", "ppm2_p75", "ppm2_stabilized",
            "ci95_low", "ci95_high", "size_median", "rooms_median", "build_year", "elevator_share",
            "parking_share", "storage_share", "rebuilt_share", "balcony_share", "lat", "lon",
            "district", "location_check"]
    n = n[keep].copy()

    inside = n["district"].notna()
    dmed = (n[inside].groupby("district")
            .apply(lambda g: wquantile(g.ppm2, g.listings, 0.5), include_groups=False))
    ratio = n["ppm2"] / n["district"].map(dmed)
    n["quality"] = np.select(
        [~inside, (n.listings >= MIN_LISTINGS) & (ratio < OUTLIER_RATIO), n.listings < MIN_LISTINGS],
        ["outside_districts", "outlier_vs_district", "thin_sample"], default="ok")
    return n.sort_values("listings", ascending=False).reset_index(drop=True)


def district_table_2024(n: pd.DataFrame) -> pd.DataFrame:
    use = n[n.quality.isin(["ok", "thin_sample"])]
    tehran_med = wquantile(use.ppm2, use.listings, 0.5)
    rows = []
    for d, g in use.groupby("district"):
        big = g[g.listings >= MIN_LISTINGS]
        rows.append({
            "district": int(d), "neighborhoods": int(len(g)), "listings": int(g.listings.sum()),
            "ppm2": wquantile(g.ppm2, g.listings, 0.5),
            "ppm2_q25": wquantile(g.ppm2, g.listings, 0.25),
            "ppm2_q75": wquantile(g.ppm2, g.listings, 0.75),
            "price_median": wquantile(g.price_median, g.listings, 0.5),
            "size_median": wquantile(g.size_median, g.listings, 0.5),
            "build_year": wquantile(g.build_year, g.listings, 0.5),
            "elevator_share": wmean(g.elevator_share, g.listings),
            "parking_share": wmean(g.parking_share, g.listings),
            "storage_share": wmean(g.storage_share, g.listings),
            "rebuilt_share": wmean(g.rebuilt_share, g.listings),
            "top_slug": big.loc[big.ppm2.idxmax(), "slug"] if len(big) else None,
            "cheapest_slug": big.loc[big.ppm2.idxmin(), "slug"] if len(big) else None,
        })
    t = pd.DataFrame(rows).sort_values("district").reset_index(drop=True)
    t["vs_tehran"] = t.ppm2 / tehran_med - 1
    t["rank"] = t.ppm2.rank(ascending=False).astype(int)
    t.attrs["tehran_median"] = tehran_med
    return t


def district_table_2021(listings: pd.DataFrame, min_n: int = 15) -> pd.DataFrame:
    d = listings[listings.location_type == "tehran_district"]
    t = (d.groupby("district")
         .agg(listings_2021=("ppm2", "size"), ppm2_2021=("ppm2", "median"),
              area_2021=("area_m2", "median"))
         .reset_index())
    t["district"] = t.district.astype(int)
    t["reliable_2021"] = t.listings_2021 >= min_n
    return t


def load_cities_2024() -> pd.DataFrame:
    c = pd.read_csv(RAW / "divar_1m" / "city_summary.csv")
    lk = pd.read_csv(GEO / "iran_city_lookup.csv")
    c = c.merge(lk.drop(columns="listings"), on="city_slug", how="left")
    return c.rename(columns={"median_asking_price": "price_median", "median_price_per_sqm": "ppm2",
                             "mean_price_per_sqm": "ppm2_mean", "median_building_size_sqm": "size_median",
                             "median_rooms": "rooms_median"})


def province_table(cities: pd.DataFrame, min_city_listings: int = 30) -> pd.DataFrame:
    use = cities[(cities.match != "unassigned") & (cities.listings >= min_city_listings)]
    rows = []
    for iso, g in use.groupby("province_iso"):
        g = g.sort_values("listings", ascending=False)
        rows.append({"province_iso": iso, "cities": int(len(g)), "listings": int(g.listings.sum()),
                     "ppm2": wquantile(g.ppm2, g.listings, 0.5),
                     "ppm2_min_city": float(g.ppm2.min()), "ppm2_max_city": float(g.ppm2.max()),
                     "size_median": wquantile(g.size_median, g.listings, 0.5),
                     "price_median": wquantile(g.price_median, g.listings, 0.5),
                     "largest_city": g.city_slug.iat[0], "largest_city_ppm2": float(g.ppm2.iat[0]),
                     "largest_city_share": float(g.listings.iat[0] / g.listings.sum())})
    t = pd.DataFrame(rows)
    national = wquantile(use.ppm2, use.listings, 0.5)
    t["vs_national"] = t.ppm2 / national - 1
    t["rank"] = t.ppm2.rank(ascending=False).astype(int)
    t.attrs["national_median"] = national
    return t.sort_values("ppm2", ascending=False).reset_index(drop=True)


def satellite_growth(listings: pd.DataFrame, cities: pd.DataFrame, min_n: int = 10) -> pd.DataFrame:
    s = listings[listings.location_type == "satellite_town"]
    t = (s.groupby("city_slug").agg(listings_2021=("ppm2", "size"), ppm2_2021=("ppm2", "median"))
         .reset_index())
    t = t.merge(cities[["city_slug", "listings", "ppm2"]], on="city_slug", how="left")
    t = t[t.listings_2021 >= min_n].rename(columns={"listings": "listings_2024", "ppm2": "ppm2_2024"})
    t["growth_multiple"] = t.ppm2_2024 / t.ppm2_2021
    return t.sort_values("growth_multiple", ascending=False).reset_index(drop=True)
