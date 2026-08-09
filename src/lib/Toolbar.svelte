<script>
  let { query = $bindable(), families } = $props()

  function toggleFamily(family) {
    const next = new Set(query.families)
    if (next.has(family)) next.delete(family)
    else next.add(family)
    query.families = next
  }

  function clear() {
    query.search = ''
    query.families = new Set()
    query.arch = 'all'
  }

  const filtering = $derived(
    query.search !== '' || query.families.size > 0 || query.arch !== 'all',
  )

  const ARCHES = [
    { value: 'all', label: 'All' },
    { value: 'arm', label: 'ARM' },
    { value: 'x86', label: 'x86' },
  ]

  const PLACEHOLDERS = {
    all: 'Filter by instance type, e.g. m5 or 4xlarge',
    arm: 'Filter by instance type, e.g. c7g or m8g',
    x86: 'Filter by instance type, e.g. m5 or c7i',
  }

  const placeholder = $derived(PLACEHOLDERS[query.arch] ?? PLACEHOLDERS.all)
</script>

<div class="toolbar">
  <input
    type="search"
    placeholder={placeholder}
    bind:value={query.search}
    aria-label="Filter by instance type"
  />

  <div class="units" role="group" aria-label="Processor architecture">
    {#each ARCHES as option (option.value)}
      <button
        type="button"
        class:active={query.arch === option.value}
        aria-pressed={query.arch === option.value}
        onclick={() => (query.arch = option.value)}
      >
        {option.label}
      </button>
    {/each}
  </div>

  <div class="units" role="group" aria-label="Price unit">
    <button
      type="button"
      class:active={query.unit === 'hour'}
      onclick={() => (query.unit = 'hour')}
    >
      $/hour
    </button>
    <button
      type="button"
      class:active={query.unit === 'month'}
      onclick={() => (query.unit = 'month')}
    >
      $/month
    </button>
  </div>
</div>

<div class="families">
  {#each families as family (family)}
    <button
      type="button"
      class="chip"
      class:active={query.families.has(family)}
      aria-pressed={query.families.has(family)}
      onclick={() => toggleFamily(family)}
    >
      {family}
    </button>
  {/each}

  {#if filtering}
    <button type="button" class="chip clear" onclick={clear}>Clear</button>
  {/if}
</div>
