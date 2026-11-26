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
