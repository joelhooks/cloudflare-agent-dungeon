<script lang="ts">
  import { getPrototypeBuildLogContext } from "./PrototypeBuildLogProvider.svelte";

  const buildLog = getPrototypeBuildLogContext();
  const summary = $derived(buildLog.data.summary);
  const meta = buildLog.meta;
</script>

<section class="build-log-summary">
  <p class="eyebrow">Brain data contract</p>
  <h2>Prototype build log</h2>

  <dl class="stats">
    <div>
      <dt>Total entries</dt>
      <dd>{summary.total}</dd>
    </div>
    <div>
      <dt>Build</dt>
      <dd>{summary.byKind.build}</dd>
    </div>
    <div>
      <dt>Fix</dt>
      <dd>{summary.byKind.fix}</dd>
    </div>
    <div>
      <dt>Runtime</dt>
      <dd>{summary.byKind.runtime}</dd>
    </div>
  </dl>

  <div class="contract">
    <p><strong>Source:</strong> <code>{meta.source}</code></p>
    <p><strong>Schema:</strong> <code>{meta.schema}</code></p>
    <p><strong>Freshness:</strong> latest record date <time datetime={meta.freshness}>{meta.freshness}</time></p>
    <p><strong>Privacy:</strong> {meta.privacy}</p>
    <p><strong>Side effects:</strong> {meta.sideEffects.join(", ")}</p>
  </div>
</section>

<style>
  .build-log-summary {
    border: 1px solid #d9e2d0;
    border-radius: 18px;
    background: #fbfff7;
    color: #172111;
    padding: 1rem;
  }

  .eyebrow {
    margin: 0 0 .25rem;
    color: #526345;
    font-size: .75rem;
    letter-spacing: .08em;
    text-transform: uppercase;
  }

  h2 {
    margin: 0 0 1rem;
    font-size: 1.35rem;
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: .6rem;
    margin: 0 0 1rem;
  }

  .stats > div {
    border: 1px solid #e3eadb;
    border-radius: 14px;
    background: white;
    padding: .75rem;
  }

  dt {
    color: #607056;
    font-size: .72rem;
    letter-spacing: .06em;
    text-transform: uppercase;
  }

  dd {
    margin: .2rem 0 0;
    font-size: 1.6rem;
    font-weight: 800;
  }

  .contract {
    display: grid;
    gap: .25rem;
    font-size: .9rem;
  }

  .contract p {
    margin: 0;
  }

  code {
    word-break: break-word;
  }

  @media (max-width: 760px) {
    .stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
