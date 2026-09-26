"""Boundaries, point-in-polygon lookups and SVG projection for the dashboard maps.

The dashboard draws its own maps as inline SVG (no tile server, no CDN), so the
projection lives here: an equirectangular projection with longitude scaled by
cos(reference latitude), which is visually faithful at city and country scale.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from functools import lru_cache

from shapely.geometry import Point, shape
from shapely.strtree import STRtree

from .paths import GEO


@lru_cache(maxsize=None)
def tehran_districts() -> list[dict]:
    fc = json.loads((GEO / "tehran_districts.geojson").read_text(encoding="utf-8"))
    return fc["features"]


@lru_cache(maxsize=None)
def iran_provinces() -> list[dict]:
    fc = json.loads((GEO / "iran_provinces.geojson").read_text(encoding="utf-8"))
    return fc["features"]


class DistrictLocator:
    """Assign WGS84 points to Tehran's 22 municipal districts."""

    def __init__(self, snap_km: float = 0.6) -> None:
        feats = tehran_districts()
        self.shapes = [shape(f["geometry"]) for f in feats]
        self.ids = [f["properties"]["district"] for f in feats]
        self.tree = STRtree(self.shapes)
        # The district file is hand-digitised; points a few hundred metres outside the
        # outer edge (or in slivers between two polygons) are snapped to the nearest one.
        self.snap_deg = snap_km / 111.0

    def locate(self, lat: float, lon: float) -> tuple[int | None, str]:
        if lat is None or lon is None or math.isnan(lat) or math.isnan(lon):
            return None, "no_coordinates"
        p = Point(lon, lat)
        for i in self.tree.query(p):
            if self.shapes[i].contains(p):
                return self.ids[i], "inside"
        i = self.tree.nearest(p)
        if self.shapes[i].distance(p) <= self.snap_deg:
            return self.ids[i], "snapped"
        return None, "outside_tehran"


@dataclass(frozen=True)
class Projection:
    """Equirectangular projection fitted to a bounding box and an SVG width."""

    lon0: float
    lat1: float
    kx: float
    scale: float
    pad: float

    @classmethod
    def fit(cls, bounds: tuple[float, float, float, float], width: float, pad: float = 10) -> "Projection":
        minx, miny, maxx, maxy = bounds
        kx = math.cos(math.radians((miny + maxy) / 2))
        scale = (width - 2 * pad) / ((maxx - minx) * kx)
        return cls(minx, maxy, kx, scale, pad)

    def xy(self, lon: float, lat: float) -> tuple[float, float]:
        return (self.pad + (lon - self.lon0) * self.kx * self.scale,
                self.pad + (self.lat1 - lat) * self.scale)

    def height(self, bounds: tuple[float, float, float, float]) -> float:
        return round(self.xy(bounds[0], bounds[1])[1] + self.pad, 1)

    def params(self) -> dict:
        return {"lon0": self.lon0, "lat1": self.lat1, "kx": self.kx, "scale": self.scale, "pad": self.pad}


def svg_path(geometry: dict, proj: Projection, nd: int = 1) -> str:
    polys = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    parts = []
    for poly in polys:
        for ring in poly:
            pts = [proj.xy(x, y) for x, y in ring]
            out, last = [], None
            for x, y in pts:
                cur = (round(x, nd), round(y, nd))
                if cur != last:
                    out.append(cur)
                    last = cur
            if len(out) < 3:
                continue
            parts.append("M" + "L".join(f"{x:g},{y:g}" for x, y in out) + "Z")
    return "".join(parts)


def bounds_of(features: list[dict]) -> tuple[float, float, float, float]:
    b = [shape(f["geometry"]).bounds for f in features]
    return (min(x[0] for x in b), min(x[1] for x in b), max(x[2] for x in b), max(x[3] for x in b))


def label_point(geometry: dict) -> tuple[float, float]:
    """A point guaranteed inside the polygon, for map labels."""
    g = shape(geometry)
    try:
        from shapely import polylabel  # shapely >= 2.1
        p = polylabel(g if g.geom_type == "Polygon" else max(g.geoms, key=lambda x: x.area), tolerance=0.001)
    except Exception:  # pragma: no cover - older shapely
        p = g.representative_point()
    return p.x, p.y
