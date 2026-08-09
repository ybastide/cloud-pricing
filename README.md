# Cloud Pricing

A Vite+Svelte app to quickly compare cloud pricing.

## Features

- display AWS EC2 pricing
- future: display GCP pricing
- future: S3 pricing, including cross-region transfer pricing
- like https://instances.vantage.sh/

As an MVP, we will focus on AWS EC2 pricing and use the downloaded fixtures.

## Fixtures

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
