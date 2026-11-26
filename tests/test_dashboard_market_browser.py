"""Run the full bilingual UI against the embedded, offline data with a system Chromium."""
import csv
from pathlib import Path
import os

import pytest

browser_api = pytest.importorskip("playwright.sync_api")
ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def browser():
    chrome = os.environ.get("HOUSING_TEST_CHROME")
    if not chrome:
        pytest.skip("set HOUSING_TEST_CHROME to the Chromium executable")
    with browser_api.sync_playwright() as driver:
        browser = driver.chromium.launch(executable_path=chrome, args=["--no-sandbox"])
        yield browser
        browser.close()


@pytest.mark.parametrize("filename,width", [("index.html", 1280), ("index.fa.html", 390)])
def test_every_chart_respects_the_global_filters(browser, filename, width):
    errors=[]
    page=browser.new_page(viewport={"width":width,"height":820},accept_downloads=True)
    page.on("pageerror",lambda error: errors.append(str(error)))
    page.goto((ROOT/"site"/filename).as_uri())
    page.wait_for_selector("[data-panel=weekly]")
    def state(key):
        return page.locator(f'[data-panel="{key}"]').get_attribute("data-state")
    def select(metric, period, geo="all"):
        page.select_option("#marketKind",metric)
        page.select_option("#marketGeo",geo)
        page.select_option("#marketPeriod",period)
    select("sale","all")
    total=page.locator("[data-panel]").count()
    assert total == 23 and page.locator("[data-state=empty]").count() == 0
    assert page.locator(".card svg:visible").evaluate_all("nodes => nodes.every(e => e.closest('[data-panel]') || e.closest('#kpis'))")
    # Test unavailable days between real observations, and both chart and control visibility.
    for market in ["deposit","rent","sale"]:
        page.select_option("#marketKind",market)
        page.select_option("#marketPeriod","custom")
        page.locator("#marketDay").fill("2024-08-15")
        page.locator("#marketDay").dispatch_event("change")
        assert page.locator('[data-state=empty][aria-disabled=true]').count() == total
        assert page.locator(".scope-slot svg:visible, .scope-slot table:visible, #kpis svg:visible").count() == 0
        assert page.locator(".scope-slot button:visible, .scope-slot select:visible").count() == 0
        assert page.locator("#marketCSV").is_disabled()
    for market in ["sale","rent","deposit"]:
        select(market,"m:2024-08","gilan")
        assert state("gilan") == state("archive") == "native"
        assert state("weekly") == state("tehran-map") == state("forecast") == "empty"
        assert page.locator('[data-panel=iran-map] .scoped-map [data-area]').count() == 1
        assert page.locator('[data-panel=iran-map] [data-area="IR-01"]').count() == 1
        with page.expect_download() as downloaded:
            page.locator("#marketCSV").click()
        with open(downloaded.value.path(),encoding="utf-8") as stream:
            actual=list(csv.DictReader(stream))
        with (ROOT/f"data/processed/market_{market}.csv").open() as stream:
            expected=[r for r in csv.DictReader(stream) if r["gilan"]=="True" and r["period_start"]=="2024-08-01"]
        assert actual == expected
        assert all(r["market"]==market and r["period_end"]=="2024-08-31" for r in actual)
        page.select_option("#marketGeo","all")
        assert state("tehran-map") == "scoped" and len(page.locator('[data-panel=tehran-map] [data-area]').all())>12
        assert state("forecast")=="scoped" and state("cities-index")=="scoped"
        page.select_option("#marketGeo","gilan")
        page.select_option("#marketPeriod","d:2026-11-26")
        assert state("weekly")=="native" and state("gilan")=="empty" and state("iran-map")=="empty"
        assert page.locator("#weeklyBody tbody tr").count()==3
        assert page.locator("#marketStatus").is_visible()
    select("sale","d:2026-11-20")
    assert state("tehran-map")=="scoped" and state("iran-map")=="empty"
    assert page.locator('[data-panel=tehran-map] [data-area]').count()==22
    assert state("changes")=="empty"
    select("sale","m:2026-11")
    assert state("changes")=="scoped"
    select("sale","j:1403-05")
    assert state("forecast")=="scoped" and state("archive")=="empty" # no whole Gregorian archive month fits
    assert state("yoy")=="scoped"
    if filename=="index.fa.html":
        page.select_option("#marketPeriod","custom")
        page.locator("#solarDay").fill("۱۴۰۵/۰۹/۰۵")
        page.locator("#solarDay").dispatch_event("change")
        assert page.locator("#marketDay").input_value()=="2026-11-26"
    select("deposit","m:2024-08","gilan")
    page.locator(".lang").click()
    assert page.locator("#marketKind").input_value()=="deposit" and page.locator("#marketGeo").input_value()=="gilan"
    assert page.locator("#marketPeriod").input_value()=="m:2024-08"
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth+1")
    assert not errors, errors
    page.close()
