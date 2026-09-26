"""Project paths, resolved from the package location so scripts work from any cwd."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
RAW = DATA / "raw"
GEO = DATA / "geo"
PROCESSED = DATA / "processed"
DASHBOARD = ROOT / "dashboard"
SITE = ROOT / "site"
DOCS = ROOT / "docs"
