"""Build the small, committed geography layer from the OSM downloads.

Inputs  (data/geo/_upstream, fetched by scripts/fetch_sources.py, not committed):
    provinces.min.geojson, IR-00..IR-30.geojson (counties)
Outputs (committed):
    data/geo/iran_provinces.geojson   31 provinces, simplified, with ISO code + fa/en names
    data/geo/iran_counties.csv        county name, province ISO, representative point
    data/geo/iran_city_lookup.csv     Divar city slug -> county -> province (+ how it was matched)
    data/geo/tehran_districts.geojson 22 municipal districts, numbered 1..22
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pandas as pd
from shapely.geometry import mapping, shape

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from iran_housing.paths import GEO, RAW  # noqa: E402

UP = GEO / "_upstream"


def norm(name: str) -> str:
    """Loose transliteration key so 'Qaem Shahr County' and 'qaem-shahr' collide."""
    s = name.lower().replace(" county", "")
    for suf in ("-city", "-new-town", "-industrial-city"):
        s = s.replace(suf, "")
    s = re.sub(r"[^a-z]", "", s)
    for a, b in [("ou", "u"), ("oo", "u"), ("ee", "i"), ("iy", "i"), ("ey", "ei"), ("gh", "q"),
                 ("kh", "x"), ("w", "v"), ("aa", "a"), ("eh", "e"), ("ah", "a"), ("ie", "i")]:
        s = s.replace(a, b)
    return re.sub(r"(.)\1", r"\1", s)


def rounded(geom: dict, nd: int = 4) -> dict:
    def r(c):
        return [r(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], nd), round(c[1], nd)]
    return {"type": geom["type"], "coordinates": r(geom["coordinates"])}


def main() -> None:
    counties = []
    for code in range(31):
        iso = f"IR-{code:02d}"
        for ft in json.loads((UP / f"{iso}.geojson").read_text())["features"]:
            t = ft["properties"].get("tags", {})
            if t.get("admin_level") != "5" or not t.get("name:en"):
                continue
            p = shape(ft["geometry"]).representative_point()
            counties.append({"province_iso": iso, "county_en": t["name:en"].replace(" County", "").strip(),
                             "county_fa": (t.get("name") or "").replace("شهرستان ", "").strip(),
                             "lat": round(p.y, 4), "lon": round(p.x, 4)})
    co = pd.DataFrame(counties)
    co.to_csv(GEO / "iran_counties.csv", index=False)

    # Provinces: attach ISO code by majority vote of the counties that fall inside each polygon.
    prov = json.loads((UP / "provinces.min.geojson").read_text())["features"]
    from shapely.geometry import Point
    feats = []
    for ft in prov:
        g = shape(ft["geometry"])
        inside = co[[g.contains(Point(x, y)) for x, y in zip(co.lon, co.lat)]]
        iso = inside.province_iso.mode().iat[0]
        simple = g.simplify(0.02, preserve_topology=True)
        feats.append({"type": "Feature",
                      "properties": {"iso": iso, "name_en": ft["properties"]["name:en"],
                                     "name_fa": ft["properties"]["name:fa"]},
                      "geometry": rounded(mapping(simple), 3)})
    feats.sort(key=lambda f: f["properties"]["iso"])
    assert len({f["properties"]["iso"] for f in feats}) == 31, "every province needs its own ISO code"
    (GEO / "iran_provinces.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats},
                                                           ensure_ascii=False, separators=(",", ":")))

    # Divar city slug -> county: exact transliteration key first, then the author-assigned overrides.
    cities = pd.read_csv(RAW / "divar_1m" / "city_summary.csv")[["city_slug", "listings"]]
    co["key"] = co.county_en.map(norm)
    auto = cities.assign(key=cities.city_slug.map(norm)).merge(co, on="key", how="left")
    auto["match"] = auto.county_en.notna().map({True: "name_match", False: None})
    ov = pd.read_csv(GEO / "city_county_overrides.csv")
    ov = ov.merge(co.drop(columns="key"), on="county_en", how="left")
    missing = ov[ov.province_iso.isna()]
    assert missing.empty, f"override counties not found in OSM: {missing.county_en.tolist()}"
    ov = ov.set_index("city_slug")
    for col in ["county_en", "county_fa", "province_iso", "lat", "lon"]:
        fill = auto.city_slug.map(ov[col])
        auto[col] = auto[col].where(auto[col].notna(), fill)
    auto.loc[auto.match.isna() & auto.county_en.notna(), "match"] = "author_assigned"
    auto["match"] = auto["match"].fillna("unassigned")
    out = auto[["city_slug", "listings", "county_en", "county_fa", "province_iso", "lat", "lon", "match"]]
    out.to_csv(GEO / "iran_city_lookup.csv", index=False)
    share = out[out.match != "unassigned"].listings.sum() / out.listings.sum()
    print(f"cities: {len(out)} | matched by name {int((out.match == 'name_match').sum())} | "
          f"author-assigned {int((out.match == 'author_assigned').sum())} | listings covered {share:.2%}")

    # Tehran districts: number them and keep the Persian label.
    td = json.loads((GEO / "tehran_districts_raw.geojson").read_text())
    for ft in td["features"]:
        name = ft["properties"]["name"]
        ft["properties"] = {"district": int(re.findall(r"\d+", name)[0]), "name_fa": name}
        ft["geometry"] = rounded(ft["geometry"], 5)
    td["features"].sort(key=lambda f: f["properties"]["district"])
    assert [f["properties"]["district"] for f in td["features"]] == list(range(1, 23))
    (GEO / "tehran_districts.geojson").write_text(json.dumps(td, ensure_ascii=False, separators=(",", ":")))
    print("wrote iran_provinces.geojson, iran_counties.csv, iran_city_lookup.csv, tehran_districts.geojson")


if __name__ == "__main__":
    main()
