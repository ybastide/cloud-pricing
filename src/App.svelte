<script>
  import { instances, operatingSystem, region } from './lib/data/instances.js'
  import { applyQuery } from './lib/data/query.js'
  import { defaultQuery } from './lib/data/urlState.js'
  import InstanceTable from './lib/InstanceTable.svelte'

  let query = $state(defaultQuery())

  const visible = $derived(applyQuery(instances, query))

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
  <p class="count">{visible.length} of {instances.length} instances</p>
  <InstanceTable
    rows={visible}
    sort={query.sort}
    dir={query.dir}
    unit={query.unit}
    onsort={sortBy}
  />
</main>
