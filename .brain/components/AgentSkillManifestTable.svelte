<script lang="ts">
  import { getAgentSkillManifestContext } from "./AgentSkillManifestProvider.svelte";

  const manifest = getAgentSkillManifestContext();
  const entries = $derived(manifest.data.entries);
</script>

<section class="skill-manifest-table">
  <header>
    <p class="eyebrow">Curated runtime candidates</p>
    <h2>{entries.length} manual/runtime cards</h2>
  </header>

  <div class="cards">
    {#each entries as entry (entry.id)}
      <article class="skill-card" data-bucket={entry.bucket}>
        <header>
          <div>
            <p class="meta">{entry.bucket} · {entry.audience} · {entry.status}</p>
            <h3>{entry.title}</h3>
          </div>
          <code>{entry.id}</code>
        </header>

        <p>{entry.description}</p>

        <dl>
          <div>
            <dt>Volatility</dt>
            <dd>{entry.volatility}</dd>
          </div>
          <div>
            <dt>Privacy</dt>
            <dd>{entry.privacy}</dd>
          </div>
          <div>
            <dt>Think target</dt>
            <dd><code>{entry.runtime.providerLabel}:{entry.runtime.loadKey}</code></dd>
          </div>
          <div>
            <dt>Load mode</dt>
            <dd>{entry.runtime.includeInSystemPrompt ? "baseline" : "on-demand"} · {entry.runtime.maxTokens} tokens max</dd>
          </div>
          <div>
            <dt>Runtime store</dt>
            <dd><code>{entry.runtime.backing.runtimeKey}</code></dd>
          </div>
          <div>
            <dt>Artifact source</dt>
            <dd><code>{entry.runtime.backing.artifactRepo}/{entry.runtime.backing.artifactPath}</code></dd>
          </div>
        </dl>

        <details>
          <summary>Runtime and source contract</summary>
          <div class="detail-grid">
            <section>
              <h4>Trigger nouns</h4>
              <p>{entry.triggerNouns.join(", ")}</p>
            </section>
            <section>
              <h4>Manual path</h4>
              <p><code>{entry.manualPath}</code></p>
            </section>
            <section>
              <h4>Target agents</h4>
              <p>{entry.runtime.targetAgents.join(", ")}</p>
            </section>
            <section>
              <h4>Context summary</h4>
              <p>{entry.runtime.contextSummary}</p>
            </section>
            <section>
              <h4>Source notes</h4>
              <ul>
                {#each entry.sourceNotes as note}
                  <li><code>{note}</code></li>
                {/each}
              </ul>
            </section>
            <section>
              <h4>Source docs</h4>
              {#if entry.sourceDocs.length}
                <ul>
                  {#each entry.sourceDocs as source}
                    <li><code>{source.chunkId}</code> — {source.label}</li>
                  {/each}
                </ul>
              {:else}
                <p>none</p>
              {/if}
            </section>
            <section>
              <h4>Safety policy</h4>
              <p>{entry.safetyPolicy}</p>
            </section>
            <section>
              <h4>Output shape</h4>
              <p>{entry.outputShape}</p>
            </section>
          </div>
        </details>
      </article>
    {/each}
  </div>
</section>

<style>
  .skill-manifest-table {
    display: grid;
    gap: 1rem;
  }

  .eyebrow {
    margin: 0 0 .25rem;
    color: #64748b;
    font-size: .75rem;
    letter-spacing: .08em;
    text-transform: uppercase;
  }

  h2,
  h3,
  h4 { margin: 0; }

  h2 { font-size: 1.2rem; }
  h3 { font-size: 1.15rem; }
  h4 {
    color: #334155;
    font-size: .82rem;
    letter-spacing: .05em;
    text-transform: uppercase;
  }

  .cards {
    display: grid;
    gap: .85rem;
  }

  .skill-card {
    display: grid;
    gap: .8rem;
    border: 1px solid #e2e8f0;
    border-left: 5px solid #64748b;
    border-radius: 16px;
    background: white;
    color: #111827;
    padding: 1rem;
  }

  .skill-card[data-bucket="referee-soul"] { border-left-color: #7c3aed; }
  .skill-card[data-bucket="referee-campaign-design"] { border-left-color: #2563eb; }
  .skill-card[data-bucket="referee-procedure"] { border-left-color: #dc2626; }
  .skill-card[data-bucket="referee-tactics"] { border-left-color: #ea580c; }
  .skill-card[data-bucket="player-survival"] { border-left-color: #16a34a; }
  .skill-card[data-bucket="table"] { border-left-color: #0891b2; }

  .skill-card > header {
    display: flex;
    justify-content: space-between;
    gap: .75rem;
    flex-wrap: wrap;
  }

  .meta {
    margin: 0 0 .2rem;
    color: #64748b;
    font-size: .78rem;
    letter-spacing: .05em;
    text-transform: uppercase;
  }

  p { margin: 0; line-height: 1.55; }

  dl {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: .6rem;
  }

  dl > div {
    border: 1px solid #eef2f7;
    border-radius: 12px;
    background: #f8fafc;
    padding: .65rem;
  }

  dt {
    color: #64748b;
    font-size: .7rem;
    letter-spacing: .06em;
    text-transform: uppercase;
  }

  dd {
    margin: .2rem 0 0;
    overflow-wrap: anywhere;
  }

  details {
    border: 1px solid #edf2f7;
    border-radius: 12px;
    background: #f8fafc;
    padding: .75rem;
  }

  summary {
    cursor: pointer;
    font-weight: 700;
  }

  .detail-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: .8rem;
    margin-top: .8rem;
  }

  .detail-grid section {
    display: grid;
    gap: .3rem;
  }

  ul {
    margin: 0;
    padding-left: 1.2rem;
  }

  code { overflow-wrap: anywhere; }

  @media (max-width: 860px) {
    dl,
    .detail-grid { grid-template-columns: 1fr; }
  }
</style>
