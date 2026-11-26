"""Survey apartment-rent map cards once and validate rent and deposit independently."""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pandas as pd

import collect_city_weekly as weekly

OUT = weekly.OUT.with_name("rental_snapshots.csv")
FIELDS = ["market", "city", "date", "week", "listings", "median_toman", "p25_toman", "p75_toman",
          "neighbourhoods", "panel_id"]
CITIES = {"tehran": "تهران", **weekly.CITIES}
LABELS = {"اجاره": "rent", "ودیعه": "deposit"}


def rental_card(post):
    card = post.get("map_post_card") or {}
    if not card.get("token"):
        return None
    row = {"token": card["token"], "size_m2": weekly.divar.parse_chips(card.get("chips"))["size_m2"],
           "rent": None, "deposit": None}
    for field in card.get("price_fields") or []:
        label = (field.get("title") or "").strip(" :")
        value = field.get("value") or ""
        if label in LABELS and not any(word in value for word in ("توافق", "تبدیل", "الی", " تا ")):
            row[LABELS[label]] = weekly.divar.parse_amount(value)
    return row


def rental_panels():
    panels = defaultdict(list)
    for row in weekly.load_rows(weekly.PANEL, weekly.PANEL_FIELDS):
        panels[row["city"]].append(row)
    directory = [{"id": r.divar_id, "slug": r.slug, "bbox": [r.min_lon, r.min_lat, r.max_lon, r.max_lat]}
                 for r in pd.read_csv(weekly.divar.CATALOG).itertuples()]
    panels["tehran"] = [dict(zip(weekly.PANEL_FIELDS, ["tehran", "1", *row]))
                        for row in weekly.select_panel(directory)]
    return panels


def summarize(market, city, day, rows, areas, previous):
    panel_id = weekly.panel_signature(city, areas, previous)
    values = pd.Series([r[market] for r in rows if r.get(market) and r[market] > 0
                        and 20 <= (r["size_m2"] or 0) <= 1000], dtype="float64")
    floor = max(50, .5 * int(previous["listings"]) if previous else 0)
    if len(values) < floor:
        raise weekly.divar.IncompleteCollection(f"only {len(values)} usable {market} amounts")
    week = day - timedelta(days=(day.weekday() + 2) % 7)
    return dict(zip(FIELDS, (market, city, day.isoformat(), week.isoformat(), len(values),
                            round(values.median()), round(values.quantile(.25)), round(values.quantile(.75)),
                            len(areas), panel_id)))


def refresh(cities, out=OUT, day=None, collect=weekly.gather, minutes=8):
    day = day or datetime.now(ZoneInfo("Asia/Tehran")).date()
    panels = rental_panels()
    history = weekly.load_rows(out, FIELDS) if out.exists() else []
    if len({(r["market"], r["city"], r["date"]) for r in history}) != len(history):
        raise ValueError("duplicate market/city/day in rental history")
    successes = 0
    for city in cities:
        areas = panels[city]
        try:
            rows = collect(areas, minutes, category="apartment-rent", parser=rental_card)
        except (RuntimeError, ValueError, KeyError, TypeError) as exc:
            print(f"REJECTED {city}: {exc}", flush=True)
            continue
        for market in LABELS.values():
            try:
                series = [r for r in history if r["city"] == city and r["market"] == market]
                prev = max(series, key=lambda r: r["date"], default=None)
                if prev and prev["date"] > day.isoformat():
                    raise weekly.divar.IncompleteCollection("a newer observation exists")
                row = summarize(market, city, day, rows, areas, prev)
            except (RuntimeError, ValueError, KeyError, TypeError) as exc:
                print(f"REJECTED {city} {market}: {exc}", flush=True)
                continue
            history = [r for r in history if (r["market"], r["city"], r["date"]) != (market, city, row["date"])]
            history.append(row)
            weekly.save(out, FIELDS, sorted(history, key=lambda r: (r["date"], r["city"], r["market"])))
            print(f"ACCEPTED {city} {market}: {row['listings']} amounts in {len(areas)} areas", flush=True)
            successes += 1
    return 0 if successes else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--cities", nargs="+", choices=CITIES, default=list(CITIES))
    raise SystemExit(refresh(list(dict.fromkeys(ap.parse_args().cities))))
