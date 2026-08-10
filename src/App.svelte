<script>
  import { families, instances, operatingSystem, region } from './lib/data/instances.js'
  import { applyQuery } from './lib/data/query.js'
  import { fromSearchParams, toSearchParams } from './lib/data/urlState.js'
  import InstanceTable from './lib/InstanceTable.svelte'
  import Toolbar from './lib/Toolbar.svelte'

  let query = $state(fromSearchParams(window.location.search))

  const visible = $derived(applyQuery(instances, query))

  $effect(() => {
    const params = toSearchParams(query)
    const url = params ? `?${params}` : window.location.pathname
    window.history.replaceState(null, '', url)
  })

  function sortBy(key) {
    if (query.sort === key) {
      query.dir = query.dir === 'asc' ? 'desc' : 'asc'
    } else {
      query.sort = key
      query.dir = key === 'type' ? 'asc' : 'desc'
    }
  }
</script>

<header>
  <h1>EC2 On-Demand Pricing</h1>
  <p class="context">{region} &middot; {operatingSystem}</p>
</header>

<main>
  <Toolbar bind:query {families} />
  <p class="count" role="status">{visible.length} of {instances.length} instances</p>
  <InstanceTable
    rows={visible}
    sort={query.sort}
    dir={query.dir}
    unit={query.unit}
    onsort={sortBy}
  />
</main>
