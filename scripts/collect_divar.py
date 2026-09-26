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
price. The collector walks Divar's own neighbourhood catalog (data/geo/divar_tehran_neighbourhoods.csv,
453 neighbourhoods; refresh it with `python scripts/collect_divar.py catalog`), asks for each
neighbourhood's ads with Divar's `districts` filter, and splits any rectangle that holds more than
200 ads until every ad is returned. Each ad is therefore tagged with the neighbourhood Divar itself
gives it. Endpoint and response shape are documented publicly at
github.com/alighaffari3000/divar-scraper (docs/DIVAR_API.md, tested 1405/06/24).

Every `aggregate` run also appends one row per district (and one for all of Tehran) to
data/raw/divar_1405/snapshots.csv, so repeated runs build a time series; the scheduled workflow
.github/workflows/refresh-data.yml does this automatically.

Please keep the pace polite (the default waits 0.3 s between requests) and respect Divar's terms.
"""
from __future__ import annotations

import argparse
import csv
import http.client
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
CATALOG_URL = "https://api.divar.ir/v8/places/cities/{city_id}/districts"
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
CATALOG = ROOT / "data" / "geo" / "divar_tehran_neighbourhoods.csv"

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
def _http(url: str, body: dict | None, attempts: int = 4) -> dict:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, data=data, headers=HEADERS, method="POST" if data else "GET")
            with urllib.request.urlopen(req, timeout=20) as r:  # noqa: S310 - fixed Divar URLs
                return json.loads(r.read().decode("utf-8"))
        except (OSError, http.client.HTTPException, json.JSONDecodeError) as exc:   # incl. dropped connections
            if attempt == attempts - 1:
                raise RuntimeError(f"Divar request failed ({url}): {exc}") from exc
            time.sleep(2 ** attempt * 2)
    return {}


def refresh_catalog(city_id: str = "1") -> None:
    """Re-download Divar's neighbourhood catalog (ids, Persian names, slugs, centroids, bboxes)."""
    import pandas as pd
    payload = _http(CATALOG_URL.format(city_id=city_id), None)
    items = payload.get("districts", payload if isinstance(payload, list) else [])
    rows = [{"divar_id": x["id"], "slug": x["slug"], "name_fa": x["name"],
             "lat": round(x["centroid"]["latitude"], 5), "lon": round(x["centroid"]["longitude"], 5),
             "min_lon": x["bbox"][0], "min_lat": x["bbox"][1], "max_lon": x["bbox"][2], "max_lat": x["bbox"][3]}
            for x in items if x.get("bbox")]
    pd.DataFrame(rows).to_csv(CATALOG, index=False)
    print(f"catalog: {len(rows)} neighbourhoods -> {CATALOG}")


def request_viewport(city_id: str, category: str, bbox, zoom: int, attempts: int = 4,
                     district_id: str | None = None) -> dict:
    min_lon, min_lat, max_lon, max_lat = bbox
    form = {"category": {"str": {"value": category}}}
    if district_id:
        form["districts"] = {"repeated_string": {"value": [str(district_id)]}}
    body = {
        "city_ids": [city_id],
        "search_data": {"form_data": {"data": form}},
        "camera_info": {"bbox": {"minLongitude": min_lon, "minLatitude": min_lat,
                                 "maxLongitude": max_lon, "maxLatitude": max_lat}, "zoom": zoom},
    }
    return _http(MAP_URL, body, attempts)


def zoom_for(bbox) -> int:
    width = max(bbox[2] - bbox[0], 1e-6)
    return int(min(17, max(14, round(math.log2(360 / width)))))


def _split(box):
    mx, my = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    return [(box[0], box[1], mx, my), (mx, box[1], box[2], my), (box[0], my, mx, box[3]), (mx, my, box[2], box[3])]


