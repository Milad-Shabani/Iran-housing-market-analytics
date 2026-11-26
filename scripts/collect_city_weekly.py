"""Collect a fixed, geographically spread panel of Divar apartment-sale map viewports.

The pinned panel keeps the surveyed neighbourhoods and rectangles comparable over time.
Each neighbourhood contributes up to 200 map cards. City aggregates retain the actual collection date and the Saturday-based week.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import math
import os
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

import collect_divar as divar

from iran_housing.market import WEEKLY_CITIES as CITIES
CITY_URL = "https://api.divar.ir/v8/places/cities"
PANEL = divar.ROOT / "data" / "geo" / "divar_weekly_city_panel.csv"
OUT = divar.ROOT / "data" / "raw" / "divar_weekly" / "city_snapshots.csv"
PANEL_FIELDS = ["city", "city_id", "district_id", "slug", "min_lon", "min_lat", "max_lon", "max_lat"]
HEADER = ["city", "date", "week", "listings", "median_toman_m2", "p25_toman_m2", "p75_toman_m2",
          "neighbourhoods", "panel_id"]
BANDS, PER_BAND = 6, 8


def panel_size(city):
    return 36 if city == "lahijan" else BANDS * PER_BAND


def select_panel(raw, count=BANDS * PER_BAND):
    """Equal-count latitude bands, with one midpoint from each longitude stratum."""
    valid = []
    for r in raw:
        if len(r.get("bbox") or []) != 4:
            continue
        west, south, east, north = map(float, r["bbox"])
        if 42 <= west < east <= 65 and 24 <= south < north <= 41:
            valid.append((int(r["id"]), str(r["slug"]), west, south, east, north))
    if (len(valid) < count or len(valid) < .9 * len(raw)
            or len({r[0] for r in valid}) != len(valid)):
        raise divar.IncompleteCollection("inadequate city neighbourhood directory")
    valid.sort(key=lambda r: (r[3] + r[5], r[0]))
    chosen = []
    per_band = count // BANDS
    for i in range(BANDS):
        band = valid[i * len(valid) // BANDS:(i + 1) * len(valid) // BANDS]
        band.sort(key=lambda r: (r[2] + r[4], r[0]))
        chosen.extend(band[(2 * j + 1) * len(band) // (2 * per_band)] for j in range(per_band))
    return chosen


def save(path, fields, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    os.replace(tmp, path)


def build_panel(path):
    cities = divar._http(CITY_URL, None)["cities"]
    rows = []
    for slug, name in CITIES.items():
        city, = [c for c in cities if c["slug"] == slug and c["name"] == name]
        directory = divar._http(divar.CATALOG_URL.format(city_id=city["id"]), None)["districts"]
        for area in select_panel(directory, panel_size(slug)):
            rows.append(dict(zip(PANEL_FIELDS, [slug, city["id"], *area])))
    save(path, PANEL_FIELDS, rows)


def load_rows(path, fields):
    with path.open(encoding="utf-8", newline="") as source:
        reader = csv.DictReader(source)
        if reader.fieldnames != fields:
            raise ValueError(f"Unexpected columns in {path.name}")
        return list(reader)


def gather(districts, max_minutes, *, category="apartment-sell", parser=divar.parse_post):
    deadline = time.monotonic() + max_minutes * 60

    def fetch(area):
        if time.monotonic() >= deadline:
            raise divar.IncompleteCollection("panel time budget reached")
        bbox = tuple(float(area[k]) for k in PANEL_FIELDS[4:])
        response = divar.request_viewport(area["city_id"], category, bbox, divar.zoom_for(bbox),
                                          district_id=area["district_id"])
        posts, _ = divar.map_posts(response)
        if len(posts) > divar.PAGE_LIMIT:
            raise divar.IncompleteCollection("map card limit changed")
        parsed = [parser(p) for p in posts]
        if any(p is None for p in parsed):
            raise divar.IncompleteCollection("unrecognised map card")
        time.sleep(.5)
        return parsed

    seen = {}
    with ThreadPoolExecutor(max_workers=3) as pool:
        for rows in pool.map(fetch, districts):
            for row in rows:
                token = row["token"]
                if token not in seen:
                    seen[token] = row
                else:
                    for field, value in row.items():
                        if seen[token].get(field) is None and value is not None:
                            seen[token][field] = value
    return list(seen.values())


def panel_signature(city, districts, previous):
    if (len(districts) != panel_size(city) or len({r["district_id"] for r in districts}) != len(districts)
            or len({r["city_id"] for r in districts}) != 1):
        raise divar.IncompleteCollection("incomplete or duplicate panel areas")
    signature = "\n".join(sorted(",".join(str(r[k]) for k in PANEL_FIELDS) for r in districts))
    panel_id = hashlib.sha256(signature.encode()).hexdigest()[:16]
    if previous and previous["panel_id"] != panel_id:
        raise divar.IncompleteCollection("panel differs from the accepted series")
    return panel_id


def summarize(city, day, rows, districts, previous):
    panel_id = panel_signature(city, districts, previous)
    size = pd.Series([r.get("size_m2") for r in rows], dtype="float64")
    ppm = pd.Series([r.get("price_per_m2_toman") for r in rows], dtype="float64")
    valid = ppm[size.between(20, 1000) & ppm.between(5e6, 2e9)]
    floor = max(100, .5 * int(previous["listings"]) if previous else 0)
    if len(valid) < floor:
        raise divar.IncompleteCollection(f"{len(valid)} usable listings, need at least {math.ceil(floor)}")
    week = day - timedelta(days=(day.weekday() + 2) % 7)
    return dict(zip(HEADER, (city, day.isoformat(), week.isoformat(), len(valid),
                             round(valid.median()), round(valid.quantile(.25)), round(valid.quantile(.75)),
                             len(districts), panel_id)))


def refresh(cities, out, max_minutes=10, *, panel=PANEL, collect=gather, day=None):
    day = datetime.now(ZoneInfo("Asia/Tehran")).date() if day is None else day
    history = load_rows(out, HEADER) if out.exists() else []
    if len({(r["city"], r["date"]) for r in history}) != len(history):
        raise ValueError("duplicate city/day in input history")
    panels = defaultdict(list)
    for area in load_rows(panel, PANEL_FIELDS):
        panels[area["city"]].append(area)
    success = 0
    for city in cities:
        try:
            previous = max((r for r in history if r["city"] == city), key=lambda r: r["date"], default=None)
            if previous and previous["date"] > day.isoformat():
                raise divar.IncompleteCollection("a newer observation exists")
            areas = panels[city]
            accepted = summarize(city, day, collect(areas, max_minutes), areas, previous)
        except (RuntimeError, KeyError, TypeError, ValueError) as exc:
            print(f"REJECTED {city}: {exc}", flush=True)
            continue
        history = [r for r in history if (r["city"], r["date"]) != (city, accepted["date"])] + [accepted]
        save(out, HEADER, sorted(history, key=lambda r: (r["date"], r["city"])))
        success += 1
        print(f"ACCEPTED {city}: {accepted['listings']:,} usable listings across {len(areas)} surveyed areas", flush=True)
    return 0 if success else 1


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--cities", nargs="+", choices=CITIES, default=list(CITIES))
    p.add_argument("--out", type=Path, default=OUT)
    p.add_argument("--max-minutes", type=float, default=10)
    p.add_argument("--build-panel", type=Path, metavar="OUTPUT_CSV",
                   help="write a candidate panel from the current Divar directory for review")
    args = p.parse_args()
    if args.build_panel:
        build_panel(args.build_panel)
        return 0
    return refresh(list(dict.fromkeys(args.cities)), args.out, args.max_minutes)


if __name__ == "__main__":
    raise SystemExit(main())
