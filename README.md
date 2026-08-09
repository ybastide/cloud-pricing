# Cloud Pricing

A Vite+Svelte app to quickly compare cloud pricing.

## Features

- display AWS EC2 pricing
- future: display GCP pricing
- future: S3 pricing, including cross-region transfer pricing
- like https://instances.vantage.sh/

As an MVP, we will focus on AWS EC2 pricing and use the downloaded fixtures.

## Fixtures

See fixtures/aws, fetched with:

```shell
wget https://b0.p.awsstatic.com/partition-config/configuration.json
wget https://c0.b0.p.awsstatic.com/configurations/aws/ec2/on-demand-plan.json
wget https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/metadata.json
wget https://b0.p.awsstatic.com/locations/1.0/aws/current/locations.json
```
