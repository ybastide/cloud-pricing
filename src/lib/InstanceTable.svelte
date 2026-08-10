<script>
  const DEFAULT_COLUMNS = [
    { key: 'type', label: 'Instance', cellClass: 'type' },
    { key: 'vcpu', label: 'vCPU' },
    { key: 'memGiB', label: 'Memory', render: (row) => `${row.memGiB} GiB` },
    { key: 'storageGB', label: 'Storage', render: (row) => row.storage },
    { key: 'netGbps', label: 'Network', render: (row) => row.netLabel },
    { key: 'usd', label: 'Price', cellClass: 'price' },
  ]

  let { rows, sort, dir, unit, onsort, columns = DEFAULT_COLUMNS } = $props()

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

  function cell(row, column) {
    if (column.key === 'usd') return price(row)
    if (column.render) return column.render(row)
    return row[column.key]
  }

  function ariaSort(key) {
    if (sort !== key) return 'none'
    return dir === 'asc' ? 'ascending' : 'descending'
  }
</script>

<table>
  <thead>
    <tr>
      {#each columns as column (column.key)}
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
        {#each columns as column (column.key)}
          <td class={column.cellClass ?? ''}>{cell(row, column)}</td>
        {/each}
      </tr>
    {:else}
      <tr>
        <td colspan={columns.length} class="empty">
          No instances match these filters.
        </td>
      </tr>
    {/each}
  </tbody>
</table>
