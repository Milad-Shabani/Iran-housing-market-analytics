"""Monthly Tehran price series and a backtested 12-month forecast.

Two independent monthly series, kept separate because they measure different things:
  * CBI  - Central Bank of Iran, mean price per m2 of *completed transactions*
           (1395/01-1403/05, 91 of 101 months published or recoverable).
  * Kilid - Kilid.com's published Tehran *listing* indicator (1404/06-1405/05).

Forecasting is judged on the long official series with a rolling origin: every
month that has an observation 1-12 months later becomes a forecast origin, each
candidate method forecasts from data available at that origin only, and errors are
scored against the published figure. Interval widths for the live forecast are the
empirical quantiles of those out-of-sample errors - not a model's own assumption.
"""
from __future__ import annotations

import warnings

import numpy as np
import pandas as pd

from .jalali import jalali_to_gregorian
from .paths import RAW

BASE_YEAR = 1395  # month index 0 = Farvardin 1395


def month_index(jy, jm):
    return (np.asarray(jy) - BASE_YEAR) * 12 + np.asarray(jm) - 1


def index_to_jalali(t: int) -> tuple[int, int]:
    return BASE_YEAR + t // 12, t % 12 + 1


def load_series() -> pd.DataFrame:
    cbi = pd.read_csv(RAW / "official" / "cbi_tehran_monthly.csv")
    kil = pd.read_csv(RAW / "official" / "kilid_tehran_monthly.csv")
    cbi["t"] = month_index(cbi.jalali_year, cbi.jalali_month)
    kil["t"] = month_index(kil.jalali_year, kil.jalali_month)
    last = int(max(cbi.t.max(), kil.t.max()))
    df = pd.DataFrame({"t": range(last + 1)})
    df["jalali_year"], df["jalali_month"] = zip(*[index_to_jalali(t) for t in df.t])
    df["date"] = [jalali_to_gregorian(y, m).isoformat() for y, m in zip(df.jalali_year, df.jalali_month)]
    df = df.merge(cbi[["t", "price_per_m2_toman", "transactions", "quality", "source_url"]]
                  .rename(columns={"price_per_m2_toman": "cbi", "quality": "cbi_quality",
                                   "source_url": "cbi_source"}), on="t", how="left")
    df = df.merge(kil[["t", "price_per_m2_toman"]].rename(columns={"price_per_m2_toman": "kilid"}),
                  on="t", how="left")
    df["cbi_yoy"] = df.cbi / df.cbi.shift(12) - 1
    df["kilid_mom"] = df.kilid / df.kilid.shift(1) - 1
    return df


# --------------------------------------------------------------------------- methods
# Each method takes a log-price Series indexed by month (NaN for missing months, ends
# at the origin with an observation) and returns log forecasts for h = 1..H.

def _obs(y: pd.Series) -> pd.Series:
    return y.dropna()


def naive(y: pd.Series, H: int) -> np.ndarray:
    return np.repeat(_obs(y).iloc[-1], H)


def drift_long(y: pd.Series, H: int) -> np.ndarray:
    o = _obs(y)
    g = (o.iloc[-1] - o.iloc[0]) / (o.index[-1] - o.index[0])
    return o.iloc[-1] + g * np.arange(1, H + 1)


def drift_12m(y: pd.Series, H: int) -> np.ndarray:
    o = _obs(y)
    past = o[o.index <= o.index[-1] - 12]
    ref = past if len(past) else o.iloc[:1]
    g = (o.iloc[-1] - ref.iloc[-1]) / (o.index[-1] - ref.index[-1])
    return o.iloc[-1] + g * np.arange(1, H + 1)


def holt_damped(y: pd.Series, H: int) -> np.ndarray:
    from statsmodels.tsa.holtwinters import ExponentialSmoothing
    o = _obs(y)
    z = y.loc[o.index[0]:o.index[-1]].interpolate()  # linear in logs across publication gaps
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        fit = ExponentialSmoothing(z.values, trend="add", damped_trend=True,
                                   initialization_method="estimated").fit()
    return np.asarray(fit.forecast(H))


