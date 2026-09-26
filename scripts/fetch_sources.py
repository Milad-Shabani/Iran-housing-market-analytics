"""Re-download every upstream file this project is built from and rebuild data/raw/.

Nothing here is generated or simulated: each output row traces to a public file
pinned below. Run it only if you want to refresh or audit the raw layer; the
pipeline itself (scripts/run_pipeline.py) reads the committed copies in data/raw/.

    python scripts/fetch_sources.py            # download + rebuild data/raw
    python scripts/fetch_sources.py --check    # download and diff against committed files
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
GEO = ROOT / "data" / "geo"

GH = "https://raw.githubusercontent.com"

# 1) Divar official 1M real-estate ads (ODbL) -> aggregates published by
#    maminigder/Iran-Real-Estate-Market-Analysis (MIT code). The 1M-row source
#    itself lives on Hugging Face (divarofficial/real_estate_ads).
DIVAR_1M = f"{GH}/maminigder/Iran-Real-Estate-Market-Analysis/main/outputs"
DIVAR_1M_FILES = {
    "city_summary.csv": "city_summary.csv",
    "tehran_neighborhood_summary.csv": "tehran_neighborhood_summary.csv",
    "tehran_neighborhood_uncertainty.csv": "tehran_neighborhood_uncertainty.csv",
    "major_cities_raw_monthly.csv": "major_cities_monthly.csv",
    "major_cities_monthly_trends.csv": "major_cities_monthly_index.csv",
    "amenity_summary.csv": "amenity_summary.csv",
    "construction_year_summary.csv": "construction_period_summary.csv",
    "market_summary.json": "market_summary.json",
}

# 2) Divar Tehran listings, 3,479 rows (Kaggle "Tehran (Divar.ir) House Price").
DIVAR_2021 = f"{GH}/F-Yousefi/House_Price_Prediction/main/dataset/divar_tehran_dataset/DivarHousePrice.csv"

# 3) Central Bank of Iran (CBI) monthly mean price per m2 of Tehran transactions.
CBI_1395_1399 = (f"{GH}/amiralimadadi/Regression_TheranHousing/"
                 "ac6a6406f2c5507ab9a905859efc1b61cb4d17c1/TehranHousingPriceBackground.csv")
CBI_RECENT = f"{GH}/Captain-Jorf/tehran-house-price/main/data/external/tehran_recent/observations.json"

# 4) Boundaries: Tehran's 22 municipal districts and Iran's 31 provinces/counties (OSM).
TEHRAN_DISTRICTS = f"{GH}/rferdosi/tehran-districts/main/districts.json"
IRAN_PROVINCES = f"{GH}/hosseinhabibi2004/iran-geojson/master/data/provinces/provinces.min.geojson"
IRAN_COUNTIES = f"{GH}/hosseinhabibi2004/iran-geojson/master/data/counties/IR-{{code:02d}}/IR-{{code:02d}}.all.min.geojson"

CBI_1395_PAGE = ("https://github.com/amiralimadadi/Regression_TheranHousing/blob/"
                 "ac6a6406f2c5507ab9a905859efc1b61cb4d17c1/TehranHousingPriceBackground.csv")


def get(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=60) as r:  # noqa: S310 - fixed public URLs
        return r.read()


def build_cbi_rows() -> list[dict]:
    """Merge the two CBI transcriptions into one tidy monthly table (toman per m2)."""
    rows: list[dict] = []
    text = get(CBI_1395_1399).decode("utf-8")
    for rec in csv.DictReader(io.StringIO(text)):
        ym = int(rec["Month"])
        rows.append({
            "jalali_year": ym // 100, "jalali_month": ym % 100,
            "price_per_m2_toman": int(float(rec["Price"])), "transactions": "",
            "source": "CBI monthly series, 1395-1399 (transcribed CSV)",
            "source_url": CBI_1395_PAGE, "quality": "official_series_transcribed",
        })
    obs = json.loads(get(CBI_RECENT))
    for rec in obs["records"]:
        if rec["series"] != "cbi_transaction_mean":
            continue
        unit, v = rec["raw_unit"], float(rec["raw_value"])
        if unit == "dlearn_pre_140105" or unit == "toman":
            toman = v
        elif unit == "dlearn_post_140105":      # d-learn CSV switched to thousand rials at 1401/05
            toman = v * 100
        elif unit == "million_irr":             # 1 million rials = 100,000 toman
            toman = v * 100_000
        else:
            raise ValueError(f"unknown unit {unit}")
        src = obs["sources"][rec["source_id"]]
        ym = int(rec["month_jalali"])
        rows.append({
            "jalali_year": ym // 100, "jalali_month": ym % 100,
            "price_per_m2_toman": int(round(toman)),
            "transactions": rec.get("transaction_count") or "",
            "source": src["title"], "source_url": src["url"],
            "quality": rec["quality"],
        })
    rows.sort(key=lambda r: (r["jalali_year"], r["jalali_month"]))
    return rows


def build_kilid_rows() -> list[dict]:
    obs = json.loads(get(CBI_RECENT))
    src = obs["sources"]["kilid"]
    out = []
    for rec in obs["records"]:
        if rec["series"] != "kilid_listing_indicator":
            continue
        ym = int(rec["month_jalali"])
        out.append({
            "jalali_year": ym // 100, "jalali_month": ym % 100,
            "price_per_m2_toman": int(round(float(rec["raw_value"]) * 1_000_000)),
            "source": src["title"], "source_url": src["url"], "quality": rec["quality"],
        })
    return sorted(out, key=lambda r: (r["jalali_year"], r["jalali_month"]))


def write_csv(path: Path, rows: list[dict]) -> bytes:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=list(rows[0]), lineterminator="\n")
    w.writeheader()
    w.writerows(rows)
    return buf.getvalue().encode("utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="compare downloads with committed files")
    args = ap.parse_args()

    targets: dict[Path, bytes] = {}
    for src, dst in DIVAR_1M_FILES.items():
        targets[RAW / "divar_1m" / dst] = get(f"{DIVAR_1M}/{src}")
    targets[RAW / "divar_2021" / "tehran_listings_raw.csv"] = get(DIVAR_2021)
    targets[RAW / "official" / "cbi_tehran_monthly.csv"] = write_csv(Path(), build_cbi_rows())
    targets[RAW / "official" / "kilid_tehran_monthly.csv"] = write_csv(Path(), build_kilid_rows())
    targets[GEO / "tehran_districts_raw.geojson"] = get(TEHRAN_DISTRICTS)
    targets[GEO / "_upstream" / "provinces.min.geojson"] = get(IRAN_PROVINCES)
    for code in range(31):
        targets[GEO / "_upstream" / f"IR-{code:02d}.geojson"] = get(IRAN_COUNTIES.format(code=code))

    changed = 0
    for path, blob in targets.items():
        if args.check:
            same = path.exists() and path.read_bytes() == blob
            changed += not same
            print(("same     " if same else "DIFFERENT"), path.relative_to(ROOT))
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(blob)
            print("wrote", path.relative_to(ROOT), f"({len(blob):,} bytes)")
    return 1 if (args.check and changed) else 0


if __name__ == "__main__":
    sys.exit(main())