def crawl_neighbourhood(city_id: str, category: str, nb, delay: float, budget: list) -> tuple[list[dict], int]:
    """All ads Divar tags with one neighbourhood; splits rectangles holding more than 200."""
    pad_x, pad_y = (nb.max_lon - nb.min_lon) * 0.15, (nb.max_lat - nb.min_lat) * 0.15
    queue = [(nb.min_lon - pad_x, nb.min_lat - pad_y, nb.max_lon + pad_x, nb.max_lat + pad_y)]
    rows, made = [], 0
    while queue and budget[0] > 0:
        box = queue.pop()
        budget[0] -= 1
        try:
            payload = request_viewport(city_id, category, box, zoom_for(box), district_id=str(nb.divar_id))
        except RuntimeError as exc:   # one bad rectangle must not sink the whole collection
            print(f"skipped a rectangle in {nb.slug}: {exc}", flush=True)
            continue
        made += 1
        posts = payload.get("posts") or []
        for post in posts:
            row = parse_post(post)
            if row:
                row["slug"] = nb.slug
                rows.append(row)
        if int(payload.get("count") or 0) > len(posts) and len(posts) >= PAGE_LIMIT and (box[2] - box[0]) > 0.0005:
            queue += _split(box)
        time.sleep(delay)
    return rows, made


def collect(city: str, category: str, delay: float, max_requests: int, probe: bool,
            max_minutes: float = 45.0, workers: int = 3) -> Path:
    """Walk Divar's neighbourhood catalog; each ad keeps the neighbourhood Divar assigns it.

    Neighbourhoods are fetched by a few parallel workers (Divar's map endpoint tolerates about
    5 requests a second; 3 workers stay well below that). Rows are written as each neighbourhood
    finishes and the walk stops cleanly after `max_minutes`, so a slow connection yields
    partial data instead of nothing.
    """
    from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

    import pandas as pd
    city_id, _ = CITIES[city]
    catalog = pd.read_csv(CATALOG)
    LOCAL.mkdir(parents=True, exist_ok=True)
    if probe:
        nb = catalog.iloc[0]
        box = (nb.min_lon, nb.min_lat, nb.max_lon, nb.max_lat)
        payload = request_viewport(city_id, category, box, zoom_for(box), district_id=str(nb.divar_id))
        (LOCAL / "divar_probe_response.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1),
                                                         encoding="utf-8")
        print("probe: first raw response saved to data/local/divar_probe_response.json", flush=True)
    today = date.today().isoformat()
    path = LOCAL / f"divar_{city}_{category}_{today}.csv"
    cols = ["token", "slug", "lat", "lon", "approximate_location", "price_toman", "price_per_m2_toman", "size_m2",
            "rooms", "age_years", "parking", "elevator", "price_text"]
    seen: set[str] = set()
    budget = [max_requests]
    made = done = 0
    started = time.monotonic()
    stopped = None
    pending = list(catalog.itertuples())
    with path.open("w", newline="", encoding="utf-8") as fh, ThreadPoolExecutor(max_workers=workers) as pool:
        writer = csv.DictWriter(fh, fieldnames=cols + ["collected_on"])
        writer.writeheader()
        running = set()
        while pending or running:
            over_time = (time.monotonic() - started) / 60 > max_minutes
            if over_time and not stopped:
                stopped = f"time budget of {max_minutes:.0f} min reached"
            while pending and len(running) < workers and not stopped and budget[0] > 0:
                running.add(pool.submit(crawl_neighbourhood, city_id, category, pending.pop(0), delay, budget))
            if not running:
                break
            finished, running = wait(running, return_when=FIRST_COMPLETED)
            for fut in finished:
                rows, n = fut.result()
                made += n
                done += 1
                for row in rows:
                    if row["token"] not in seen:
                        seen.add(row["token"])
                        writer.writerow({**{c: row.get(c) for c in cols}, "collected_on": today})
                fh.flush()
                if done == 1 or done % 25 == 0:
                    mins = (time.monotonic() - started) / 60
                    print(f"{done}/{len(catalog)} neighbourhoods, {made} requests, {len(seen):,} ads, {mins:.1f} min",
                          flush=True)
        if budget[0] <= 0 and not stopped:
            stopped = "request cap reached"
    print(f"{'INCOMPLETE: ' + stopped if stopped else 'complete'}: {len(seen):,} ads from {done} neighbourhoods "
          f"in {made} requests -> {path}", flush=True)
    return path