def local_linear_trend(y: pd.Series, H: int) -> np.ndarray:
    from statsmodels.tsa.statespace.structural import UnobservedComponents
    o = _obs(y)
    z = y.loc[o.index[0]:o.index[-1]]  # NaNs are handled by the Kalman filter
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        fit = UnobservedComponents(z.values, level="local linear trend").fit(disp=False)
    return np.asarray(fit.forecast(H))


METHODS = {
    "naive": naive,
    "drift_long": drift_long,
    "drift_12m": drift_12m,
    "holt_damped": holt_damped,
    "local_linear_trend": local_linear_trend,
}

METHOD_LABELS = {
    "naive": ("No change", "بدون تغییر"),
    "drift_long": ("Long-run growth", "رشد بلندمدت"),
    "drift_12m": ("Last-12-month momentum", "تکانه‌ی ۱۲ ماه اخیر"),
    "holt_damped": ("Damped trend (Holt)", "روند میرا (هولت)"),
    "local_linear_trend": ("Local linear trend (Kalman)", "روند خطی محلی (کالمن)"),
}


def backtest(y: pd.Series, H: int = 12, min_history: int = 36) -> pd.DataFrame:
    """Rolling-origin evaluation. Returns one row per (origin, method, horizon) with an actual."""
    rows = []
    obs_idx = set(_obs(y).index)
    for origin in sorted(obs_idx):
        if origin < min_history:
            continue
        targets = [h for h in range(1, H + 1) if origin + h in obs_idx]
        if not targets:
            continue
        hist = y.loc[:origin]
        for name, fn in METHODS.items():
            try:
                f = fn(hist, H)
            except Exception:  # noqa: BLE001 - a method that cannot fit simply scores nothing
                continue
            for h in targets:
                err = f[h - 1] - y.loc[origin + h]
                rows.append({"origin": origin, "method": name, "h": h, "log_error": float(err),
                             "ape": float(abs(np.expm1(err)))})
    return pd.DataFrame(rows)


def leaderboard(bt: pd.DataFrame) -> pd.DataFrame:
    g = bt.groupby(["method", "h"]).ape.mean().unstack("h")
    out = pd.DataFrame({"mape_h1": g[1], "mape_h3": g[3], "mape_h6": g[6], "mape_h12": g[12],
                        "mape_avg_1_12": g[list(range(1, 13))].mean(axis=1)})
    if 24 in g:
        out["mape_h24"] = g[24]
    n = bt[bt.h == 12].groupby("method").size()
    out["origins_h12"] = n
    return out.sort_values("mape_h12")


def error_bands(bt: pd.DataFrame, method: str, H: int = 24) -> pd.DataFrame:
    """Empirical 10/25/75/90% quantiles of (actual / forecast) by horizon."""
    e = bt[bt.method == method].copy()
    e["ratio"] = np.exp(-e.log_error)  # actual / forecast
    q = e.groupby("h").ratio.quantile([0.1, 0.25, 0.75, 0.9]).unstack()
    q.columns = ["q10", "q25", "q75", "q90"]
    return q.reindex(range(1, H + 1)).interpolate().bfill().ffill()


def forecast_paths(y: pd.Series, H: int = 12) -> dict[str, np.ndarray]:
    return {name: np.exp(fn(y, H)) for name, fn in METHODS.items()}


def long_run_monthly_growth(y: pd.Series) -> float:
    """Average monthly log growth between the first and last published official months."""
    o = _obs(y)
    return float((o.iloc[-1] - o.iloc[0]) / (o.index[-1] - o.index[0]))


def trailing_growth(y: pd.Series, months: int = 12) -> float:
    o = _obs(y)
    past = o[o.index <= o.index[-1] - months]
    ref = past if len(past) else o.iloc[:1]
    return float((o.iloc[-1] - ref.iloc[-1]) / (o.index[-1] - ref.index[-1]))


def scenario_path(level: float, g_monthly_log: float, bands: pd.DataFrame, H: int) -> pd.DataFrame:
    h = np.arange(1, H + 1)
    mid = level * np.exp(g_monthly_log * h)
    b = bands.reindex(h)
    return pd.DataFrame({"h": h, "mid": mid, "q10": mid * b.q10.values, "q25": mid * b.q25.values,
                         "q75": mid * b.q75.values, "q90": mid * b.q90.values})
