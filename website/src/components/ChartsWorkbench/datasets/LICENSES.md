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
| `energyFlowSankeyDataset` (`energy-flow-sankey`) | glyphcss project, `packages/charts/src/flowMarksData.ts`'s `ENERGY_FLOW_SANKEY_DATA` — illustrative figures shaped like a real national energy balance, not one country's actual reported quantities | MIT (glyphcss project) |
| `ecommerceConversionFunnelDataset` (`ecommerce-conversion-funnel`) | glyphcss project, `packages/charts/src/flowMarksData.ts`'s `ECOMMERCE_FUNNEL_DATA` — figures consistent with commonly cited e-commerce conversion benchmarks | MIT (glyphcss project) |
| `globalElectricityMixDataset` (`global-electricity-mix`) | Our World in Data / Ember, Yearly Electricity Data — <https://ourworldindata.org/grapher/electricity-prod-source-stacked> | CC BY 4.0 (Our World in Data) |
| `cityMonthlyTemperaturesDataset` (`city-monthly-temperatures`) | NOAA National Centers for Environmental Information, 1991-2020 U.S. Climate Normals, via each city's own NOAA-cited Wikipedia "Climate data" table — <https://www.ncei.noaa.gov/products/land-based-station/us-climate-normals> | US public domain (NOAA); compiled via Wikipedia (CC BY-SA 4.0) |
| `gdpLifeExpectancy2007Dataset` (`gdp-life-expectancy-2007`) | Gapminder Foundation, via the `gapminder` R/Python package — <https://www.gapminder.org/data/> | CC BY 4.0 (Gapminder Foundation) |
| `energyConsumptionBySourceDataset` (`energy-consumption-by-source`) | Our World in Data, based on the Energy Institute Statistical Review of World Energy — <https://ourworldindata.org/grapher/primary-sub-energy-source> | CC BY 4.0 (Our World in Data) |
| `gdpGrowth2020CrisisDataset` (`gdp-growth-2020-crisis`) | World Bank national accounts data, indicator NY.GDP.MKTP.KD.ZG — <https://data.worldbank.org/indicator/NY.GDP.MKTP.KD.ZG> | CC BY 4.0 (World Bank) |
| `olympics2024MedalsByTypeDataset` (`olympics-2024-medals-by-type`) | Wikipedia, "2024 Summer Olympics medal table" (same figures as `olympics2024MedalsDataset`, reshaped long-format) — <https://en.wikipedia.org/wiki/2024_Summer_Olympics_medal_table> | CC BY-SA 4.0 (Wikipedia) |

Each dataset's own `source` field (`{ name, url, licence }`) carries this same credit at runtime — the Data folder's dataset picker shows it as a link under the description.

`renewableElectricityShareDataset` covers 1985-2025, matching the cited source's own published range — Ember (and the Energy Institute Statistical Review behind it) begin in the mid-1980s, so there is no real world-renewable-share datapoint for earlier years to vendor (P2-2).

The eight datasets above the line were added to give every `@glyphcss/charts` mark type (`CHART_MARK_TYPES`) at least one dataset that recommends it — see `datasets.test.ts`'s "mark-type coverage" describe block for the full map and the three mark types (`rect`, `text`, `rule`) deliberately left uncovered, with why.

## 3D (surface) datasets — `datasets/chart3d/`

Two datasets, separate from the 16 above (a `Chart3dDataset` is a `z(x, y)` grid, not a `ChartsDatasetRow[]` — AGENTS.md's "Charts 3D"), for `/charts`' 3D preset tray:

| Dataset | Source | Licence |
|---|---|---|
| `maungaWhauVolcanoDataset` (`maunga-whau-volcano`) | R's built-in `datasets::volcano` (87x61, 10m grid) — captured from `volcano.csv` in the plotly/datasets repo — <https://github.com/plotly/datasets/blob/master/volcano.csv> | MIT (plotly/datasets repackaging); the original digitization ("Digitized from a topographic map by Ross Ihaka", per R's own `?datasets::volcano` docs) is part of R's base `datasets` package, licensed GPL-2 \| GPL-3 — **verify GPL compatibility before treating this file as MIT-only**, since the repackaging licence and the underlying data's own licence are not the same thing |
| `etopo1AlpsDataset` (`etopo1-alps`) | NOAA NCEI (ETOPO1), extracted from this repo's OWN baked terrain pyramid (`website/public/data/geo-tiles/curated/7/66_31.bin`, the curated Switzerland z7 tile, around the Matterhorn) — <https://www.ngdc.noaa.gov/mgg/global/> | Public domain (NOAA) |