# --------------------------------------------------------------------------- aggregation
def aggregate(raw_path: Path, out_dir: Path | None = None) -> None:
    import numpy as np
    import pandas as pd

    from iran_housing.jalali import gregorian_to_jalali
    ads = pd.read_csv(raw_path)
    n0 = len(ads)
    ads = ads.dropna(subset=["lat", "lon", "price_per_m2_toman", "size_m2"])
    ads = ads[ads.size_m2.between(20, 1000) & ads.price_per_m2_toman.between(5e6, 2e9)]
    lp = np.log(ads.price_per_m2_toman)
    mad = np.median(np.abs(lp - lp.median())) * 1.4826
    ads = ads[((lp - lp.median()).abs() / mad) <= 4]
    # districts: vectorised point-in-polygon against the 22 municipal districts
    import shapely
    from shapely.geometry import shape

    from iran_housing.geo import tehran_districts
    ads = ads.reset_index(drop=True)
    district = np.full(len(ads), np.nan)
    for f in tehran_districts():
        inside = shapely.contains_xy(shape(f["geometry"]), ads.lon.to_numpy(), ads.lat.to_numpy())
        district[inside & np.isnan(district)] = f["properties"]["district"]
    ads["district"] = district
    ads = ads[ads.district.notna()].reset_index(drop=True)

    # neighbourhoods: keep Divar's tag when the ad sits inside that neighbourhood's box,
    # otherwise use the nearest catalog centroid (vectorised, in chunks)
    cat = pd.read_csv(CATALOG).set_index("slug")
    kx = math.cos(math.radians(35.7))
    tag = ads["slug"] if "slug" in ads else pd.Series([None] * len(ads))
    box = cat.reindex(tag.fillna(""))
    tol = 0.003
    ok = (tag.notna().to_numpy()
          & (ads.lon.to_numpy() >= box.min_lon.to_numpy() - tol) & (ads.lon.to_numpy() <= box.max_lon.to_numpy() + tol)
          & (ads.lat.to_numpy() >= box.min_lat.to_numpy() - tol) & (ads.lat.to_numpy() <= box.max_lat.to_numpy() + tol))
    cx, cy = cat.lon.to_numpy() * kx, cat.lat.to_numpy()
    nearest = np.empty(len(ads), dtype=object)
    px, py = ads.lon.to_numpy() * kx, ads.lat.to_numpy()
    for i in range(0, len(ads), 20000):
        d2 = (px[i:i + 20000, None] - cx[None, :]) ** 2 + (py[i:i + 20000, None] - cy[None, :]) ** 2
        nearest[i:i + 20000] = cat.index.to_numpy()[d2.argmin(axis=1)]
    ads["slug"] = np.where(ok, tag.to_numpy(), nearest)
    tag_agreement = float(ok.mean()) if len(ads) else 0.0

    jy = gregorian_to_jalali(date.fromisoformat(str(ads.collected_on.iloc[0])))[0] \
        if "collected_on" in ads and len(ads) else gregorian_to_jalali(date.today())[0]

    def summarise(g):
        col = lambda c: pd.to_numeric(g[c], errors="coerce") if c in g else pd.Series(dtype=float)  # noqa: E731
        return pd.Series({"listings": len(g), "ppm2": g.price_per_m2_toman.median(),
                          "ppm2_p25": g.price_per_m2_toman.quantile(.25),
                          "ppm2_p75": g.price_per_m2_toman.quantile(.75),
                          "size_median": g.size_m2.median(), "price_median": g.price_toman.median(),
                          "rooms_median": col("rooms").median(), "build_year": jy - col("age_years").median(),
                          "parking_share": g.parking.mean(), "elevator_share": g.elevator.mean()})

    out = Path(out_dir) if out_dir else OUT
    out.mkdir(parents=True, exist_ok=True)
    collected = str(ads.collected_on.iloc[0]) if "collected_on" in ads and len(ads) else ""
    dtab = ads.groupby("district").apply(summarise, include_groups=False).reset_index()
    dtab["district"] = dtab.district.astype(int)
    htab = ads.dropna(subset=["slug"]).groupby("slug").apply(summarise, include_groups=False).reset_index()
    htab["district"] = htab.slug.map(ads.groupby("slug").district.agg(lambda d: d.mode().iat[0])).astype(int)
    # price levels use the same method as the 1403 figures they are compared with:
    # listing-weighted quantiles of neighbourhood medians (neighbourhoods with 10+ ads)
    from iran_housing.market import wquantile
    big = htab[htab.listings >= 10]

    def level(h, fallback):
        if h.empty:
            return fallback
        return pd.Series({c: wquantile(h.ppm2, h.listings, q)
                          for c, q in (("ppm2", .5), ("ppm2_p25", .25), ("ppm2_p75", .75))})
    for i, row in dtab.iterrows():
        dtab.loc[i, ["ppm2", "ppm2_p25", "ppm2_p75"]] = level(big[big.district == row.district],
                                                              row[["ppm2", "ppm2_p25", "ppm2_p75"]]).values
    q = ads.price_per_m2_toman.quantile([.5, .25, .75]).to_numpy()
    tehran = level(big, pd.Series(q, index=["ppm2", "ppm2_p25", "ppm2_p75"]))
    for t in (dtab, htab):
        t["collected_on"] = collected
    dtab.to_csv(out / "tehran_districts_1405.csv", index=False)
    big.to_csv(out / "tehran_neighbourhoods_1405.csv", index=False)
    meta = {"source": "Divar web map endpoint, apartment-sell, collected with scripts/collect_divar.py",
            "collected_on": collected, "raw_ads": n0, "ads_used": int(len(ads)),
            "neighbourhood_tag_matches_location": round(tag_agreement, 4),
            "tehran_median_ppm2": float(tehran.ppm2),
            "tehran_median_ppm2_all_ads": float(ads.price_per_m2_toman.median()),
            "method": "listing-weighted median of neighbourhood medians, as for 1403",
            "note": "Asking prices; map-card prices are rounded by Divar (about ±1%)."}
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    # append this collection to the running history (one row per district + Tehran)
    snap = dtab[["district", "listings", "ppm2", "ppm2_p25", "ppm2_p75"]].rename(columns={"district": "scope"})
    snap["scope"] = snap["scope"].astype(str)
    city = pd.DataFrame([{"scope": "tehran", "listings": len(ads), **tehran.to_dict()}])
    snap = pd.concat([city, snap], ignore_index=True)
    snap.insert(0, "collected_on", collected)
    hist = out / "snapshots.csv"
    if hist.exists():
        old = pd.read_csv(hist, dtype={"scope": str})
        snap = pd.concat([old[old.collected_on != collected], snap], ignore_index=True)
    snap.sort_values(["collected_on", "scope"]).to_csv(hist, index=False)
    print(json.dumps(meta, ensure_ascii=False, indent=2))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("catalog", help="refresh Divar's Tehran neighbourhood catalog")
    c = sub.add_parser("collect")
    c.add_argument("--city", default="tehran", choices=sorted(CITIES))
    c.add_argument("--category", default="apartment-sell")
    c.add_argument("--delay", type=float, default=0.3)
    c.add_argument("--max-requests", type=int, default=5000)
    c.add_argument("--probe", action="store_true", help="save the first raw response for inspection")
    c.add_argument("--max-minutes", type=float, default=45.0, help="stop cleanly and keep what was collected")
    c.add_argument("--workers", type=int, default=3, help="parallel neighbourhoods (keep it small)")
    a = sub.add_parser("aggregate")
    a.add_argument("raw", nargs="?", help="raw CSV from `collect` (default: newest in data/local)")
    args = ap.parse_args()
    if args.cmd == "catalog":
        refresh_catalog()
    elif args.cmd == "collect":
        collect(args.city, args.category, args.delay, args.max_requests, args.probe, args.max_minutes, args.workers)
    else:
        raw = Path(args.raw) if args.raw else max(LOCAL.glob("divar_tehran_*.csv"), key=lambda p: p.stat().st_mtime)
        aggregate(raw)
    return 0


if __name__ == "__main__":
    sys.exit(main())
