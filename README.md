# Cloud Pricing

A Vite+Svelte app to quickly compare cloud pricing.

## Features

- display AWS EC2 pricing
- display GCP Compute Engine pricing
- future: S3 pricing, including cross-region transfer pricing
- like https://instances.vantage.sh/

Both providers are served entirely from checked-in fixtures — no network calls at
runtime.

## Fixtures

### AWS

See `fixtures/aws`. Six files, fetched with:

```shell
BASE=https://b0.p.awsstatic.com
wget --compression=auto $BASE/partition-config/configuration.json
wget --compression=auto https://c0.b0.p.awsstatic.com/configurations/aws/ec2/on-demand-plan.json
wget --compression=auto $BASE/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/metadata.json
wget --compression=auto $BASE/locations/1.0/aws/current/locations.json
```

`--compression=auto` matters: without it wget saves the `Content-Encoding: gzip`
body raw, producing a gzip file with a `.json` extension that `fetch` and
`import` both choke on.

| File | Contents |
| --- | --- |
| `index.json` | 1322 on-demand rows — us-east-1 / Linux only. The price data. |
| `spot.json` | Spot prices, 40 regions x linux/mswin. No instance specs. |
| `locations.json` | 109 locations: display name → region code, continent. |
| `metadata.json` | Selector vocabulary: 106 locations, 17 operating systems. |
| `on-demand-plan.json` | Table column labels and display order. |
| `configuration.json` | AWS pricing origin base URLs. |

`index.json` and `spot.json` are not in the wget list above — their exact source
URLs were not recorded. `index.json` is the per-`(region, OS)` artifact AWS
serves under the `meteredUnitMaps` path; the 106 locations x 17 operating
systems in `metadata.json` are the selector vocabulary, and each combination is
a separate file. That is why multi-region on-demand comparison is out of scope
for the MVP.

### GCP

See `fixtures/gcp`. Four files — none of them fetched with `wget`, since GCP
doesn't expose a comparable public JSON endpoint (Google retired the old
`cloudpricingcalculator.appspot.com` calculator and its static data files along
with it). Instead:

- `General Purpose VM pricing _ Google Cloud.html` and `Google Cloud Hyperdisk
  overview _ Compute Engine _ Google Cloud Documentation.html` are full-page
  saves of the rendered pricing/documentation pages (File → Save Page As, with
  JS already executed), frozen at whatever region was selected when saved
  (**Iowa / us-central1** for the pricing page).
- `CPU platforms _ Compute Engine _ Google Cloud Documentation.html` is Google's
  official machine-series-to-CPU-platform reference — not read by the extraction
  script, consulted by hand to verify which GCP families are Arm (`C4A`, `N4A`,
  `Tau T2A`) vs. x86. Kept committed so that verification is checkable, not just
  described.
- `Pricing for My Billing Account.csv` is GCP's full SKU catalog, exported from
  a Cloud Billing account. **Not used by the app** — see the design spec for why.

Run `npm run extract:gcp` to regenerate `instances.json`, `disks.json`, and
`hyperdisk-compat.json` from the two pricing/Hyperdisk HTML files (the CPU
platforms doc isn't read by the script — see above). Re-run it if either of
those two files is refreshed — the app only ever reads the generated JSON,
never the HTML directly.
