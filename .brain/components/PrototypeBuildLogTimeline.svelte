<script lang="ts">
  import PrototypeBuildLogEntry from "./PrototypeBuildLogEntry.svelte";
  import { getPrototypeBuildLogContext } from "./PrototypeBuildLogProvider.svelte";

  const buildLog = getPrototypeBuildLogContext();
  const filters = $derived(buildLog.data.filters);
  const selectedFilter = $derived(buildLog.data.selectedFilter);
  const visibleEntries = $derived(buildLog.data.visibleEntries);
  const filteredEntries = $derived(buildLog.data.filteredEntries);
  const hasMore = $derived(buildLog.data.hasMore);

  function selectFilter(event: MouseEvent, filter: (typeof filters)[number]) {
    event.stopPropagation();
    buildLog.actions.setFilter(filter);
  }

  function showMore(event: MouseEvent) {
    event.stopPropagation();
    buildLog.actions.showMore();
  }
</script>

<section class="build-log-timeline">
  <header>
    <div>
      <p class="eyebrow">Timeline</p>
      <h2>{filteredEntries.length} entries in {selectedFilter}</h2>
    </div>
    <div class="filters" aria-label="Build log filters">
      {#each filters as filter}
        <button
          type="button"
          data-no-block-select
          class:active={filter === selectedFilter}
          aria-pressed={filter === selectedFilter}
          onclick={(event) => selectFilter(event, filter)}
        >
          {filter}
        </button>
      {/each}
    </div>
  </header>

  {#if visibleEntries.length === 0}
    <p class="empty">No build-log entries match this filter.</p>
  {:else}
    <div class="entries">
      {#each visibleEntries as entry, index (entry.id)}
        <PrototypeBuildLogEntry {entry} initiallyOpen={index === 0} />
      {/each}
    </div>
  {/if}

  {#if hasMore}
    <button class="more" type="button" data-no-block-select onclick={showMore}>Show more entries</button>
  {/if}
</section>

<style>
  .build-log-timeline {
    display: grid;
    gap: 1rem;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .eyebrow {
    margin: 0 0 .25rem;
    color: #64748b;
    font-size: .75rem;
    letter-spacing: .08em;
    text-transform: uppercase;
  }

  h2 {
    margin: 0;
    font-size: 1.2rem;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: .45rem;
  }

  button {
    border: 1px solid #cbd5e1;
    border-radius: 999px;
    background: white;
    color: #111827;
    padding: .45rem .75rem;
    font: inherit;
    cursor: pointer;
  }

  button.active,
  button:hover {
    background: #111827;
    color: white;
  }

  .entries {
    display: grid;
    gap: .85rem;
  }

  .empty {
    border: 1px solid #e5e7eb;
    border-radius: 14px;
    padding: 1rem;
    background: white;
  }

  .more {
    justify-self: start;
  }
</style>
