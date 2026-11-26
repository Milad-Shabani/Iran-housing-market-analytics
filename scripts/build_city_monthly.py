"""Rebuild sale and rental city-month tables from the pinned Divar ODbL release.

Pass either the official CSV or the two complete Hugging Face Parquet shards.
Parquet input requires pyarrow. Outputs are monthly city, province and Tehran district aggregates.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from iran_housing.geo import DistrictLocator
from shapely import points

OUT = Path(__file__).resolve().parents[1] / "data"
SOURCE = "https://huggingface.co/datasets/divarofficial/real_estate_ads"
SOURCE_REVISION = "e9446ee97b8e6eb9bd62bdfd7548f1bc8973be85"
CSV_HASH = "e5760fe1325a195e6682c371457bfecd51d255c518756e3cbea234b8163a801f"
PARQUET_HASHES = {
    "b335a736b9a6e8acf73f21b6a634e16671194f21f79aceea842736aa7a3274c1",
    "0019bfa2627a6832f163e39c8a4389f11edd1ee80391b1f7f08e1b21775db8f5",
}
COLUMNS = ["cat2_slug", "cat3_slug", "city_slug", "created_at_month", "building_size", "price_value"]
RENT_COLUMNS = ["rent_mode", "credit_mode", "rent_value", "credit_value"]
MIN_LISTINGS = 50
ROOM_COUNTS = {"بدون اتاق": 0, "یک": 1, "دو": 2, "سه": 3, "چهار": 4, "پنج یا بیشتر": 5}


def city_apartments(ads: pd.DataFrame, market: str) -> pd.DataFrame:
    area = pd.to_numeric(ads.building_size, errors="coerce")
    valid = (ads.cat2_slug.eq("residential-" + market) & ads.cat3_slug.eq("apartment-" + market)
             & ads.city_slug.str.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", na=False) & area.between(20, 1000))
    rows = ads.loc[valid].copy()
    rows["building_size"] = area.loc[valid]
    rows["month"] = pd.to_datetime(rows.created_at_month, errors="coerce").dt.strftime("%Y-%m")
    return rows.dropna(subset=["month"])


def summarize_city_months(ads: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    rows = city_apartments(ads, "sell")
    rows["ppm2"] = pd.to_numeric(rows.price_value, errors="coerce") / rows.building_size
    rows = rows.loc[rows.ppm2.between(1e6, 2e9)]
    g = rows.groupby(["city_slug", "month"]).ppm2
    table = g.agg(listings="size", median="median").join(g.quantile(.25).rename("p25")).join(g.quantile(.75).rename("p75"))
    return table.loc[table.listings >= MIN_LISTINGS].round().astype("int64").reset_index(), len(rows)


def summarize_rentals(ads: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    rows = city_apartments(ads, "rent")
    amounts = rows[["rent_value", "credit_value"]].apply(pd.to_numeric, errors="coerce")
    fixed = rows.rent_mode.eq("مقطوع") & rows.credit_mode.eq("مقطوع")
    valid = fixed & amounts.gt(0).all(axis=1) & np.isfinite(amounts).all(axis=1)
    rows = rows.loc[valid].assign(rent=amounts.rent_value, deposit=amounts.credit_value)
    g = rows.groupby(["city_slug", "month"])
    table = g.size().rename("listings").to_frame()
    for column in ("rent", "deposit"):
        for label, quantile in (("median", .5), ("p25", .25), ("p75", .75)):
            table[f"{column}_{label}"] = g[column].quantile(quantile)
    return table.loc[table.listings >= MIN_LISTINGS].round().astype("int64").reset_index(), len(rows)


def tehran_district_ids(ads):
    """Only Tehran rows with a reported coordinate strictly inside one district."""
    coords = ads.loc[ads.city_slug.eq("tehran"), ["location_longitude", "location_latitude"]]
    coords = coords.apply(pd.to_numeric, errors="coerce").dropna()
    locator = DistrictLocator()
    positions, polygons = locator.tree.query(points(coords.to_numpy()), predicate="within")
    found = pd.Series([str(locator.ids[i]) for i in polygons], index=coords.index[positions], dtype="string")
    return found.loc[~found.index.duplicated(keep=False)]


def market_archives(ads, province_by_city, districts=None):
    """Each amount has its own denominator. Province quantiles pool individual ads."""
    for market in ("sale", "rent", "deposit"):
        rows = city_apartments(ads, "sell" if market == "sale" else "rent")
        if market == "sale":
            amount = pd.to_numeric(rows.price_value, errors="coerce") / rows.building_size
            valid = amount.between(1e6, 2e9)
        else:
            field = "rent" if market == "rent" else "credit"
            amount = pd.to_numeric(rows[field + "_value"], errors="coerce")
            valid = rows[field + "_mode"].eq("مقطوع") & amount.gt(0) & np.isfinite(amount)
        bedrooms = rows.get("rooms_count", pd.Series(index=rows.index, dtype="string")).map(ROOM_COUNTS)
        total = pd.to_numeric(rows.price_value, errors="coerce") if market == "sale" else amount
        rows = rows.loc[valid, ["city_slug", "month", "building_size"]].assign(
            amount=amount[valid], total=total[valid], per_m2=total[valid] / rows.loc[valid, "building_size"],
            bedrooms=bedrooms[valid], two_bedrooms=bedrooms[valid].eq(2))

        scopes = []
        rows["province"] = rows.city_slug.map(province_by_city)
        rows["district"] = districts if districts is not None else pd.NA
        for level, column in (("city", "city_slug"), ("province", "province"), ("district", "district")):
            cohort = rows.dropna(subset=[column])
            geography = cohort[column]
            group = cohort.groupby([geography.rename("area"), "month"])
            counts = group.size().rename("listings")
            table = pd.concat([counts, group.city_slug.nunique().rename("cities"),
                               group.amount.median().rename("median"), group.amount.quantile(.25).rename("p25"),
                               group.amount.quantile(.75).rename("p75"),
                               group.total.median().rename("median_per_apartment"),
                               group.per_m2.median().rename("median_per_m2"),
                               group.bedrooms.count().rename("rooms_reported"),
                               group.two_bedrooms.sum().rename("two_bedroom_listings")], axis=1)
            table = table.loc[table.listings >= MIN_LISTINGS].round().astype("int64").reset_index()
            sizes = group.building_size.median().rename("median_area_m2").round(1)
            table = table.merge(sizes, on=["area", "month"], validate="one_to_one")
            table.insert(0, "level", level)
            scopes.append(table)
        yield market, pd.concat(scopes, ignore_index=True)


def source_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for part in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(part)
    return digest.hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("inputs", type=Path, nargs="+")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()
    hashes = [source_hash(path) for path in args.inputs]
    if len(hashes) != len(set(hashes)) or set(hashes) not in ({CSV_HASH}, PARQUET_HASHES):
        ap.error("expected the official CSV or both distinct Parquet shards from the pinned release")
    columns = COLUMNS + RENT_COLUMNS + ["location_longitude", "location_latitude", "rooms_count"]
    if set(hashes) == PARQUET_HASHES:
        ads = pd.concat([pd.read_parquet(p, columns=columns) for p in args.inputs], ignore_index=True)
    else:
        ads = pd.read_csv(args.inputs[0], usecols=columns, low_memory=False)
    if len(ads) != 1_000_000:
        ap.error("expected the complete 1,000,000-row Divar archive")
    args.out.mkdir(parents=True, exist_ok=True)
    members = pd.read_csv(OUT / "geo" / "divar_gilan_cities.csv")
    if len(members) != 56 or members.city_slug.nunique() != len(members):
        ap.error("incomplete pinned Gilan city directory")
    lookup = pd.read_csv(OUT / "geo" / "iran_city_lookup.csv").dropna(subset=["province_iso"])
    provinces = dict(zip(lookup.city_slug, lookup.province_iso))
    provinces.update(dict.fromkeys(members.city_slug, "IR-01"))
    archive_path = args.out / "market_archive"
    archive_path.mkdir(exist_ok=True)
    for market, table in market_archives(ads, provinces, tehran_district_ids(ads)):
        table.to_csv(archive_path / (market + ".csv"), index=False)
        print(f"{market}: {len(table)} published area-months")
    for name, (table, usable), filters in (
        ("apartments", summarize_city_months(ads),
         {"category": "residential-sell/apartment-sell", "area_m2": [20, 1000], "source_units_per_m2": [1000000, 2000000000]}),
        ("rentals", summarize_rentals(ads),
         {"category": "residential-rent/apartment-rent", "area_m2": [20, 1000], "rent_mode": "مقطوع",
          "credit_mode": "مقطوع", "amounts": "positive finite rent and deposit on the same listing"}),
    ):
        if table.empty:
            ap.error(f"no qualifying city-months in {name}")
        meta = {"source": SOURCE, "source_revision": SOURCE_REVISION, "license": "ODbL-1.0",
                "input_rows": len(ads), "usable_rows": usable, "min_listings": MIN_LISTINGS,
                "displayed_listings": int(table.listings.sum()), "cities": int(table.city_slug.nunique()),
                "city_months": len(table), "first_month": table.month.min(), "last_month": table.month.max(),
                "calendar": "Gregorian", "price_unit": "source units (currency denomination not documented)",
                "filters": filters, "input_sha256": hashes}
        table.to_csv(args.out / f"cities_monthly_{name}.csv", index=False)
        (args.out / f"cities_monthly_{name}.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n",
                                                              encoding="utf-8")
        print(f"{name}: {meta['cities']} cities, {len(table)} city-months, {meta['displayed_listings']:,} listings")


if __name__ == "__main__":
    main()
