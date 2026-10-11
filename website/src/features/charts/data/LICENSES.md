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

The eight datasets above the line were added to give every `@glyphcss/charts` mark type (`CHART_MARK_TYPES`) at least one dataset that recommends it — see `datasets.test.ts`'s "mark-type coverage" describe block for the full map and the two mark types (`text`, `rule`) deliberately left uncovered, with why.

## 3D datasets — `datasets/chart3d/`

Eight datasets, separate from the 16 above (a `Chart3dDataset` is a discriminated union keyed on `markType`, one shape per `@glyphcss/charts/3d` mark constructor — never a `ChartsDatasetRow[]` — AGENTS.md's "Charts 3D"), for `/charts`' 3D preset tray, one or more per mark type (packet C6):

| Dataset | Source | Licence |
|---|---|---|
| `maungaWhauVolcanoDataset` (`maunga-whau-volcano`, `surface`) | R's built-in `datasets::volcano` (87x61, 10m grid) — captured from `volcano.csv` in the plotly/datasets repo — <https://github.com/plotly/datasets/blob/master/volcano.csv> | **Never "MIT-only"** — two different licences for two different things: Plotly's own file packaging (the `volcano.csv` this was captured from) is MIT; the dataset's governing provenance is R's base `datasets` package, licensed GPL-2 \| GPL-3 — "digitized from a topographic map by Ross Ihaka", per R's own `?datasets::volcano` docs |
| `etopo1AlpsDataset` (`etopo1-alps`, `surface`) | NOAA NCEI (ETOPO1), extracted from this repo's OWN baked terrain pyramid (`website/public/data/geo-tiles/curated/7/66_31.bin`, the curated Switzerland z7 tile, around the Matterhorn) — <https://www.ngdc.noaa.gov/mgg/global/> | Public domain (NOAA) |
| `tiltedPlaneDataset` (`tilted-plane`, `surface`) | Computed example — a reference plane `z = 0.35x + 0.55y + 1` over an even grid, no external source | N/A — generated by this repository's own math, not sourced data |
| `irisScatter3dDataset` (`iris-scatter-3d`, `scatter3d`) | REUSES `irisFlowersDataset`'s own vendored rows verbatim (`../irisFlowers.ts`) — Hugging Face `scikit-learn/iris`, originally the UCI Machine Learning Repository's Iris dataset — <https://huggingface.co/datasets/scikit-learn/iris> | Public domain (UCI Machine Learning Repository) |
| `olympicsColumns3dDataset` (`olympics-2024-columns-3d`, `bars3d`) | REUSES `olympics2024MedalsByTypeDataset`'s own vendored rows (`../olympics2024MedalsByType.ts`), reshaped to numeric bar positions with the country/medal name riding on `xLabel`/`yLabel` — Wikipedia, "2024 Summer Olympics medal table" — <https://en.wikipedia.org/wiki/2024_Summer_Olympics_medal_table> | CC BY-SA 4.0 (Wikipedia) |
| `sphereParametric3dDataset` (`sphere-parametric-3d`, `parametric3d`) | Computed example — a unit sphere sampled via `glyphChart3dSphereGrid`, coloured by the l=2, m=0 real spherical harmonic, no external source | N/A — generated by this repository's own math, not sourced data |
| `torusParametric3dDataset` (`torus-parametric-3d`, `parametric3d`) | Computed example — a torus sampled via `glyphChart3dTorusGrid`, no external source | N/A — generated by this repository's own math, not sourced data |
| `lorenzAttractorDataset` (`lorenz-attractor`, `line3d`) | Computed example — `glyphChart3dLorenzAttractor` (classic sigma=10, rho=28, beta=8/3 parameters, fixed-step Euler integration), no external source | N/A — generated by this repository's own math, not sourced data |

`irisScatter3dDataset` and `olympicsColumns3dDataset` carry no separate verification step of their own — they reuse the SAME rows the credited 2D datasets above already vendor, so their licence is that dataset's licence, unchanged. Every other 3D dataset above the tilted-plane row down is a computed reference example (labelled as such in its own `description`), never vendored or fetched data, mirroring `packages/charts/fixtures/3d/LICENSES.md`'s own "SYNTHETIC, not real data" convention for a case where no real dataset's licence could be verified — a sphere/torus/plane/attractor has no natural "real dataset" to reach for in the first place.

Curated Hugging Face datasets verified (a real HTTP round trip against `datasets-server.huggingface.co`, per-column dtypes inspected) to carry three or more numeric columns for `/charts`' 3D dataset search suggestions (`datasets/chart3dRemoteIndex.ts`) — see that file's own header for the exact verification method:

| Dataset | Numeric columns confirmed | Licence |
|---|---|---|
| `scikit-learn/iris` | 4 (sepal/petal length/width) + `Species` categorical | Public domain (UCI Machine Learning Repository) |
| `mstz/wine` | 13 (physicochemical wine measurements) | See `mstz/wine`'s own Hugging Face card (UCI Wine Quality dataset) |
| `mstz/seeds` | 7 (wheat kernel geometry) + `class` categorical (3 varieties) | See `mstz/seeds`'s own Hugging Face card (UCI Seeds dataset) |
| `mstz/abalone` | 8 (physical measurements) + `sex` categorical | See `mstz/abalone`'s own Hugging Face card (UCI Abalone dataset) |
| `mstz/glass` | 9 (oxide content) + `glass_type` categorical | See `mstz/glass`'s own Hugging Face card (UCI Glass Identification dataset) |
