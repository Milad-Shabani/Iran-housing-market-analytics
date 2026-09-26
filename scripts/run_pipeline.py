"""Run the full analysis: clean -> locate -> summarise -> model -> forecast -> export.

    python scripts/run_pipeline.py

Writes tidy tables to data/processed/ and one JSON file (data/processed/dashboard_data.json)
that scripts/build_dashboard.py embeds into the self-contained dashboard.
"""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from iran_housing import listings as L  # noqa: E402
from iran_housing import market as M  # noqa: E402
from iran_housing import timeseries as T  # noqa: E402
from iran_housing import valuation as V  # noqa: E402
from iran_housing.export import build_dashboard_data  # noqa: E402
from iran_housing.paths import PROCESSED  # noqa: E402


def main() -> None:
    PROCESSED.mkdir(parents=True, exist_ok=True)
    report: dict = {"built": date.today().isoformat()}

    # 1. Tehran neighbourhoods (2024) -> districts
    hoods = M.load_neighborhoods_2024()
    d24 = M.district_table_2024(hoods)
    report["tehran_median_ppm2_2024"] = d24.attrs["tehran_median"]
    report["neighbourhood_quality"] = hoods.quality.value_counts().to_dict()
    report["listings_2024_in_districts"] = int(hoods[hoods.district.notna()].listings.sum())
    report["listings_2024_total"] = int(hoods.listings.sum())

    # 2. Listing-level 2021 data, linked to the same geography
    raw = L.load_raw()
    lst, clean_rep = L.clean(raw)
    lst, link_rep = L.link_locations(lst, hoods)
    report["cleaning_2021"] = clean_rep
    report["linking_2021"] = link_rep
    d21 = M.district_table_2021(lst)
    dist = d24.merge(d21, on="district", how="left")
    dist["growth_multiple"] = np.where(dist.reliable_2021 == True, dist.ppm2 / dist.ppm2_2021, np.nan)  # noqa: E712
    rel = dist[dist.growth_multiple.notna()]
    report["growth_vs_2021_level_corr"] = float(np.corrcoef(np.log(rel.ppm2_2021), np.log(rel.growth_multiple))[0, 1])
    t21 = lst[lst.location_type == "tehran_district"]
    report["tehran_median_ppm2_2021"] = float(t21.ppm2.median())

    # 3. Iran: cities -> provinces
    cities = M.load_cities_2024()
    prov = M.province_table(cities)
    report["national_median_ppm2_2024"] = prov.attrs["national_median"]
    sat = M.satellite_growth(lst, cities)

    # 4. Valuation model
    cv, oof = V.cross_validate(lst)
    model = V.fit_final(lst)
    r = np.log(oof.pred_hedonic_ols / oof.price_toman)
    interval = {"q10": float(np.exp(-np.quantile(r, 0.9))), "q25": float(np.exp(-np.quantile(r, 0.75))),
                "q75": float(np.exp(-np.quantile(r, 0.25))), "q90": float(np.exp(-np.quantile(r, 0.1)))}
    report["valuation_cv"] = cv

    # 5. Time series + forecast
    ser = T.load_series()
    last_cbi = int(ser[ser.cbi.notna()].t.max())
    y = pd.Series(np.log(ser.cbi.to_numpy()), index=ser.t.to_numpy()).loc[:last_cbi]
    bt = T.backtest(y, H=24)
    lb = T.leaderboard(bt)
    best = lb.index[0]
    bands = T.error_bands(bt, best, H=24)
    official_paths = T.forecast_paths(y, H=24)
    g_long = T.long_run_monthly_growth(y)
    k = pd.Series(np.log(ser.kilid.to_numpy()), index=ser.t.to_numpy()).dropna()
    g_kilid_12m = T.trailing_growth(k, 11)  # 11 monthly steps inside the 12 published months
    report["forecast_best_method"] = best
    report["forecast_leaderboard"] = lb.round(4).reset_index().to_dict(orient="records")
    report["cbi_long_run_annual_growth"] = float(np.expm1(12 * g_long))
    report["kilid_annualised_growth_last_12m"] = float(np.expm1(12 * g_kilid_12m))

    # --- tidy outputs
    hoods.to_csv(PROCESSED / "tehran_neighbourhoods_2024.csv", index=False)
    dist.to_csv(PROCESSED / "tehran_districts.csv", index=False)
    lst.to_csv(PROCESSED / "tehran_listings_2021_clean.csv", index=False)
    cities.to_csv(PROCESSED / "iran_cities_2024.csv", index=False)
    prov.to_csv(PROCESSED / "iran_provinces_2024.csv", index=False)
    sat.to_csv(PROCESSED / "satellite_towns_growth.csv", index=False)
    ser.to_csv(PROCESSED / "tehran_monthly_series.csv", index=False)
    bt.to_csv(PROCESSED / "forecast_backtest.csv", index=False)
    oof.to_csv(PROCESSED / "valuation_out_of_fold.csv", index=False)

    data = build_dashboard_data(
        hoods=hoods, districts=dist, provinces=prov, cities=cities, satellites=sat, series=ser,
        leaderboard=lb, bands=bands, official_paths=official_paths, last_cbi=last_cbi,
        g_long=g_long, g_kilid=g_kilid_12m, cv=cv, model=model, interval=interval, oof=oof,
        report=report)
    (PROCESSED / "dashboard_data.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")),
                                                   encoding="utf-8")
    (PROCESSED / "run_report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False, default=float),
                                               encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "forecast_leaderboard"}, indent=2, default=float))
    print(lb.round(3).to_string())


if __name__ == "__main__":
    main()
