"""Assemble the compact JSON the dashboard embeds (maps pre-projected to SVG paths)."""
from __future__ import annotations

import json
import math

import numpy as np
import pandas as pd

from . import geo
from .jalali import jalali_to_gregorian
from .paths import GEO, RAW
from .timeseries import METHOD_LABELS, index_to_jalali
from .valuation import premiums, to_browser

TEHRAN_W = 760
IRAN_W = 760


def _r(x, nd=0):
    if x is None:
        return None
    if isinstance(x, (float, np.floating)) and (math.isnan(x) or math.isinf(x)):
        return None
    if isinstance(x, (np.integer,)):
        return int(x)
    return round(float(x), nd) if nd else int(round(float(x)))


def pretty(slug: str) -> str:
    s = str(slug).replace("-industrial-city", "").replace("-city", "").replace("-", " ")
    return " ".join(w.capitalize() if w not in ("e", "o", "va", "al") else w for w in s.split())


def _names_fa() -> tuple[dict, dict]:
    h = pd.read_csv(GEO / "tehran_neighbourhood_names_fa.csv")
    c = pd.read_csv(GEO / "city_names_fa.csv")
    return dict(zip(h.slug, h.name_fa)), dict(zip(c.city_slug, c.name_fa))


def tehran_block(hoods: pd.DataFrame, districts: pd.DataFrame) -> dict:
    feats = geo.tehran_districts()
    bounds = geo.bounds_of(feats)
    proj = geo.Projection.fit(bounds, TEHRAN_W, pad=12)
    fa_h, _ = _names_fa()
    dtab = districts.set_index("district")
    out_d = []
    for f in feats:
        d = f["properties"]["district"]
        lx, ly = proj.xy(*geo.label_point(f["geometry"]))
        row = dtab.loc[d]
        out_d.append({
            "d": d, "path": geo.svg_path(f["geometry"], proj), "lx": round(lx, 1), "ly": round(ly, 1),
            "p": _r(row.ppm2), "q25": _r(row.ppm2_q25), "q75": _r(row.ppm2_q75), "n": _r(row.listings),
            "nh": _r(row.neighborhoods), "pm": _r(row.price_median), "sz": _r(row.size_median),
            "by": _r(row.build_year), "el": _r(row.elevator_share, 3), "pk": _r(row.parking_share, 3),
            "st": _r(row.storage_share, 3), "rb": _r(row.rebuilt_share, 3), "vs": _r(row.vs_tehran, 3),
            "rank": _r(row["rank"]), "top": row.top_slug, "low": row.cheapest_slug,
            "p21": _r(row.ppm2_2021), "n21": _r(row.listings_2021), "rel21": bool(row.reliable_2021 == True),  # noqa: E712
            "g": _r(row.growth_multiple, 3),
            "p5": _r(getattr(row, "ppm2_1405", np.nan)), "n5": _r(getattr(row, "listings_1405", np.nan)),
            "g5": _r(getattr(row, "growth_1405", np.nan), 3),
        })
    pts = []
    for r in hoods.itertuples():
        if r.district is None or (isinstance(r.district, float) and math.isnan(r.district)):
            continue
        x, y = proj.xy(r.lon, r.lat)
        pts.append({
            "s": r.slug, "fa": fa_h.get(r.slug), "en": pretty(r.slug), "x": round(x, 1), "y": round(y, 1),
            "d": int(r.district), "n": int(r.listings), "p": _r(r.ppm2), "p25": _r(r.ppm2_p25),
            "p75": _r(r.ppm2_p75), "lo": _r(r.ci95_low), "hi": _r(r.ci95_high), "pm": _r(r.price_median),
            "sz": _r(r.size_median), "r": _r(r.rooms_median), "by": _r(r.build_year),
            "el": _r(r.elevator_share, 2), "pk": _r(r.parking_share, 2), "st": _r(r.storage_share, 2),
            "rb": _r(r.rebuilt_share, 2), "q": r.quality,
            "p5": _r(getattr(r, "ppm2_1405", np.nan)), "n5": _r(getattr(r, "listings_1405", np.nan))})
    return {"w": TEHRAN_W, "h": proj.height(bounds), "districts": out_d, "hoods": pts,
            "median": _r(districts.attrs.get("tehran_median", np.nan)) if hasattr(districts, "attrs") else None}


