"""Solar Hijri (Jalali) <-> Gregorian conversion for month-level series.

Iranian official statistics are published by Jalali month; charts need a real time
axis, so every Jalali month is anchored to the Gregorian date of its first day.
Algorithm: the standard arithmetic conversion (Borkowski / jdf), exact for 1-3000 AP.
"""
from __future__ import annotations

from datetime import date

_BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262,
           2324, 2394, 2456, 3178]


def _jal_cal(jy: int) -> tuple[int, int, int]:
    """Return (leap, gregorian year, march day) for Jalali year jy (from the jalaali-js algorithm)."""
    gy = jy + 621
    leap_j = -14
    jp = _BREAKS[0]
    jump = 0
    for jm in _BREAKS[1:]:
        jump = jm - jp
        if jy < jm:
            break
        leap_j += (jump // 33) * 8 + ((jump % 33) // 4)
        jp = jm
    n = jy - jp
    leap_j += (n // 33) * 8 + (((n % 33) + 3) // 4)
    if jump % 33 == 4 and jump - n == 4:
        leap_j += 1
    leap_g = gy // 4 - ((gy // 100 + 1) * 3) // 4 - 150
    march = 20 + leap_j - leap_g
    if jump - n < 6:
        n = n - jump + ((jump + 4) // 33) * 33
    leap = (((n + 1) % 33) - 1) % 4
    if leap == -1:
        leap = 4
    return leap, gy, march


def jalali_to_gregorian(jy: int, jm: int, jd: int = 1) -> date:
    _, gy, march = _jal_cal(jy)
    day_of_year = (jm - 1) * 31 - (jm // 7) * (jm - 7) + jd - 1  # 0-based day inside the Jalali year
    start = date(gy, 3, march)
    return date.fromordinal(start.toordinal() + day_of_year)


def month_label(jy: int, jm: int) -> str:
    return f"{jy}/{jm:02d}"


MONTHS_EN = ["Farvardin", "Ordibehesht", "Khordad", "Tir", "Mordad", "Shahrivar",
             "Mehr", "Aban", "Azar", "Dey", "Bahman", "Esfand"]
MONTHS_FA = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
             "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"]
