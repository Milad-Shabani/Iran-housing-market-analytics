from datetime import date
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import collect_city_weekly as W


def fixture_ads(areas, minutes):
    return [{"size_m2": 90, "price_per_m2_toman": 55e6 + i * 1e5} for i in range(125)]


def test_week_replay_and_partial_success(tmp_path):
    out = tmp_path / "weekly.csv"
    cities = ["karaj", "mashhad"]
    day = date(2026, 11, 27)
    assert W.refresh(cities, out, collect=fixture_ads, day=day) == 0
    before = out.read_bytes()
    assert W.refresh(cities, out, collect=fixture_ads, day=day) == 0
    assert out.read_bytes() == before

    def interrupted(areas, minutes):
        if areas[0]["city"] == "mashhad":
            raise W.divar.IncompleteCollection("timeout")
        return fixture_ads(areas, minutes)

    assert W.refresh(cities, out, collect=interrupted, day=date(2026, 12, 4)) == 0
    rows = W.load_rows(out, W.HEADER)
    assert [(r["city"], r["week"]) for r in rows] == [
        ("karaj", "2026-11-21"), ("mashhad", "2026-11-21"), ("karaj", "2026-11-28")]
    unchanged = out.read_bytes()
    assert W.refresh(["mashhad"], out, collect=interrupted, day=date(2026, 12, 4)) == 1
    assert W.refresh(["karaj"], out, collect=fixture_ads, day=day) == 1
    assert out.read_bytes() == unchanged


def test_fixed_panel_and_volume_checks():
    all_areas = W.load_rows(W.PANEL, W.PANEL_FIELDS)
    assert set(r["city"] for r in all_areas) == set(W.CITIES)
    areas = [r for r in all_areas if r["city"] == "karaj"]
    ads = fixture_ads(areas, 5)
    day = date(2026, 11, 27)
    accepted = W.summarize("karaj", day, ads, areas, None)
    assert accepted["neighbourhoods"] == 48 and accepted["listings"] == 125
    with pytest.raises(W.divar.IncompleteCollection, match="panel areas"):
        W.summarize("karaj", day, ads, areas[:-1], accepted)
    with pytest.raises(W.divar.IncompleteCollection, match="differs"):
        W.summarize("karaj", day, ads, areas, {**accepted, "panel_id": "changed"})
    with pytest.raises(W.divar.IncompleteCollection, match="at least 150"):
        W.summarize("karaj", day, ads, areas, {**accepted, "listings": 300})


def test_gather_handles_recorded_empty_response_and_deduplicates(monkeypatch):
    areas = W.load_rows(W.PANEL, W.PANEL_FIELDS)[:3]
    post = {"map_post_card": {"token": "fixture"}}
    def source(*args, district_id):
        if district_id == areas[0]["district_id"]:
            return {"count_text": "بدون آگهی"}
        return {"posts": [post], "count": 1}
    monkeypatch.setattr(W.divar, "request_viewport", source)
    monkeypatch.setattr(W.time, "sleep", lambda _: None)
    assert len(W.gather(areas, 1)) == 1
    monkeypatch.setattr(W.divar, "request_viewport", lambda *a, **k: {"count": 2})
    with pytest.raises(ValueError, match="posts"):
        W.gather(areas, 1)