def iran_block(provinces: pd.DataFrame, cities: pd.DataFrame) -> dict:
    feats = geo.iran_provinces()
    bounds = geo.bounds_of(feats)
    proj = geo.Projection.fit(bounds, IRAN_W, pad=8)
    _, fa_c = _names_fa()
    ptab = provinces.set_index("province_iso")
    out_p = []
    for f in feats:
        pr = f["properties"]
        lx, ly = proj.xy(*geo.label_point(f["geometry"]))
        row = ptab.loc[pr["iso"]] if pr["iso"] in ptab.index else None
        out_p.append({"iso": pr["iso"], "en": pr["name_en"], "fa": pr["name_fa"],
                      "path": geo.svg_path(f["geometry"], proj), "lx": round(lx, 1), "ly": round(ly, 1),
                      "p": _r(row.ppm2) if row is not None else None,
                      "n": _r(row.listings) if row is not None else None,
                      "c": _r(row.cities) if row is not None else None,
                      "pm": _r(row.price_median) if row is not None else None,
                      "sz": _r(row.size_median) if row is not None else None,
                      "big": row.largest_city if row is not None else None,
                      "bigp": _r(row.largest_city_ppm2) if row is not None else None,
                      "bigsh": _r(row.largest_city_share, 3) if row is not None else None,
                      "vs": _r(row.vs_national, 3) if row is not None else None,
                      "rank": _r(row["rank"]) if row is not None else None})
    cs = []
    for r in cities[(cities.match != "unassigned") & (cities.listings >= 30)].itertuples():
        x, y = proj.xy(r.lon, r.lat)
        name_fa = fa_c.get(r.city_slug) or (r.county_fa if r.match == "name_match" else None)
        cs.append({"s": r.city_slug, "en": pretty(r.city_slug), "fa": name_fa, "iso": r.province_iso,
                   "x": round(x, 1), "y": round(y, 1), "n": int(r.listings), "p": _r(r.ppm2),
                   "pm": _r(r.price_median), "sz": _r(r.size_median), "r": _r(r.rooms_median),
                   "exact": r.match == "name_match"})
    return {"w": IRAN_W, "h": proj.height(bounds), "provinces": out_p, "cities": cs,
            "median": _r(provinces.attrs.get("national_median", np.nan))}


