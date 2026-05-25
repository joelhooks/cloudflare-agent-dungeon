<script lang="ts">
  import { getAgentSkillManifestContext } from "./AgentSkillManifestProvider.svelte";

  const manifest = getAgentSkillManifestContext();
  const entries = $derived(manifest.data.entries);
  const byBucket = $derived(manifest.data.byBucket);
  const byStatus = $derived(manifest.data.byStatus);
  const baselineEntries = $derived(manifest.data.baselineEntries);
  const meta = manifest.meta;
</script>

<section class="skill-manifest-summary">
  <p class="eyebrow">Brain data contract</p>
  <h2>Agent skill manifest</h2>
  <p class="lede">A curated track map for manual pages and future Think runtime cards. Skills are the rails and guidewires; this manifest makes the rails obvious.</p>

  <dl class="stats">
    <div>
      <dt>Total cards</dt>
      <dd>{entries.length}</dd>
    </div>
    <div>
      <dt>Draft</dt>
      <dd>{byStatus.draft}</dd>
    </div>
    <div>
      <dt>Planned</dt>
      <dd>{byStatus.planned}</dd>
    </div>
    <div>
      <dt>Baseline</dt>
      <dd>{baselineEntries.length}</dd>
    </div>
  </dl>

  <div class="bucket-grid" aria-label="Skill buckets">
    {#each Object.entries(byBucket) as [bucket, count]}
      <div><span>{bucket}</span><strong>{count}</strong></div>
    {/each}
  </div>

  <div class="contract">
    <p><strong>Source:</strong> <code>{meta.source}</code></p>
    <p><strong>Schema:</strong> <code>{meta.schema}</code></p>
    <p><strong>Freshness:</strong> {meta.freshness}</p>
    <p><strong>Privacy:</strong> {meta.privacy}</p>
    <p><strong>Think consumption:</strong> {meta.thinkConsumption}</p>
    <p><strong>Side effects:</strong> {meta.sideEffects.join(", ")}</p>
  </div>
</section>

<style>
  .skill-manifest-summary {
    border: 1px solid #dbe4ef;
    border-radius: 18px;
    background: #fbfdff;
    color: #101827;
    padding: 1rem;
  }

  .eyebrow {
    margin: 0 0 .25rem;
    color: #52657a;
    font-size: .75rem;
    letter-spacing: .08em;
    text-transform: uppercase;
  }

  h2 {
    margin: 0 0 .5rem;
    font-size: 1.35rem;
  }

  .lede {
    max-width: 72ch;
    margin: 0 0 1rem;
    color: #334155;
    line-height: 1.55;
  }

  .stats,
  .bucket-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: .6rem;
    margin: 0 0 1rem;
  }

  .stats > div,
  .bucket-grid > div {
    border: 1px solid #e4eaf2;
    border-radius: 14px;
    background: white;
    padding: .75rem;
  }

  dt,
  .bucket-grid span {
    display: block;
    color: #64748b;
    font-size: .72rem;
    letter-spacing: .06em;
    text-transform: uppercase;
  }

  dd,
  .bucket-grid strong {
    margin: .2rem 0 0;
    font-size: 1.35rem;
    font-weight: 800;
  }

  .contract {
    display: grid;
    gap: .35rem;
    font-size: .92rem;
    line-height: 1.45;
  }

  .contract p { margin: 0; }
  code { overflow-wrap: anywhere; }

  @media (max-width: 820px) {
    .stats,
    .bucket-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
</style>
