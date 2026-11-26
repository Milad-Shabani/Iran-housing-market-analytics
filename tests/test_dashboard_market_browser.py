"""Exercise the published map layout and its original interactions in both languages."""
import csv
import os
from pathlib import Path

import pytest

browser_api = pytest.importorskip("playwright.sync_api")
ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def browser():
    chrome = os.environ.get("HOUSING_TEST_CHROME")
    if not chrome:
        pytest.skip("set HOUSING_TEST_CHROME to the Chromium executable")
    with browser_api.sync_playwright() as driver:
        instance = driver.chromium.launch(executable_path=chrome, args=["--no-sandbox"])
        yield instance
        instance.close()


@pytest.mark.parametrize("filename,width", [("index.html", 1280), ("index.fa.html", 390)])
def test_map_dashboard_and_monthly_comparison(browser, filename, width):
    page = browser.new_page(viewport={"width": width, "height": 820}, accept_downloads=True)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto((ROOT / "site" / filename).as_uri())
    page.wait_for_selector("#ybYears .on")
    sections = page.locator("main > section").evaluate_all("nodes => nodes.map(node => node.id)")
    assert sections == ["tehran", "pricing", "iran", "forecast", "model", "data"]
    assert page.locator("#tMap path[data-d]").count() == 22
    assert page.locator("#marketKind, #marketPeriod, .scope-slot, #market").count() == 0

    years = page.locator("#ybYears button")
    # District and province maps both contain data in 1403.
    year = "۱۴۰۳" if filename == "index.fa.html" else "1403"
    button = years.filter(has_text=year)
    button.click()
    assert button.get_attribute("aria-pressed") == "true"
    assert page.locator("#tNA").is_hidden() and page.locator("#iNA").is_hidden()
    page.locator("#tMap path[data-d='3']").dispatch_event("click")
    assert ("۳" if filename == "index.fa.html" else "3") in page.locator("#scopeChip").inner_text()
    assert page.locator("#cityHistory").evaluate("node => node.closest('section').id") == "iran"

    page.select_option("#chCity1", "rasht")
    month = str(2024 * 12 + 7)  # August 2024
    page.select_option("#chFrom", month)
    page.select_option("#chTo", month)
    assert page.locator("#chMonth option").count() == 1
    assert page.locator("#chChart circle").count() >= 1
    with page.expect_download() as downloaded:
        page.locator("#chCSV").click()
    with open(downloaded.value.path(), encoding="utf-8-sig", newline="") as source:
        rows = list(csv.reader(source))[1:]
    assert rows and all(row[1] == "2024-08" for row in rows)
    assert any(row[0] == "rasht" for row in rows)
    assert page.locator("#vOut svg").count() >= 1
    assert page.locator("#fChart svg").count() == 1
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
    page.locator(".lang").click()
    assert page.locator("html").get_attribute("lang") == ("en" if filename == "index.fa.html" else "fa")
    assert not errors, errors
    page.close()


@pytest.mark.parametrize("filename,width", [("index.fa.html", 390), ("index.html", 1280)])
def test_single_switch_filters_maps_tables_and_csv(browser, filename, width):
    page = browser.new_page(viewport={"width": width, "height": 820}, accept_downloads=True)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto((ROOT / "site" / filename).as_uri())
    assert page.locator("#obKind button").count() == 3
    assert page.locator("#obKind [data-v=sale]").get_attribute("aria-pressed") == "true"
    assert page.locator("#obPeriod, #chSource, #obDate, #market, .period-tools").count() == 0
    assert page.locator("#ybYears button").count() == 11
    gilan = page.locator("#iMap [data-iso='IR-01']")
    gilan.dispatch_event("click")
    for market in ["rent", "deposit", "sale"]:
        page.locator(f"#obKind [data-v={market}]").click()
        assert "period=y%3A1405" in page.url
        assert page.locator("#obKind [aria-pressed=true]").count() == 1
        expected = {}
        with (ROOT / f"data/processed/market_{market}.csv").open() as f:
            for r in csv.DictReader(f):
                if r["source"] == "panel" and r["gilan"] == "True":
                    expected[r["area"]] = r
        assert page.locator("#iMap circle[data-city=rasht]").count() == 1
        for city in ["rasht", "lahijan", "bandar-anzali"]:
            assert page.locator(f"#iMap circle[data-city='{city}']").count() == 1
        assert page.locator("#iSide tbody tr").count() == 3
        if market != "sale":
            assert page.locator("#vOut").get_attribute("aria-disabled") == "true"
            assert page.locator("#vOut svg:visible, #coefChart svg:visible, #yoyChart svg:visible").count() == 0
        for sel, choice in zip(["#chCity1","#chCity2","#chCity3"],["rasht","bandar-anzali","lahijan"]):
            page.select_option(sel, choice)
        with page.expect_download() as download:
            page.locator("#chCSV").click()
        with open(download.value.path(), encoding="utf-8-sig", newline="") as f:
            records = list(csv.DictReader(f))
        newest = max(r["period_start"] for r in records)
        records = [r for r in records if r["period_start"] == newest]
        assert {r["area"] for r in records} == set(expected)
        for r in records:
            assert r["market"] == market
            for field in ("median", "listings", "median_per_apartment", "median_per_m2", "rooms_reported", "two_bedroom_listings"):
                assert r[field] == expected[r["area"]][field]
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
    page.locator("#obKind [data-v=deposit]").click()
    page.locator("#ybYears button").nth(8).click()  # Solar year 1403
    page.select_option("#chCity1", "p:IR-01")
    page.select_option("#chMonth", str(2024*12+7))
    assert page.locator("#chTable tbody tr").count() >= 1
    expected_unit = "archive" if filename == "index.html" else "آرشیو"
    assert expected_unit in page.locator("#chUnits").inner_text().lower()
    assert page.locator("#iSide tbody tr").count() >= 1
    page.locator("#ybYears button").first.click()  # 1395 has CBI sale observations only
    assert page.locator("#chCSV").is_disabled() and page.locator("#tNA").is_visible() and page.locator("#iNA").is_visible()
    assert page.locator(".chart svg:visible, #fLb table:visible, #mCv table:visible, #vOut svg:visible, #chTable table:visible").count() == 0
    page.locator(".lang").click()
    assert page.locator("#obKind [data-v=deposit]").get_attribute("aria-pressed") == "true"
    assert "period=y%3A1395" in page.url
    page.locator("#obKind [data-v=sale]").click()
    assert page.locator("#fChart svg:visible").count() == 1
    assert not errors, errors
    page.close()


def test_daily_link_never_uses_monthly_archive_as_a_daily_value(browser):
    page = browser.new_page()
    url = (ROOT / "site/index.html").as_uri()
    page.goto(url + "?market=sale&period=d:2024-08-15")
    for market in ("sale","rent","deposit"):
        page.locator(f"#obKind [data-v={market}]").click()
        assert page.locator("#fChart svg:visible, #chChart svg:visible, #vOut svg:visible").count() == 0
        assert page.locator("#iNA").is_visible() and page.locator("#chCSV").is_disabled()
    page.goto(url + "?market=deposit&period=m:2024-08")
    page.locator("#iMap [data-iso='IR-01']").dispatch_event("click")
    assert page.locator("#iNA").is_hidden() and page.locator("#iSide tbody tr").count() > 1
    assert page.locator("#chCSV").is_enabled()
    page.close()
