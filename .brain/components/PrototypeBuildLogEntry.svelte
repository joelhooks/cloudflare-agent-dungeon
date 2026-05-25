<script lang="ts">
  import type { PrototypeBuildLogEntry } from "./PrototypeBuildLogProvider.svelte";

  type Props = {
    entry: PrototypeBuildLogEntry;
    initiallyOpen?: boolean;
  };

  let { entry, initiallyOpen = false }: Props = $props();
</script>

<article class="build-log-entry" data-kind={entry.kind}>
  <header>
    <div>
      <p class="meta"><time datetime={entry.date}>{entry.date}</time> · <span>{entry.kind}</span></p>
      <h3>{entry.title}</h3>
    </div>
    <code>{entry.id}</code>
  </header>

  {#if entry.summary}
    <p class="summary">{entry.summary}</p>
  {/if}

  <details open={initiallyOpen}>
    <summary>Read entry sections</summary>
    <div class="sections">
      {#each entry.sections as section}
        <section>
          <h4>{section.heading}</h4>
          <pre>{section.body}</pre>
        </section>
      {/each}
    </div>
  </details>

  <footer>
    <span>source <code>{entry.sourcePath}</code></span>
    {#if entry.migratedFrom}
      <span>migrated from <code>{entry.migratedFrom}</code></span>
    {/if}
  </footer>
</article>

<style>
  .build-log-entry {
    display: grid;
    gap: .8rem;
    border: 1px solid #e5e7eb;
    border-left: 5px solid #64748b;
    border-radius: 16px;
    background: #fff;
    color: #111827;
    padding: 1rem;
  }

  .build-log-entry[data-kind="fix"] { border-left-color: #dc2626; }
  .build-log-entry[data-kind="build"] { border-left-color: #2563eb; }
  .build-log-entry[data-kind="runtime"] { border-left-color: #7c3aed; }
  .build-log-entry[data-kind="memory"] { border-left-color: #16a34a; }
  .build-log-entry[data-kind="research"] { border-left-color: #ca8a04; }

  header,
  footer {
    display: flex;
    justify-content: space-between;
    gap: .75rem;
    flex-wrap: wrap;
  }

  .meta {
    margin: 0 0 .2rem;
    color: #64748b;
    font-size: .78rem;
    letter-spacing: .06em;
    text-transform: uppercase;
  }

  h3 {
    margin: 0;
    font-size: 1.2rem;
    line-height: 1.2;
  }

  .summary {
    margin: 0;
    color: #374151;
    line-height: 1.55;
  }

  details {
    border: 1px solid #edf0f4;
    border-radius: 12px;
    background: #f8fafc;
    padding: .75rem;
  }

  summary {
    cursor: pointer;
    font-weight: 700;
  }

  .sections {
    display: grid;
    gap: .8rem;
    margin-top: .75rem;
  }

  h4 {
    margin: 0 0 .3rem;
    color: #334155;
    font-size: .9rem;
    letter-spacing: .04em;
    text-transform: uppercase;
  }

  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font: 0.9rem/1.55 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    color: #1f2937;
  }

  footer {
    color: #64748b;
    font-size: .78rem;
  }

  code {
    overflow-wrap: anywhere;
  }
</style>
