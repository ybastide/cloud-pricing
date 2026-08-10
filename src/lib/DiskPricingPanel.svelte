<script>
  import disks from '../../fixtures/gcp/disks.json'

  const RATE_LABELS = {
    space: '$/GiB-hour',
    iops: '$/hour (IOPS)',
    throughput: '$/hour (throughput)',
  }

  const price = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 6,
    maximumFractionDigits: 9,
  })
</script>

<section class="reference-panel">
  <h2>Disk pricing</h2>
  <table>
    <thead>
      <tr><th>Disk type</th><th>Rate</th><th>Price</th></tr>
    </thead>
    <tbody>
      {#each disks as disk (disk.name)}
        <tr>
          <td class="type">{disk.name}</td>
          <td>{RATE_LABELS[disk.rateType]}</td>
          <td class="price">{price.format(disk.usd)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>
