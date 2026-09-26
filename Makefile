.PHONY: install pipeline dashboard test all sources geo

install:
	pip install -r requirements.txt

pipeline:
	python scripts/run_pipeline.py

dashboard:
	python scripts/build_dashboard.py

test:
	pytest -q

all: pipeline dashboard test

# Re-download the raw layer from the pinned upstream files, then rebuild the geo lookups.
sources:
	python scripts/fetch_sources.py

geo:
	python scripts/prepare_geo.py
