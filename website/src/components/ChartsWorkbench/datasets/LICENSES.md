# Dataset licences

Every dataset under `datasets/` is vendored (no runtime fetch) from a public source, captured at build time. Credit and licence per dataset:

| Dataset | Source | Licence |
|---|---|---|
| `globalTemperatureDataset` (`global-temperature`) | NASA GISS Surface Temperature Analysis (GISTEMP v4) — <https://data.giss.nasa.gov/gistemp/> | US public domain (NASA) |
| `co2MaunaLoaDataset` (`co2-mauna-loa`) | NOAA Global Monitoring Laboratory — <https://gml.noaa.gov/ccgg/trends/> | US public domain (NOAA) |
| `usUnemploymentDataset` (`us-unemployment`) | US Bureau of Labor Statistics, series UNRATE, via FRED (Federal Reserve Bank of St. Louis) — <https://fred.stlouisfed.org/series/UNRATE> | US public domain (BLS/FRED) |
| `worldPopulationByCountryDataset` (`world-population-by-country`) | World Bank Open Data, indicator SP.POP.TOTL — <https://data.worldbank.org/indicator/SP.POP.TOTL> | CC BY 4.0 (World Bank) |
| `renewableElectricityShareDataset` (`renewable-electricity-share`) | Our World in Data / Ember, "Share of electricity from renewables" — <https://ourworldindata.org/grapher/share-electricity-renewables> | CC BY 4.0 (Our World in Data) |
| `treasuryYield10yDataset` (`treasury-yield-10y`) | US Department of the Treasury, Daily Treasury Par Yield Curve Rates — <https://home.treasury.gov/resource-center/data-chart-center/interest-rates> | US public domain (US Treasury) |
| `olympics2024MedalsDataset` (`olympics-2024-medals`) | Wikipedia, "2024 Summer Olympics medal table" — <https://en.wikipedia.org/wiki/2024_Summer_Olympics_medal_table> | CC BY-SA 4.0 (Wikipedia) |
| `irisFlowersDataset` (`iris-flowers`) | Hugging Face datasets, `scikit-learn/iris` (originally the UCI Machine Learning Repository's Iris dataset) — <https://huggingface.co/datasets/scikit-learn/iris> | Public domain (UCI Machine Learning Repository) |

Each dataset's own `source` field (`{ name, url, licence }`) carries this same credit at runtime — the Data folder's dataset picker shows it as a link under the description.

`renewableElectricityShareDataset` covers 1985-2025, matching the cited source's own published range — Ember (and the Energy Institute Statistical Review behind it) begin in the mid-1980s, so there is no real world-renewable-share datapoint for earlier years to vendor (P2-2).
