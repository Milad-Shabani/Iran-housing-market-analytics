"""Collect current Divar apartment-for-sale listings and turn them into 1405 aggregates.

divar.ir must be reachable from where you run this (it is from inside Iran). Two steps:

    python scripts/collect_divar.py collect            # ~5-10 min for Tehran, polite pace
    python scripts/collect_divar.py aggregate          # raw ads -> data/raw/divar_1405/*.csv
    python scripts/run_pipeline.py && python scripts/build_dashboard.py

`collect` writes individual ads to data/local/ (git-ignored: raw ads are not republished).
`aggregate` writes only neighbourhood and district medians to data/raw/divar_1405/, which the
pipeline picks up automatically and the dashboard shows as a 1405 layer next to 1403.

How it works: Divar's web map endpoint (POST /v8/mapview/viewport) returns up to 200 ads per
map rectangle with size, rooms, building age, parking/elevator icons, coordinates and a rounded
price. The city is tiled into rectangles and any rectangle holding more than 200 ads is split in
four until every ad is returned. Endpoint and response shape are documented publicly at
github.com/alighaffari3000/divar-scraper (docs/DIVAR_API.md, tested 1405/06/24).

Please keep the pace polite (the default waits 0.3 s between requests) and respect Divar's terms.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

MAP_URL = "https://api.divar.ir/v8/mapview/viewport"
PAGE_LIMIT = 200
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/124.0 Safari/537.36",
    "Content-Type": "application/json",
    "Origin": "https://divar.ir",
    "Referer": "https://divar.ir/",
}
CITIES = {  # Divar city id and a bounding box (min_lon, min_lat, max_lon, max_lat)
    "tehran": ("1", (51.08, 35.55, 51.62, 35.84)),
}
LOCAL = ROOT / "data" / "local"
OUT = ROOT / "data" / "raw" / "divar_1405"

_FA = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
_UNITS = {"میلیارد": 1e9, "میلیون": 1e6, "هزار": 1e3}


# --------------------------------------------------------------------------- parsing
def parse_amount(text: str | None) -> float | None:
    """'۱۲٫۵ میلیارد' -> 12.5e9 ; '۸۵۰ میلیون تومان' -> 850e6 ; 'توافقی' -> None."""
    if not text:
        return None
    t = str(text).translate(_FA).replace("٫", ".").replace("٬", "").replace(",", "")
    m = re.search(r"(\d+(?:\.\d+)?)", t)
    if not m:
        return None
    value = float(m.group(1))
    for word, mult in _UNITS.items():
        if word in t:
            return value * mult
    return value if value > 1e5 else None  # a bare small number is not a toman amount


def parse_chips(chips) -> dict:
    out = {"size_m2": None, "rooms": None, "age_years": None, "parking": 0, "elevator": 0}
    for chip in chips or []:
        title = (chip.get("title") or "").strip()
        if title:
            num = re.sub(r"\D", "", title.translate(_FA))
            if "متر" in title and num:
                out["size_m2"] = float(num)
            elif "اتاق" in title:
                out["rooms"] = float(num) if num else 0.0
            elif "نوساز" in title:
                out["age_years"] = 0.0
            elif "سال" in title and num:
                out["age_years"] = float(num)
            continue
        icon = json.dumps(chip)
        if "parking" in icon:
            out["parking"] = 1
        if "elevator" in icon:
            out["elevator"] = 1
    return out


def parse_post(post: dict) -> dict | None:
    card = post.get("map_post_card") or {}
    pin = post.get("map_pin_feature") or {}
    token = card.get("token")
    if not token:
        return None
    total = per_m2 = None
    raw_prices = []
    for f in card.get("price_fields") or []:
        title = (f.get("title") or "").strip(" :")
        value = f.get("value")
        raw_prices.append(f"{title}={value}")
        amount = parse_amount(value)
        if amount is None:
            continue
        if "متر" in title:
            per_m2 = amount
        elif "قیمت" in title or not title:
            total = amount
    row = {"token": token, "lat": pin.get("lat"), "lon": pin.get("lon"),
           "approximate_location": int(bool(pin.get("approximate_location"))),
           "price_toman": total, "price_per_m2_toman": per_m2, "price_text": " | ".join(raw_prices)}
    row.update(parse_chips(card.get("chips")))
    if row["price_per_m2_toman"] is None and total and row["size_m2"]:
        row["price_per_m2_toman"] = total / row["size_m2"]
    return row


# --------------------------------------------------------------------------- network
def request_viewport(city_id: str, category: str, bbox, zoom: int, attempts: int = 4) -> dict:
    min_lon, min_lat, max_lon, max_lat = bbox
    body = {
        "city_ids": [city_id],
        "search_data": {"form_data": {"data": {"category": {"str": {"value": category}}}}},
        "camera_info": {"bbox": {"minLongitude": min_lon, "minLatitude": min_lat,
                                 "maxLongitude": max_lon, "maxLatitude": max_lat}, "zoom": zoom},
    }
    data = json.dumps(body).encode("utf-8")
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(MAP_URL, data=data, headers=HEADERS, method="POST")
            with urllib.request.urlopen(req, timeout=30) as r:  # noqa: S310 - fixed Divar URL
                return json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            if attempt == attempts - 1:
                raise RuntimeError(f"Divar request failed for {bbox}: {exc}") from exc
            time.sleep(2 ** attempt * 2)
    return {}


def zoom_for(bbox) -> int:
    width = max(bbox[2] - bbox[0], 1e-6)
    return int(min(17, max(14, round(math.log2(360 / width)))))


def collect(city: str, category: str, delay: float, max_requests: int, probe: bool) -> Path:
    city_id, bbox = CITIES[city]
    # start from a 6 x 6 grid so the first rectangles are already at map zoom >= 14
    step_x, step_y = (bbox[2] - bbox[0]) / 6, (bbox[3] - bbox[1]) / 6
    queue = [(bbox[0] + i * step_x, bbox[1] + j * step_y, bbox[0] + (i + 1) * step_x, bbox[1] + (j + 1) * step_y)
             for i in range(6) for j in range(6)]
    found: dict[str, dict] = {}
    requests_made = 0
    LOCAL.mkdir(parents=True, exist_ok=True)
    while queue and requests_made < max_requests:
        box = queue.pop()
        payload = request_viewport(city_id, category, box, zoom_for(box))
        requests_made += 1
        if probe and requests_made == 1:
            p = LOCAL / "divar_probe_response.json"
            p.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"probe: first raw response saved to {p}")
        posts = payload.get("posts") or []
        count = int(payload.get("count") or 0)
        for post in posts:
            row = parse_post(post)
            if row:
                found.setdefault(row["token"], row)
        if count > len(posts) and len(posts) >= PAGE_LIMIT and (box[2] - box[0]) > 0.0005:
            mx, my = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
            queue += [(box[0], box[1], mx, my), (mx, box[1], box[2], my),
                      (box[0], my, mx, box[3]), (mx, my, box[2], box[3])]
        if requests_made % 25 == 0:
            print(f"{requests_made} requests, {len(found):,} ads, {len(queue)} rectangles left")
        time.sleep(delay)
    complete = not queue
    today = date.today().isoformat()
    path = LOCAL / f"divar_{city}_{category}_{today}.csv"
    cols = ["token", "lat", "lon", "approximate_location", "price_toman", "price_per_m2_toman", "size_m2",
            "rooms", "age_years", "parking", "elevator", "price_text"]
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols + ["collected_on"])
        w.writeheader()
        for row in found.values():
            w.writerow({**{c: row.get(c) for c in cols}, "collected_on": today})
    print(f"{'complete' if complete else 'INCOMPLETE (request cap reached)'}: {len(found):,} ads "
          f"in {requests_made} requests -> {path}")
    return path


# --------------------------------------------------------------------------- aggregation
def aggregate(raw_path: Path, out_dir: Path | None = None) -> None:
    import numpy as np
    import pandas as pd

    from iran_housing.geo import DistrictLocator
    from iran_housing.market import load_neighborhoods_2024

    ads = pd.read_csv(raw_path)
    n0 = len(ads)
    ads = ads.dropna(subset=["lat", "lon", "price_per_m2_toman", "size_m2"])
    ads = ads[ads.size_m2.between(20, 1000) & ads.price_per_m2_toman.between(5e6, 2e9)]
    lp = np.log(ads.price_per_m2_toman)
    mad = np.median(np.abs(lp - lp.median())) * 1.4826
    ads = ads[((lp - lp.median()).abs() / mad) <= 4]
    loc = DistrictLocator()
    ads["district"] = [loc.locate(a, b)[0] for a, b in zip(ads.lat, ads.lon)]
    ads = ads[ads.district.notna()]

    # nearest 1403 neighbourhood centroid in the same district (within 1.5 km)
    hoods = load_neighborhoods_2024().dropna(subset=["lat", "lon", "district"])
    kx = math.cos(math.radians(35.7))
    slugs = []
    for d, lat, lon in zip(ads.district, ads.lat, ads.lon):
        h = hoods[hoods.district == d]
        dist = np.hypot((h.lon - lon) * kx, h.lat - lat) * 111
        slugs.append(h.slug.iat[int(np.argmin(dist))] if len(h) and dist.min() <= 1.5 else None)
    ads["slug"] = slugs

    def summarise(g):
        return pd.Series({"listings": len(g), "ppm2": g.price_per_m2_toman.median(),
                          "ppm2_p25": g.price_per_m2_toman.quantile(.25),
                          "ppm2_p75": g.price_per_m2_toman.quantile(.75),
                          "size_median": g.size_m2.median(), "price_median": g.price_toman.median(),
                          "parking_share": g.parking.mean(), "elevator_share": g.elevator.mean()})

    out = Path(out_dir) if out_dir else OUT
    out.mkdir(parents=True, exist_ok=True)
    collected = str(ads.collected_on.iloc[0]) if "collected_on" in ads and len(ads) else ""
    dtab = ads.groupby("district").apply(summarise, include_groups=False).reset_index()
    dtab["district"] = dtab.district.astype(int)
    htab = ads.dropna(subset=["slug"]).groupby("slug").apply(summarise, include_groups=False).reset_index()
    for t in (dtab, htab):
        t["collected_on"] = collected
    dtab.to_csv(out / "tehran_districts_1405.csv", index=False)
    htab[htab.listings >= 10].to_csv(out / "tehran_neighbourhoods_1405.csv", index=False)
    meta = {"source": "Divar web map endpoint, apartment-sell, collected with scripts/collect_divar.py",
            "collected_on": collected, "raw_ads": n0, "ads_used": int(len(ads)),
            "tehran_median_ppm2": float(ads.price_per_m2_toman.median()),
            "note": "Asking prices; map-card prices are rounded by Divar (about ±1%)."}
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(meta, ensure_ascii=False, indent=2))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("collect")
    c.add_argument("--city", default="tehran", choices=sorted(CITIES))
    c.add_argument("--category", default="apartment-sell")
    c.add_argument("--delay", type=float, default=0.3)
    c.add_argument("--max-requests", type=int, default=5000)
    c.add_argument("--probe", action="store_true", help="save the first raw response for inspection")
    a = sub.add_parser("aggregate")
    a.add_argument("raw", nargs="?", help="raw CSV from `collect` (default: newest in data/local)")
    args = ap.parse_args()
    if args.cmd == "collect":
        collect(args.city, args.category, args.delay, args.max_requests, args.probe)
    else:
        raw = Path(args.raw) if args.raw else max(LOCAL.glob("divar_tehran_*.csv"), key=lambda p: p.stat().st_mtime)
        aggregate(raw)
    return 0


if __name__ == "__main__":
    sys.exit(main())
