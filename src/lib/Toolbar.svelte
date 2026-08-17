<script>
  import { parseFilterTokens } from './data/query.js'

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

  /**
     * @param {string} family
     */
  function toggleFamily(family) {
    const next = new Set(query.families)
    if (next.has(family)) next.delete(family)
    else next.add(family)
    query.families = next
  }

  /**
     * @type {number | undefined}
     */
  let debounceTimer

  /**
     * @param {string} value
     */
  function onSearchInput(value) {
    query.search = value
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      const { text, vcpu, mem } = parseFilterTokens(query.search)
      query.search = text
      if (vcpu) {
        query.vcpuOp = vcpu.op
        query.vcpuVal = String(vcpu.val)
      }
      if (mem) {
        query.memOp = mem.op
        query.memVal = String(mem.val)
      }
    }, 350)
  }

  function clear() {
    query.search = ''
    query.families = new Set()
    query.arch = 'all'
    query.vcpuOp = '='
    query.vcpuVal = ''
    query.memOp = '='
    query.memVal = ''
  }

  const filtering = $derived(
    query.search !== '' ||
      query.families.size > 0 ||
      query.arch !== 'all' ||
      query.vcpuVal !== '' ||
      query.memVal !== '',
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
    value={query.search}
    oninput={(e) => onSearchInput(e.currentTarget.value)}
    aria-label="Filter by instance type"
  />

  <div class="numeric-filter" role="group" aria-label="vCPU filter">
    <span class="numeric-filter-label">vCPU</span>
    <select bind:value={query.vcpuOp} aria-label="vCPU operator">
      <option value="=">=</option>
      <option value=">=">≥</option>
    </select>
    <input
      type="number"
      min="0"
      step="any"
      value={query.vcpuVal}
      oninput={(e) => (query.vcpuVal = e.currentTarget.value)}
      aria-label="vCPU value"
    />
  </div>

  <div class="numeric-filter" role="group" aria-label="Memory filter">
    <span class="numeric-filter-label">Memory</span>
    <select bind:value={query.memOp} aria-label="Memory operator">
      <option value="=">=</option>
      <option value=">=">≥</option>
    </select>
    <input
      type="number"
      min="0"
      step="any"
      value={query.memVal}
      oninput={(e) => (query.memVal = e.currentTarget.value)}
      aria-label="Memory value"
    />
    <span class="numeric-filter-unit">GiB</span>
  </div>

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
