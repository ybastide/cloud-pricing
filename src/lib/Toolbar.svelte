<script>
  const DEFAULT_PLACEHOLDERS = {
    all: 'Filter by instance type, e.g. m5 or 4xlarge',
    arm: 'Filter by instance type, e.g. c7g or m8g',
    x86: 'Filter by instance type, e.g. m5 or c7i',
  }

  let {
    query = $bindable(),
    families,
    showArch = true,
    placeholders = DEFAULT_PLACEHOLDERS,
  } = $props()

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

  const placeholder = $derived(placeholders[query.arch] ?? placeholders.all)
</script>

<div class="toolbar">
  <input
    type="search"
    {placeholder}
    bind:value={query.search}
    aria-label="Filter by instance type"
  />

  {#if showArch}
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
  {/if}

  <div class="units" role="group" aria-label="Price unit">
    <button
      type="button"
      class:active={query.unit === 'hour'}
      aria-pressed={query.unit === 'hour'}
      onclick={() => (query.unit = 'hour')}
    >
      $/hour
    </button>
    <button
      type="button"
      class:active={query.unit === 'month'}
      aria-pressed={query.unit === 'month'}
      onclick={() => (query.unit = 'month')}
    >
      $/month
    </button>
  </div>
</div>

<div class="families" role="group" aria-label="Instance family">
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
