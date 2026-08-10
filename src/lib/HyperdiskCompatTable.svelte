<script>
  import compat from '../../fixtures/gcp/hyperdisk-compat.json'

  const COLUMNS = [
    { key: 'balanced', label: 'Balanced' },
    { key: 'balancedHA', label: 'Balanced HA' },
    { key: 'extreme', label: 'Extreme' },
    { key: 'throughput', label: 'Throughput' },
    { key: 'ml', label: 'ML' },
  ]
</script>

<section class="reference-panel">
  <h2>Hyperdisk compatibility</h2>
  <table>
    <thead>
      <tr>
        <th>Machine series</th>
        {#each COLUMNS as column (column.key)}<th>{column.label}</th>{/each}
      </tr>
    </thead>
    <tbody>
      {#each compat as row (row.series)}
        <tr>
          <td class="type">{row.series}</td>
          {#each COLUMNS as column (column.key)}
            <td>{row[column.key] ? '✓' : '—'}</td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</section>
