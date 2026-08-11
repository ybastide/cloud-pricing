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
wget --compression=auto https://website.spot.ec2.aws.a2z.com/spot.json
BASE=https://b0.p.awsstatic.com
wget --compression=auto $BASE/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/US%20East%20%28N.%20Virginia%29/Linux/index.json
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

`index.json` is the per-`(region, OS)` artifact AWS serves under the `meteredUnitMaps`
path; the 106 locations x 17 operating systems in `metadata.json` are the selector
vocabulary, and each combination is a separate file. That is why multi-region
on-demand comparison is out of scope for the MVP.

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

All three HTML fixtures have had their `<script>` tags stripped after saving. Measured
against the pricing page before stripping: 74.8% of the file (32 MB of 43 MB) was
`<script>` content, none of the 76 `<table>` elements sit inside one, and regenerating
`instances.json`/`disks.json`/`hyperdisk-compat.json` from the stripped files produces
byte-identical output — confirmed, not assumed. Stripping isn't just a size win: a
signed-in Google session embeds account info (email, name, account ID) inline in
page-bootstrap `<script>` JSON, which is exactly how this project's own commit history
briefly carried a real email address before it was caught and scrubbed. Any future
re-save of these pages should go through the same stripping step before committing.

A `gitleaks` scan (run before considering this repo for public release) additionally
found 10 unique `AIza`-format Google API keys across the three fixtures — the same 8
keys appeared identically on both documentation pages, which strongly suggests they're
Google's own shared, embedded keys (client-library loader, language-switcher widget) and
not anything unique to this session, though that couldn't be independently confirmed
without testing the keys against a live API, which wasn't attempted. Most were already
gone once scripts were stripped; one survived in a `data-*` attribute on the pricing page
(outside any `<script>` tag) and was redacted along with the rest of history. Re-run
`gitleaks detect --source . --log-opts="--all"` after any future re-save, before
committing.

Run `npm run extract:gcp` to regenerate `instances.json`, `disks.json`, and
`hyperdisk-compat.json` from the two pricing/Hyperdisk HTML files (the CPU
platforms doc isn't read by the script — see above). Re-run it if either of
those two files is refreshed — the app only ever reads the generated JSON,
never the HTML directly.

## Tooling

- **Secret scanning and SAST**: `.pre-commit-config.yaml` runs `gitleaks` (secrets) and
  `semgrep` (`--config auto`) on every commit — install the hook once with
  `prek install` (or `pre-commit install`; both read the same config). `fixtures/` is
  excluded from semgrep only — it's third-party page data, not source code, and scanning
  a 10 MB HTML file with SAST rules just times out for nothing. Gitleaks is *not*
  excluded from fixtures on purpose: that's exactly the class of file that caused the
  leak documented above, so it should be re-scanned if one is ever touched again.
  `semgrep scan --config auto --error` also runs as a separate CI job
  (`.github/workflows/ci.yml`), using the free Community Edition rules — no account or
  token required.
- **Dependency and Actions updates**: `renovate.json` extends `config:recommended` +
  `helpers:pinGitHubActionDigests`. The config is in place but Renovate itself needs the
  GitHub App installed on this repo (or a self-hosted Action) once it's pushed to a
  remote — that's a one-time manual step, not something a config file alone can trigger.
  Once active, its first run opens a PR pinning any still-unpinned Actions to SHA; after
  that it keeps proposing updates as new versions ship.
- **GitHub Actions are pinned to commit SHA**, not a floating version tag, with the
  resolved version as a trailing comment (e.g. `actions/checkout@<sha> # v7.0.1`) — the
  standard defense against a tag being silently repointed by the action's own maintainer
  (the attack seen against `tj-actions/changed-files`). Renovate maintains these going
  forward; don't hand-edit a SHA without looking up the real commit first.

## Deployment

This is a fully static build — fixtures are baked into the JS/CSS bundle at build time,
so there is no backend and no env vars to configure. Any static file server works;
`deploy/nginx.conf.example` is a template for nginx behind certbot:

```shell
npm ci
npm run build      # -> dist/index.html, dist/assets/*.js, *.css (content-hashed names)
```

Copy `dist/`'s contents to the server (e.g. `/var/www/<your-domain>/`), then:

1. Point an A/AAAA record for the domain at the server *before* running certbot — its
   nginx plugin validates the hostname against DNS.
2. Copy `deploy/nginx.conf.example` to `/etc/nginx/sites-available/<your-domain>`,
   replace `YOUR_DOMAIN` and the `root` path, symlink into `sites-enabled/`, then
   `nginx -t && systemctl reload nginx`.
3. `certbot --nginx -d <your-domain>` — this rewrites the same server block in place to
   add the `443 ssl` server and, if accepted, an http→https redirect. Renewal is handled
   by the systemd timer/cron the certbot package installs; nothing else to configure.

Redeploying is just rebuilding and overwriting `dist/`'s contents on the server — no
nginx reload needed, since it only ever serves static files. The `try_files ... /index.html`
fallback in the template is a no-op today (filter/sort state lives in the query string on
a single route — see `urlState.js` — not in separate paths), kept in case that changes.
