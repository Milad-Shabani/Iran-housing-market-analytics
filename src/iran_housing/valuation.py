"""Hedonic valuation model trained on 3,4xx individual Divar listings.

Target: log(asking price). Features: log(area), rooms, parking, storage, elevator and
the neighbourhood's price level, log(median price per m2 of the *other* listings in
the neighbourhood). The neighbourhood level is target-encoded out-of-fold, so a
listing never sees its own price - without that, CV scores are inflated.

Three models are compared with the same 5-fold split:
  * hedonic OLS    - six coefficients, small enough to run in the browser;
  * gradient boosting (HistGradientBoosting) - a non-linear benchmark;
  * location only  - price = area x neighbourhood median; the baseline to beat.

The dashboard's pricing tool re-anchors the OLS model on 2024 neighbourhood levels
(see `to_browser`), so the structural premiums come from individual ads while the
price level comes from the 91,836 Tehran listings of 2024.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import LinearRegression
from sklearn.model_selection import KFold

FEATURES = ["log_area", "rooms", "parking", "storage", "elevator", "log_hood_ppm2"]
SHRINK = 5  # pseudo-listings pulling small neighbourhoods toward the district/city level


def _encode(train: pd.DataFrame, apply: pd.DataFrame) -> np.ndarray:
    """Shrunk neighbourhood log-ppm2 learned on `train`, applied to `apply`."""
    lp = np.log(train.ppm2)
    city = lp.median()
    by = pd.DataFrame({"k": train.address, "lp": lp}).groupby("k").lp.agg(["median", "size"])
    enc = (by["median"] * by["size"] + city * SHRINK) / (by["size"] + SHRINK)
    return apply.address.map(enc).fillna(city).to_numpy()


def _design(df: pd.DataFrame, hood: np.ndarray) -> pd.DataFrame:
    X = pd.DataFrame({"log_area": np.log(df.area_m2), "rooms": df.rooms, "parking": df.parking,
                      "storage": df.storage, "elevator": df.elevator, "log_hood_ppm2": hood},
                     index=df.index)
    return X[FEATURES]


def _metrics(y_log: np.ndarray, p_log: np.ndarray) -> dict:
    ape = np.abs(np.expm1(p_log - y_log))
    ss_res = np.sum((y_log - p_log) ** 2)
    ss_tot = np.sum((y_log - y_log.mean()) ** 2)
    return {"r2_log": float(1 - ss_res / ss_tot), "mape": float(ape.mean()),
            "median_ape": float(np.median(ape)), "within_20pct": float((ape <= 0.20).mean())}


def cross_validate(df: pd.DataFrame, folds: int = 5, seed: int = 7) -> tuple[dict, pd.DataFrame]:
    y = np.log(df.price_toman.to_numpy())
    oof = {k: np.zeros(len(df)) for k in ("hedonic_ols", "gradient_boosting", "location_only")}
    for tr, te in KFold(folds, shuffle=True, random_state=seed).split(df):
        a, b = df.iloc[tr], df.iloc[te]
        # inner out-of-fold encoding for the training rows themselves
        hood_tr = np.zeros(len(a))
        for itr, ite in KFold(folds, shuffle=True, random_state=seed + 1).split(a):
            hood_tr[ite] = _encode(a.iloc[itr], a.iloc[ite])
        hood_te = _encode(a, b)
        Xa, Xb = _design(a, hood_tr), _design(b, hood_te)
        ols = LinearRegression().fit(Xa, y[tr])
        oof["hedonic_ols"][te] = ols.predict(Xb)
        gb = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, max_leaf_nodes=15,
                                           min_samples_leaf=20, random_state=seed).fit(Xa, y[tr])
        oof["gradient_boosting"][te] = gb.predict(Xb)
        oof["location_only"][te] = np.log(b.area_m2.to_numpy()) + hood_te
    scores = {k: _metrics(y, v) for k, v in oof.items()}
    pred = df[["listing_id", "address", "area_m2", "price_toman"]].copy()
    for k, v in oof.items():
        pred[f"pred_{k}"] = np.exp(v)
    return scores, pred


def fit_final(df: pd.DataFrame, seed: int = 7) -> dict:
    """Fit OLS on all rows (out-of-fold encoding) and report coefficients with bootstrap CIs."""
    y = np.log(df.price_toman.to_numpy())
    hood = np.zeros(len(df))
    for tr, te in KFold(5, shuffle=True, random_state=seed).split(df):
        hood[te] = _encode(df.iloc[tr], df.iloc[te])
    X = _design(df, hood)
    ols = LinearRegression().fit(X, y)
    rng = np.random.default_rng(seed)
    boots = []
    for _ in range(300):
        i = rng.integers(0, len(df), len(df))
        boots.append(LinearRegression().fit(X.iloc[i], y[i]).coef_)
    boots = np.array(boots)
    resid = y - ols.predict(X)
    gb = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, max_leaf_nodes=15,
                                       min_samples_leaf=20, random_state=seed).fit(X, y)
    from sklearn.inspection import permutation_importance
    imp = permutation_importance(gb, X, y, n_repeats=10, random_state=seed)
    return {
        "intercept": float(ols.intercept_),
        "coef": {f: float(c) for f, c in zip(FEATURES, ols.coef_)},
        "coef_ci90": {f: [float(np.quantile(boots[:, j], 0.05)), float(np.quantile(boots[:, j], 0.95))]
                      for j, f in enumerate(FEATURES)},
        "residual_quantiles": {str(q): float(np.quantile(resid, q)) for q in (0.1, 0.25, 0.5, 0.75, 0.9)},
        "gb_permutation_importance": {f: float(m) for f, m in zip(FEATURES, imp.importances_mean)},
        "n": int(len(df)),
    }


def premiums(model: dict) -> dict:
    """Coefficients translated to plain percentage premiums."""
    c = model["coef"]
    return {"rooms_each": float(np.expm1(c["rooms"])), "parking": float(np.expm1(c["parking"])),
            "storage": float(np.expm1(c["storage"])), "elevator": float(np.expm1(c["elevator"])),
            "area_elasticity": c["log_area"], "hood_elasticity": c["log_hood_ppm2"],
            "ppm2_change_per_10pct_area": float(1.1 ** (c["log_area"] - 1) - 1)}


def to_browser(model: dict, oof_interval: dict) -> dict:
    """Parameters for the in-browser pricing tool.

    For a neighbourhood with 2024 median price per m2 H, median size A0, median rooms R0
    and amenity shares (p0, s0, e0), a unit (A, R, p, s, e) is priced as

        price = H * A0 * exp( b_area*(ln A - ln A0) + b_rooms*(R - R0)
                              + b_parking*(p - p0) + b_storage*(s - s0) + b_elevator*(e - e0) )

    i.e. the neighbourhood's typical listing is anchored exactly at its 2024 median,
    and the 2021 hedonic coefficients move the price away from it.
    """
    c = model["coef"]
    return {"b_area": c["log_area"], "b_rooms": c["rooms"], "b_parking": c["parking"],
            "b_storage": c["storage"], "b_elevator": c["elevator"],
            "interval": oof_interval}