def build_dashboard_data(*, hoods, districts, provinces, cities, satellites, series, leaderboard, bands,
                         official_paths, last_cbi, g_long, g_kilid, cv, model, interval, oof, report) -> dict:
    districts.attrs["tehran_median"] = report["tehran_median_ppm2_2024"]
    provinces.attrs["national_median"] = report["national_median_ppm2_2024"]
    months = []
    for r in series.itertuples():
        months.append({"t": int(r.t), "y": int(r.jalali_year), "m": int(r.jalali_month), "date": r.date,
                       "cbi": _r(r.cbi), "tx": _r(r.transactions), "kil": _r(r.kilid),
                       "q": r.cbi_quality if isinstance(r.cbi_quality, str) else None})
    last_kil = series[series.kilid.notna()].iloc[-1]
    fut = []
    for h in range(1, 25):
        jy, jm = index_to_jalali(int(last_kil.t) + h)
        fut.append({"h": h, "y": jy, "m": jm, "date": jalali_to_gregorian(jy, jm).isoformat()})
    fut_off = []
    for h in range(1, 25):
        jy, jm = index_to_jalali(last_cbi + h)
        fut_off.append({"h": h, "y": jy, "m": jm, "date": jalali_to_gregorian(jy, jm).isoformat()})

    starts = [jalali_to_gregorian(*index_to_jalali(t)) for t in range(0, 200)]

    def greg_to_t(ym: str) -> int:
        from datetime import date as _d
        mid = _d(int(ym[:4]), int(ym[5:7]), 15)
        return max(t for t, st in enumerate(starts) if st <= mid)

    mi = pd.read_csv(RAW / "divar_1m" / "major_cities_monthly_index.csv")
    major = [{"city": r.city_slug, "month": r.listing_month[:7], "t": greg_to_t(r.listing_month[:7]), "n": int(r.listings),
              "p": _r(r.median_price_per_sqm), "adj": _r(r.composition_adjusted_index_common_100, 1),
              "raw": _r(r.raw_price_index_common_100, 1)} for r in mi.itertuples()]

    rng = np.random.default_rng(3)
    idx = rng.choice(len(oof), size=min(700, len(oof)), replace=False)
    scatter = [[_r(oof.price_toman.iat[i] / 1e9, 3), _r(oof.pred_hedonic_ols.iat[i] / 1e9, 3)] for i in idx]

    am = pd.read_csv(RAW / "divar_1m" / "amenity_summary.csv")
    cp = pd.read_csv(RAW / "divar_1m" / "construction_period_summary.csv")
    ms = json.loads((RAW / "divar_1m" / "market_summary.json").read_text())

    lb = leaderboard.reset_index()
    return {
        "meta": {"built": report["built"], "tehran_median_2024": _r(report["tehran_median_ppm2_2024"]),
                 "tehran_median_2021": _r(report["tehran_median_ppm2_2021"]),
                 "national_median_2024": _r(report["national_median_ppm2_2024"]),
                 "listings_2024_total": ms["core_analysis_rows"], "cities_2024": ms["cities_in_core_sample"],
                 "tehran_listings_2024": report["listings_2024_total"],
                 "tehran_listings_located": report["listings_2024_in_districts"],
                 "listings_2021": report["cleaning_2021"]["clean_rows"],
                 "growth_corr": _r(report["growth_vs_2021_level_corr"], 3),
                 "month_min": ms["observed_listing_month_min"][:7], "month_max": ms["observed_listing_month_max"][:7],
                 "has_1405": bool(report.get("has_1405")),
                 "divar_1405": report.get("divar_1405") or None},
        "tehran": tehran_block(hoods, districts),
        "iran": iran_block(provinces, cities),
        "satellites": [{"s": r.city_slug, "en": pretty(r.city_slug), "fa": _names_fa()[1].get(r.city_slug),
                        "n21": int(r.listings_2021), "p21": _r(r.ppm2_2021), "n24": _r(r.listings_2024),
                        "p24": _r(r.ppm2_2024), "g": _r(r.growth_multiple, 3)} for r in satellites.itertuples()],
        "series": {"months": months, "last_cbi": last_cbi, "last_kilid": int(last_kil.t)},
        "major": major,
        "forecast": {
            "best": lb.method.iat[0],
            "labels": {k: {"en": v[0], "fa": v[1]} for k, v in METHOD_LABELS.items()},
            "leaderboard": [{"method": r.method, "h1": _r(r.mape_h1, 4), "h3": _r(r.mape_h3, 4),
                             "h6": _r(r.mape_h6, 4), "h12": _r(r.mape_h12, 4),
                             "h24": _r(getattr(r, "mape_h24", np.nan), 4), "avg": _r(r.mape_avg_1_12, 4),
                             "origins": _r(r.origins_h12)} for r in lb.itertuples()],
            "bands": [{"h": int(h), "q10": _r(b.q10, 4), "q25": _r(b.q25, 4), "q75": _r(b.q75, 4),
                       "q90": _r(b.q90, 4)} for h, b in bands.iterrows()],
            "official": {k: [_r(v) for v in arr] for k, arr in official_paths.items()},
            "official_months": fut_off, "live_months": fut,
            "g_long": g_long, "g_kilid": g_kilid, "kilid_last": _r(last_kil.kilid),
        },
        "valuation": {"cv": {k: {m: _r(v, 4) for m, v in d.items()} for k, d in cv.items()},
                      "coef": {k: _r(v, 4) for k, v in model["coef"].items()},
                      "ci": {k: [_r(a, 4), _r(b, 4)] for k, (a, b) in model["coef_ci90"].items()},
                      "premiums": {k: _r(v, 4) for k, v in premiums(model).items()},
                      "browser": {k: (_r(v, 4) if not isinstance(v, dict) else {a: _r(b, 4) for a, b in v.items()})
                                  for k, v in to_browser(model, interval).items()},
                      "importance": {k: _r(v, 4) for k, v in model["gb_permutation_importance"].items()},
                      "n": model["n"], "scatter": scatter},
        "amenities": am.to_dict(orient="records"),
        "construction": cp.to_dict(orient="records"),
    }
