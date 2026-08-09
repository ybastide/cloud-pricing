<script>
  let { rows, sort, dir, unit, onsort } = $props()

  const COLUMNS = [
    { key: 'type', label: 'Instance' },
    { key: 'vcpu', label: 'vCPU' },
    { key: 'memGiB', label: 'Memory' },
    { key: 'storageGB', label: 'Storage' },
    { key: 'netGbps', label: 'Network' },
    { key: 'usd', label: 'Price' },
  ]

  const hourly = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })

  const monthly = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  function price(row) {
    return unit === 'month' ? monthly.format(row.usd * 730) : hourly.format(row.usd)
  }

  function ariaSort(key) {
    if (sort !== key) return 'none'
    return dir === 'asc' ? 'ascending' : 'descending'
  }
</script>

<table>
  <thead>
    <tr>
      {#each COLUMNS as column (column.key)}
        <th aria-sort={ariaSort(column.key)}>
          <button type="button" onclick={() => onsort(column.key)}>
            {column.label}
            {#if column.key === 'usd'}<span class="unit">/{unit}</span>{/if}
            <span class="arrow" aria-hidden="true">
              {sort === column.key ? (dir === 'asc' ? '↑' : '↓') : ''}
            </span>
          </button>
        </th>
      {/each}
    </tr>
  </thead>
  <tbody>
    {#each rows as row (row.type)}
      <tr>
        <td class="type">{row.type}</td>
        <td>{row.vcpu}</td>
        <td>{row.memGiB} GiB</td>
        <td>{row.storage}</td>
        <td>{row.netLabel}</td>
        <td class="price">{price(row)}</td>
      </tr>
    {:else}
      <tr>
        <td colspan={COLUMNS.length} class="empty">
          No instances match these filters.
        </td>
      </tr>
    {/each}
  </tbody>
</table>
