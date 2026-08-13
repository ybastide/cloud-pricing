<script>
  import {
    families as awsFamilies,
    instances as awsInstances,
    operatingSystem,
    region as awsRegion,
  } from './lib/data/awsInstances.js'
  import {
    families as gcpFamilies,
    instances as gcpInstances,
    region as gcpRegion,
  } from './lib/data/gcpInstances.js'
  import { applyQuery } from './lib/data/query.js'
  import { fromSearchParams, toSearchParams } from './lib/data/urlState.js'
  import InstanceTable from './lib/InstanceTable.svelte'
  import Toolbar from './lib/Toolbar.svelte'
  import DiskPricingPanel from './lib/DiskPricingPanel.svelte'
  import HyperdiskCompatTable from './lib/HyperdiskCompatTable.svelte'

  const GCP_COLUMNS = [
    { key: 'type', label: 'Machine type', cellClass: 'type' },
    { key: 'vcpu', label: 'vCPU' },
    { key: 'memGiB', label: 'Memory', render: (row) => `${row.memGiB} GiB` },
    {
      key: 'storageGB',
      label: 'Local SSD',
      render: (row) => (row.storageGB > 0 ? `${row.storageGB} GiB` : ''),
    },
    { key: 'usd', label: 'Price', cellClass: 'price' },
  ]

  const PROVIDERS = {
    aws: {
      label: 'EC2 On-Demand Pricing',
      context: `${awsRegion} · ${operatingSystem}`,
      instances: awsInstances,
      families: awsFamilies,
      showArch: true,
      // undefined so Toolbar/InstanceTable fall through to their own AWS-shaped defaults
      placeholders: undefined,
      columns: undefined,
    },
    gcp: {
      label: 'GCP Compute On-Demand Pricing',
      context: gcpRegion,
      instances: gcpInstances,
      families: gcpFamilies,
      showArch: true,
      placeholders: {
        all: 'Filter by machine type, e.g. c4 or n2-standard',
        arm: 'Filter by machine type, e.g. c4a or n4a',
        x86: 'Filter by machine type, e.g. c4 or n2d',
      },
      columns: GCP_COLUMNS,
    },
  }

  let query = $state(fromSearchParams(window.location.search))

  const provider = $derived(PROVIDERS[query.provider] ?? PROVIDERS.aws)
  const visible = $derived(applyQuery(provider.instances, query))

  $effect(() => {
    const params = toSearchParams(query)
    const url = params ? `?${params}` : window.location.pathname
    window.history.replaceState(null, '', url)
  })

  $effect(() => {
    document.title = provider.label
  })

  $effect(() => {
    if (!provider.showArch && query.arch !== 'all') {
      query.arch = 'all'
    }
  })

  function sortBy(key) {
    if (query.sort === key) {
      query.dir = query.dir === 'asc' ? 'desc' : 'asc'
    } else {
      query.sort = key
      query.dir = key === 'type' ? 'asc' : 'desc'
    }
  }

  function switchProvider(next) {
    if (query.provider === next) return
    query.provider = next
    query.search = ''
    query.families = new Set()
    query.vcpuOp = '='
    query.vcpuVal = ''
    query.memOp = '='
    query.memVal = ''
  }
</script>

<header>
  <div class="tabs" role="tablist" aria-label="Cloud provider">
    {#each Object.keys(PROVIDERS) as key (key)}
      <button
        type="button"
        role="tab"
        aria-selected={query.provider === key}
        class:active={query.provider === key}
        onclick={() => switchProvider(key)}
      >
        {key.toUpperCase()}
      </button>
    {/each}
  </div>
  <h1>{provider.label}</h1>
  <p class="context">{provider.context}</p>
</header>

<main>
  <Toolbar
    bind:query
    families={provider.families}
    showArch={provider.showArch}
    placeholders={provider.placeholders}
  />
  <p class="count" role="status">{visible.length} of {provider.instances.length} instances</p>
  <InstanceTable
    rows={visible}
    sort={query.sort}
    dir={query.dir}
    unit={query.unit}
    onsort={sortBy}
    columns={provider.columns}
  />

  {#if query.provider === 'gcp'}
    <DiskPricingPanel />
    <HyperdiskCompatTable />
  {/if}
</main>
