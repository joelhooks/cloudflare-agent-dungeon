import { z } from "zod";

export const TOWN_FORGE_SKILL_LABEL = "referee_design_skills";
export const TOWN_FORGE_SKILL_KEY = "create-village-skeleton";
export const TOWN_FORGE_R2_PREFIX = "skills/referee/design/";
export const TOWN_FORGE_R2_KEY = `${TOWN_FORGE_R2_PREFIX}${TOWN_FORGE_SKILL_KEY}`;
export const TOWN_FORGE_SKILL_ARTIFACT_REPO = "agent-dungeon-runtime-skills";
export const TOWN_FORGE_ARTIFACT_REPO = "agent-dungeon-town-forges";

const idSchema = z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/);
const shortText = z.string().min(1).max(260);
const mediumText = z.string().min(1).max(620);
const longText = z.string().min(1).max(1200);

export const TownLocationSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(120),
  kind: z.enum(["tavern", "market", "authority", "shrine", "healer", "edge", "residence", "worksite", "danger", "other"]),
  publicDescription: mediumText,
  visibleAffordances: z.array(shortText).min(1).max(5),
  linkedNpcIds: z.array(idSchema).max(8).default([]),
  linkedRumorIds: z.array(idSchema).max(8).default([]),
  hiddenNotes: mediumText
});

export const TownNpcSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(120),
  role: z.string().min(1).max(120),
  publicTell: shortText,
  want: shortText,
  publicDisposition: shortText,
  linkedLocationIds: z.array(idSchema).min(1).max(4),
  hiddenNotes: mediumText,
  memorySeed: shortText
});

export const TownRumorSchema = z.object({
  id: idSchema,
  text: shortText,
  truthState: z.enum(["true", "false", "partial", "unknown"]),
  publicClue: shortText,
  linkedLocationIds: z.array(idSchema).max(4).default([]),
  linkedNpcIds: z.array(idSchema).max(4).default([]),
  hiddenNotes: mediumText
});

export const TownClockSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(120),
  pressure: shortText,
  current: z.number().int().min(0),
  max: z.number().int().min(2).max(12),
  tickTriggers: z.array(shortText).min(1).max(5),
  publicSigns: z.array(shortText).min(1).max(5),
  hiddenNotes: mediumText
}).refine((clock) => clock.current <= clock.max, { message: "clock current must be <= max" });

export const LatentEncounterSchema = z.object({
  id: idSchema,
  title: z.string().min(1).max(140),
  type: z.enum(["social", "hazard", "chase", "combat-risk", "discovery", "resource-pressure"]),
  triggerSurfaces: z.array(shortText).min(1).max(6),
  stakes: shortText,
  tableVisibleClues: z.array(shortText).min(1).max(5),
  nonCombatOuts: z.array(shortText).min(1).max(5),
  escalation: shortText,
  aftermathMutation: shortText,
  linkedLocationIds: z.array(idSchema).max(4).default([]),
  linkedNpcIds: z.array(idSchema).max(4).default([]),
  possibleProcedureReceipts: z.array(z.string().min(1).max(180)).max(8).default([]),
  hiddenNotes: mediumText
});

export const TownPublicProjectionSchema = z.object({
  startingLocationId: idSchema,
  tableSummary: longText,
  visibleLocationIds: z.array(idSchema).min(1).max(8),
  visibleNpcIds: z.array(idSchema).min(1).max(10),
  visibleRumorIds: z.array(idSchema).min(1).max(8),
  startingAffordances: z.array(shortText).min(3).max(8),
  safetyNote: shortText
});

export const TownGraphSchema = z.object({
  schema: z.literal("TownGraph.v1"),
  id: idSchema,
  name: z.string().min(1).max(140),
  premise: mediumText,
  publicVibe: mediumText,
  hiddenPressure: mediumText,
  sourceSkill: z.literal(TOWN_FORGE_SKILL_KEY),
  generatedAt: z.string().datetime(),
  locations: z.array(TownLocationSchema).min(5).max(7),
  npcs: z.array(TownNpcSchema).min(6).max(10),
  rumors: z.array(TownRumorSchema).min(6).max(6),
  clocks: z.array(TownClockSchema).min(2).max(3),
  latentEncounters: z.array(LatentEncounterSchema).min(4).max(6),
  publicProjection: TownPublicProjectionSchema,
  refereeOpenQuestions: z.array(shortText).min(2).max(8),
  validationNotes: z.array(shortText).min(1).max(8)
});

export type TownGraph = z.infer<typeof TownGraphSchema>;
export type TownPublicProjection = z.infer<typeof TownPublicProjectionSchema>;

export const TownForgeReceiptSchema = z.object({
  schema: z.literal("TownForgeReceipt.v1"),
  id: idSchema,
  at: z.string().datetime(),
  kind: z.enum(["skill-publish", "skill-load", "generation", "validation", "artifact-sync", "r2-cache"]),
  status: z.enum(["ok", "warning", "error"]),
  title: z.string().min(1).max(180),
  summary: z.string().min(1).max(700),
  source: z.record(z.string(), z.unknown()).optional()
});

export type TownForgeReceipt = z.infer<typeof TownForgeReceiptSchema>;

const ArtifactSyncStatusSchema = z.object({
  repoName: z.string(),
  remote: z.string().optional(),
  lastCommit: z.string().optional(),
  lastSyncedAt: z.string().optional(),
  status: z.enum(["synced", "skipped", "error"]),
  error: z.string().optional()
});

export type ArtifactSyncStatus = z.infer<typeof ArtifactSyncStatusSchema>;

export const TownForgeStateSchema = z.object({
  schema: z.literal("TownForgeState.v1"),
  mode: z.enum(["idle", "forging", "ready", "failed"]),
  runId: z.string(),
  town: TownGraphSchema.optional(),
  publicTown: z.unknown().optional(),
  receipts: z.array(TownForgeReceiptSchema),
  artifacts: z.object({
    skill: ArtifactSyncStatusSchema.optional(),
    town: ArtifactSyncStatusSchema.optional(),
    r2Key: z.string().optional()
  }).optional(),
  updatedAt: z.string().datetime(),
  error: z.string().optional()
});

export type TownForgeState = z.infer<typeof TownForgeStateSchema>;

function nowIso(): string {
  return new Date().toISOString();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "town";
}

export function townForgeReceipt(input: Omit<TownForgeReceipt, "schema" | "id" | "at"> & { id?: string; at?: string }): TownForgeReceipt {
  return TownForgeReceiptSchema.parse({
    schema: "TownForgeReceipt.v1",
    id: input.id ?? `${input.kind}-${Date.now().toString(36)}`,
    at: input.at ?? nowIso(),
    kind: input.kind,
    status: input.status,
    title: input.title,
    summary: input.summary,
    ...(input.source ? { source: input.source } : {})
  });
}

export function initialTownForgeState(runId = "town-forge-prototype"): TownForgeState {
  return TownForgeStateSchema.parse({
    schema: "TownForgeState.v1",
    mode: "idle",
    runId,
    receipts: [],
    updatedAt: nowIso()
  });
}

export function sanitizeTownGraphForMonitor(town: TownGraph | undefined): unknown | undefined {
  if (!town) return undefined;
  return {
    schema: town.schema,
    id: town.id,
    name: town.name,
    premise: town.premise,
    publicVibe: town.publicVibe,
    sourceSkill: town.sourceSkill,
    generatedAt: town.generatedAt,
    locations: town.locations.map(({ hiddenNotes: _hiddenNotes, ...location }) => location),
    npcs: town.npcs.map(({ hiddenNotes: _hiddenNotes, memorySeed: _memorySeed, ...npc }) => npc),
    rumors: town.rumors.map(({ hiddenNotes: _hiddenNotes, truthState: _truthState, ...rumor }) => ({ ...rumor, truthState: "withheld" })),
    clocks: town.clocks.map(({ hiddenNotes: _hiddenNotes, ...clock }) => clock),
    latentEncounters: town.latentEncounters.map(({ hiddenNotes: _hiddenNotes, ...encounter }) => encounter),
    publicProjection: town.publicProjection,
    validationNotes: town.validationNotes
  };
}

export function townForgeMonitorState(state: TownForgeState): TownForgeState {
  return TownForgeStateSchema.parse({
    ...state,
    publicTown: sanitizeTownGraphForMonitor(state.town),
    town: undefined,
    error: state.error ? "Town Forge failed. See Wrangler logs or dev receipts." : undefined
  });
}

export function createVillageSkeletonSkillCard(): string {
  return [
    "---",
    "name: create-village-skeleton",
    "description: Build a bounded OSE-style village/town situation graph for the Referee without scripting outcomes.",
    "privacy: referee-only",
    "source: .brain/resources/town-graph-svx-artifact-format.svx",
    "---",
    "",
    "# Create Village Skeleton",
    "",
    "Use this when the Referee is creating the initial town/village skeleton before PlayerAgents enter play.",
    "",
    "## Workflow",
    "",
    "1. Create a bounded town, not a whole campaign world.",
    "2. Build a situation scaffold: places, NPC motives, rumors, clocks, and latent encounters.",
    "3. Make the skeleton pressure-bearing, not plot-bearing. Do not decide what the players will do.",
    "4. Separate public projection from hidden Referee truth.",
    "5. Keep NPCs as graph records for this slice, not separate agent minds.",
    "6. Include non-combat outs and escalation for danger nodes.",
    "7. Leave unresolved questions for future Referee Brain maintenance.",
    "",
    "## Output Policy",
    "",
    "Return a TownGraph.v1 object only. No markdown, no prose, no raw source quotes.",
    "",
    "Public fields must be safe for players and audience. HiddenPressure and hiddenNotes are Referee-only.",
    "",
    "## Shape Notes",
    "",
    "- 5-7 locations: tavern, market/service, authority, shrine/healer, edge/danger site, plus optional worksite/residence.",
    "- 6-10 NPC records: each has publicTell, want, publicDisposition, hiddenNotes, and memorySeed.",
    "- exactly 6 rumors: each has public text and hidden truth state.",
    "- 2-3 clocks: each has visible signs and hidden notes.",
    "- 4-6 latent encounters: social, hazard, chase, combat-risk, discovery, or resource-pressure.",
    "",
    "## Safety",
    "",
    "Do not quote OSE or any source corpus. Use source IDs only when supplied by caller. Do not create forced quest paths."
  ].join("\n");
}

export function renderTownForgeArtifacts(town: TownGraph, receipts: TownForgeReceipt[]): Record<string, string> {
  const base = `towns/${town.id}`;
  const graphJson = JSON.stringify(town, null, 2);
  const receiptsJsonl = receipts.map((receipt) => JSON.stringify(receipt)).join("\n") + "\n";
  return {
    [`${base}/index.svx`]: renderTownIndexSvx(town),
    [`${base}/referee.svx`]: renderTownRefereeSvx(town),
    [`${base}/public-projection.svx`]: renderTownPublicProjectionSvx(town),
    [`${base}/graph.json`]: graphJson,
    [`${base}/receipts.jsonl`]: receiptsJsonl,
    [`${base}/components/TownOverview.svelte`]: townOverviewComponent(),
    [`${base}/components/LocationGraph.svelte`]: locationGraphComponent(),
    [`${base}/components/NpcRoster.svelte`]: npcRosterComponent(),
    [`${base}/components/RumorWeb.svelte`]: rumorWebComponent(),
    [`${base}/components/ClockPanel.svelte`]: clockPanelComponent(),
    [`${base}/components/LatentEncounterStack.svelte`]: latentEncounterStackComponent(),
    [`${base}/components/PublicProjection.svelte`]: publicProjectionComponent(),
    [`${base}/components/ForgeReceipts.svelte`]: forgeReceiptsComponent(),
    [`${base}/components.md`]: renderComponentsContract()
  };
}

function svxFrontmatter(town: TownGraph, title: string, privacy: "public" | "referee-only") {
  return [
    "---",
    `title: ${JSON.stringify(title)}`,
    "kind: town-forge-artifact",
    "status: generated",
    `townId: ${town.id}`,
    `sourceSkill: ${TOWN_FORGE_SKILL_KEY}`,
    `generatedAt: ${town.generatedAt}`,
    `privacy: ${privacy}`,
    "schema: TownGraph.v1",
    "---"
  ].join("\n");
}

function renderTownIndexSvx(town: TownGraph): string {
  return `${svxFrontmatter(town, `${town.name} Town Dossier`, "referee-only")}

<script>
  import graph from "./graph.json";
  import TownOverview from "./components/TownOverview.svelte";
  import LocationGraph from "./components/LocationGraph.svelte";
  import NpcRoster from "./components/NpcRoster.svelte";
  import RumorWeb from "./components/RumorWeb.svelte";
  import ClockPanel from "./components/ClockPanel.svelte";
  import LatentEncounterStack from "./components/LatentEncounterStack.svelte";
  import ForgeReceipts from "./components/ForgeReceipts.svelte";
</script>

# ${town.name} Town Dossier

<TownOverview {graph} source="./graph.json" privacy="referee-only" />
<LocationGraph {graph} source="./graph.json" privacy="referee-only" />
<NpcRoster {graph} source="./graph.json" privacy="referee-only" />
<RumorWeb {graph} source="./graph.json" privacy="referee-only" />
<ClockPanel {graph} source="./graph.json" privacy="referee-only" />
<LatentEncounterStack {graph} source="./graph.json" privacy="referee-only" />
<ForgeReceipts source="./receipts.jsonl" schema="TownForgeReceipt.v1" privacy="referee-only" />
`;
}

function renderTownRefereeSvx(town: TownGraph): string {
  return `${svxFrontmatter(town, `${town.name} Referee Skeleton`, "referee-only")}

<script>
  import graph from "./graph.json";
  import NpcRoster from "./components/NpcRoster.svelte";
  import RumorWeb from "./components/RumorWeb.svelte";
  import ClockPanel from "./components/ClockPanel.svelte";
  import LatentEncounterStack from "./components/LatentEncounterStack.svelte";
</script>

# ${town.name} Referee Skeleton

Hidden pressure: ${town.hiddenPressure}

<NpcRoster {graph} source="./graph.json" privacy="referee-only" showHidden />
<RumorWeb {graph} source="./graph.json" privacy="referee-only" showHidden />
<ClockPanel {graph} source="./graph.json" privacy="referee-only" showHidden />
<LatentEncounterStack {graph} source="./graph.json" privacy="referee-only" showHidden />

## Open Questions

${town.refereeOpenQuestions.map((question) => `- ${question}`).join("\n")}
`;
}

function renderTownPublicProjectionSvx(town: TownGraph): string {
  return `${svxFrontmatter(town, `${town.name} Public Projection`, "public")}

<script>
  import graph from "./graph.json";
  import PublicProjection from "./components/PublicProjection.svelte";
</script>

# ${town.name} Public Projection

<PublicProjection {graph} source="./graph.json" privacy="public" />
`;
}

function componentShell(name: string, body: string) {
  return `<script lang="ts">
  type Props = {
    graph?: any;
    source?: string;
    schema?: string;
    privacy?: string;
    showHidden?: boolean;
  };
  let { graph, source = "./graph.json", schema = "TownGraph.v1", privacy = "referee-only", showHidden = false }: Props = $props();
</script>

<section class="town-component" data-component="${name}" data-source={source} data-schema={schema} data-privacy={privacy}>
${body}
  <footer>source <code>{source}</code> · schema <code>{schema}</code> · privacy {privacy} · side effects none</footer>
</section>

<style>
  .town-component { border: 1px solid #d7dee8; border-radius: 16px; background: white; color: #111827; padding: 1rem; margin: 1rem 0; }
  h2, h3 { margin: 0 0 .6rem; }
  p { line-height: 1.55; }
  .grid { display: grid; gap: .7rem; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
  article { border: 1px solid #e5e7eb; border-radius: 12px; padding: .75rem; background: #f8fafc; }
  .hidden { border-left: 3px solid #b91c1c; padding-left: .6rem; color: #7f1d1d; }
  footer { margin-top: .8rem; color: #64748b; font-size: .82rem; }
  code { overflow-wrap: anywhere; }
</style>
`;
}

function townOverviewComponent() {
  return componentShell("TownOverview", `  <h2>{graph?.name ?? "Town"}</h2>
  <p>{graph?.premise}</p>
  <p><strong>Public vibe:</strong> {graph?.publicVibe}</p>
  {#if showHidden && graph?.hiddenPressure}<p class="hidden"><strong>Hidden pressure:</strong> {graph.hiddenPressure}</p>{/if}`);
}

function locationGraphComponent() {
  return componentShell("LocationGraph", `  <h2>Locations</h2>
  <div class="grid">
    {#each graph?.locations ?? [] as location}
      <article>
        <h3>{location.name}</h3>
        <p><strong>{location.kind}</strong> — {location.publicDescription}</p>
        <p>{(location.visibleAffordances ?? []).join(" · ")}</p>
        {#if showHidden}<p class="hidden">{location.hiddenNotes}</p>{/if}
      </article>
    {/each}
  </div>`);
}

function npcRosterComponent() {
  return componentShell("NpcRoster", `  <h2>NPC Roster</h2>
  <div class="grid">
    {#each graph?.npcs ?? [] as npc}
      <article>
        <h3>{npc.name}</h3>
        <p><strong>{npc.role}</strong> — {npc.publicTell}</p>
        <p><strong>Wants:</strong> {npc.want}</p>
        <p><strong>Disposition:</strong> {npc.publicDisposition}</p>
        {#if showHidden}<p class="hidden">{npc.hiddenNotes} Memory seed: {npc.memorySeed}</p>{/if}
      </article>
    {/each}
  </div>`);
}

function rumorWebComponent() {
  return componentShell("RumorWeb", `  <h2>Rumor Web</h2>
  <div class="grid">
    {#each graph?.rumors ?? [] as rumor}
      <article>
        <h3>{rumor.id}</h3>
        <p>{rumor.text}</p>
        <p><strong>Clue:</strong> {rumor.publicClue}</p>
        {#if showHidden}<p class="hidden">Truth: {rumor.truthState}. {rumor.hiddenNotes}</p>{/if}
      </article>
    {/each}
  </div>`);
}

function clockPanelComponent() {
  return componentShell("ClockPanel", `  <h2>Clocks</h2>
  <div class="grid">
    {#each graph?.clocks ?? [] as clock}
      <article>
        <h3>{clock.name} — {clock.current}/{clock.max}</h3>
        <p>{clock.pressure}</p>
        <p><strong>Public signs:</strong> {(clock.publicSigns ?? []).join(" · ")}</p>
        {#if showHidden}<p class="hidden">{clock.hiddenNotes}</p>{/if}
      </article>
    {/each}
  </div>`);
}

function latentEncounterStackComponent() {
  return componentShell("LatentEncounterStack", `  <h2>Latent Encounter Stack</h2>
  <div class="grid">
    {#each graph?.latentEncounters ?? [] as encounter}
      <article>
        <h3>{encounter.title}</h3>
        <p><strong>{encounter.type}</strong> — {encounter.stakes}</p>
        <p><strong>Clues:</strong> {(encounter.tableVisibleClues ?? []).join(" · ")}</p>
        <p><strong>Non-combat outs:</strong> {(encounter.nonCombatOuts ?? []).join(" · ")}</p>
        {#if showHidden}<p class="hidden">{encounter.hiddenNotes}</p>{/if}
      </article>
    {/each}
  </div>`);
}

function publicProjectionComponent() {
  return componentShell("PublicProjection", `  <h2>Starting Public Projection</h2>
  <p>{graph?.publicProjection?.tableSummary}</p>
  <h3>Starting affordances</h3>
  <ul>{#each graph?.publicProjection?.startingAffordances ?? [] as item}<li>{item}</li>{/each}</ul>
  <p><strong>Safety:</strong> {graph?.publicProjection?.safetyNote}</p>`);
}

function forgeReceiptsComponent() {
  return `<script lang="ts">
  type Props = { source?: string; schema?: string; privacy?: string };
  let { source = "./receipts.jsonl", schema = "TownForgeReceipt.v1", privacy = "referee-only" }: Props = $props();
</script>

<section class="town-component" data-component="ForgeReceipts" data-source={source} data-schema={schema} data-privacy={privacy}>
  <h2>Forge Receipts</h2>
  <p>Receipts live in <code>{source}</code>. Renderer contract: load JSONL, validate <code>{schema}</code>, newest first, no side effects.</p>
  <footer>source <code>{source}</code> · schema <code>{schema}</code> · privacy {privacy} · side effects none</footer>
</section>
`;
}

function renderComponentsContract(): string {
  return [
    "# Town Forge Component Contract",
    "",
    "Components are data-backed SVX renderers for TownGraph.v1 artifacts.",
    "",
    "Every component exposes source, schema, privacy, freshness via generatedAt, and side effects in its rendered footer.",
    "",
    "- TownOverview",
    "- LocationGraph",
    "- NpcRoster",
    "- RumorWeb",
    "- ClockPanel",
    "- LatentEncounterStack",
    "- PublicProjection",
    "- ForgeReceipts",
    "",
    "Runtime game agents do not scrape these pages. Referee-owned code loads graph.json / projections directly."
  ].join("\n");
}

export function townForgeUiPage(): Response {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Town Forge — Agent Dungeon</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;700;800&display=swap');
    :root { --bg:#070807; --panel:#0e110f; --panel2:#151a13; --ink:#eaf8de; --muted:#8ca184; --line:#2d3a2a; --hot:#b7ff5a; --amber:#ffd166; --red:#ff6b57; --blue:#6dd3ff; --violet:#d6a4ff; --grid:rgba(183,255,90,.08); }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; color:var(--ink); background:linear-gradient(var(--grid) 1px, transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px),radial-gradient(circle at 76% 6%,rgba(183,255,90,.13),transparent 30rem),var(--bg); background-size:22px 22px,22px 22px,auto,auto; font:15px/1.5 'Geist Mono',ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:-.02em; }
    button { font:inherit; color:var(--ink); background:var(--panel2); border:1px solid var(--hot); padding:.58rem .75rem; text-transform:uppercase; box-shadow:0 0 0 1px rgba(183,255,90,.14),0 0 18px rgba(183,255,90,.08); cursor:pointer; }
    button:disabled { color:var(--muted); border-color:var(--line); cursor:not-allowed; box-shadow:none; }
    button:hover:not(:disabled) { background:#1b2418; }
    .shell { width:min(1500px,calc(100vw - 28px)); margin:0 auto; padding:18px 0 72px; }
    .topbar { border:1px solid var(--line); background:rgba(14,17,15,.92); padding:10px; display:flex; gap:10px; justify-content:space-between; flex-wrap:wrap; }
    .tag { color:var(--bg); background:var(--hot); padding:.14rem .42rem; font-weight:800; text-transform:uppercase; }
    .muted { color:var(--muted); }
    h1 { margin:14px 0; font-size:clamp(2rem,5vw,5.5rem); line-height:.86; letter-spacing:-.08em; text-transform:uppercase; }
    h2 { margin:0 0 8px; color:var(--hot); font-size:.82rem; letter-spacing:.12em; text-transform:uppercase; }
    .hero { display:grid; grid-template-columns:minmax(0,1fr) minmax(330px,.55fr); gap:14px; margin:14px 0; }
    .panel { border:1px solid var(--line); background:rgba(14,17,15,.91); padding:14px; min-width:0; }
    .controls { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
    .status { margin-top:10px; color:var(--muted); }
    .app { display:grid; grid-template-columns:minmax(0,1.2fr) minmax(360px,.8fr); gap:14px; }
    .feed { display:flex; flex-direction:column; gap:10px; }
    .turn { border:1px solid var(--line); background:linear-gradient(180deg,rgba(20,24,18,.96),rgba(10,12,10,.96)); padding:12px; position:relative; overflow:hidden; }
    .turn:first-child { border-color:var(--hot); box-shadow:0 0 0 1px rgba(183,255,90,.25),0 0 34px rgba(183,255,90,.08); }
    .turn:before { content:''; position:absolute; inset:0; pointer-events:none; background:linear-gradient(90deg,rgba(183,255,90,.08),transparent 24%); opacity:.55; }
    .meta { position:relative; display:flex; gap:8px; flex-wrap:wrap; color:var(--muted); font-size:.78rem; text-transform:uppercase; letter-spacing:.08em; margin-bottom:8px; }
    .lane { color:var(--bg); background:var(--blue); padding:.1rem .4rem; font-weight:800; }
    .lane.referee,.lane.validation { background:var(--hot); }
    .lane.skill,.lane.artifacts { background:var(--amber); }
    .lane.graph,.lane.state { background:var(--violet); }
    .lane.error { background:var(--red); }
    .turn h3 { position:relative; margin:0 0 6px; font-size:1.04rem; color:#f6ffe9; text-transform:uppercase; }
    .turn p { position:relative; margin:0; }
    .detail { position:relative; margin-top:8px; color:#d7efcf; background:rgba(255,255,255,.035); border-left:3px solid rgba(183,255,90,.55); padding:.55rem .65rem; line-height:1.55; }
  .detail strong { color:#f6ffe9; }
    .stack { display:grid; gap:14px; align-content:start; }
    .kv { display:grid; gap:8px; }
    .row { border-bottom:1px solid var(--line); padding-bottom:8px; }
    .row strong { display:block; color:#f6ffe9; }
    pre { white-space:pre-wrap; word-break:break-word; margin:0; color:#cfe7c6; }
    @media (max-width: 980px) { .hero,.app { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <main class="shell">
    <div class="topbar"><span class="tag">Town Forge</span><span class="muted">Referee-only worldbuilding · R2 skill card · Artifacts SVX graph · newest event first</span></div>
    <section class="hero">
      <div><h1>Watch the Referee build a town</h1><p class="muted">No players yet. This is the worldbuilding substrate: locations, NPC records, rumors, clocks, latent encounters, public projection, and SVX artifacts.</p></div>
      <div class="panel">
        <h2>Controls</h2>
        <div class="controls"><button id="forge">Forge Town</button><button id="reset">Reset</button></div>
        <p id="status" class="status">Connecting to Referee socket…</p>
      </div>
    </section>
    <section class="app">
      <div><h2>Realtime Referee Stream</h2><div id="feed" class="feed"></div></div>
      <aside class="stack">
        <section class="panel"><h2>Town State</h2><div id="summary" class="kv"></div></section>
        <section class="panel"><h2>Public Projection</h2><pre id="projection">Waiting.</pre></section>
        <section class="panel"><h2>Artifacts</h2><pre id="artifacts">Waiting.</pre></section>
      </aside>
    </section>
  </main>
  <script>
    const forgeButton = document.getElementById('forge');
    const resetButton = document.getElementById('reset');
    const statusText = document.getElementById('status');
    const feed = document.getElementById('feed');
    const summary = document.getElementById('summary');
    const projection = document.getElementById('projection');
    const artifacts = document.getElementById('artifacts');
    let socket = null;
    let socketReady = false;
    let busy = false;
    let state = null;
    let events = [];

    function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, function (char) { return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]; }); }
    function socketUrl() { const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; return protocol + '//' + location.host + '/agents/referee/town-forge-prototype?monitor=town-forge'; }
    function summarizeEvent(event) {
      if (event.detail) return event.detail;
      if (event.summary) return event.summary;
      if (event.type === 'town_forge.connected') return 'Browser is attached to the Referee Durable Object. This is a monitor socket, not a gameplay agent.';
      if (event.type === 'town_forge.state') {
        const s = event.state || {};
        const town = s.publicTown && s.publicTown.name ? ' Town: ' + s.publicTown.name + '.' : '';
        const receipts = Array.isArray(s.receipts) ? ' Receipts: ' + s.receipts.length + '.' : '';
        return 'State snapshot from the Referee: mode=' + (s.mode || 'unknown') + '.' + town + receipts;
      }
      if (event.type === 'town_forge.error') return 'Public-safe error frame. Private stack traces stay in Wrangler logs.';
      if (event.lane === 'skill') return 'Runtime skill-card step: Artifacts is authoritative; R2 is the Think-facing cache.';
      if (event.lane === 'referee') return 'Referee generation step. If Think/tool JSON fails, the prototype falls back so the visual/artifact path still proves out.';
      if (event.lane === 'graph') return 'Town graph record emitted. These are Referee-owned records, not separate NPC agents yet.';
      if (event.lane === 'validation') return 'Schema/public-projection boundary check before writing artifacts.';
      if (event.lane === 'artifacts') return 'Artifact write step for reviewable SVX pages, graph.json, and receipts.jsonl.';
      if (event.lane === 'state') return 'Lifecycle state change from the Referee.';
      return 'Town Forge monitor event.';
    }
    function pushEvent(event) { events = [event].concat(events).slice(0, 80); render(); }

    function render() {
      forgeButton.disabled = !socketReady || busy;
      resetButton.disabled = !socketReady || busy;
      feed.innerHTML = events.map(function (event) {
        const lane = event.lane || 'socket';
        const status = event.status || 'live';
        const summary = summarizeEvent(event);
        return '<article class="turn"><div class="meta"><span class="lane ' + escapeHtml(lane) + '">' + escapeHtml(lane) + '</span><span>' + escapeHtml(status) + '</span><span>' + escapeHtml(event.at ? new Date(event.at).toLocaleTimeString() : 'now') + '</span></div><h3>' + escapeHtml(event.message || event.type || 'event') + '</h3><p class="detail"><strong>Summary:</strong> ' + escapeHtml(summary) + '</p></article>';
      }).join('') || '<article class="turn"><div class="meta"><span class="lane socket">socket</span></div><h3>Waiting for Referee</h3><p class="detail"><strong>Summary:</strong> Connect, then click Forge Town. Every event will show what happened, why it matters, and what stayed hidden.</p></article>';

      const publicTown = state && state.publicTown;
      summary.innerHTML = publicTown ? [
        ['Mode', state.mode],
        ['Town', publicTown.name],
        ['Premise', publicTown.premise],
        ['Locations', (publicTown.locations || []).length],
        ['NPCs', (publicTown.npcs || []).length],
        ['Rumors', (publicTown.rumors || []).length],
        ['Clocks', (publicTown.clocks || []).length],
        ['Latent encounters', (publicTown.latentEncounters || []).length]
      ].map(function (row) { return '<div class="row"><strong>' + escapeHtml(row[0]) + '</strong><span>' + escapeHtml(row[1]) + '</span></div>'; }).join('') : '<div class="row"><strong>Mode</strong><span>' + escapeHtml(state ? state.mode : 'connecting') + '</span></div>';
      projection.textContent = publicTown ? JSON.stringify(publicTown.publicProjection, null, 2) : 'Waiting.';
      artifacts.textContent = state ? JSON.stringify({ artifacts: state.artifacts || null, receipts: (state.receipts || []).map(function (receipt) { return { kind: receipt.kind, status: receipt.status, title: receipt.title, summary: receipt.summary }; }) }, null, 2) : 'Waiting.';
    }

    function send(type) {
      if (!socketReady || !socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type }));
    }

    function connect() {
      socket = new WebSocket(socketUrl());
      socket.addEventListener('open', function () { socketReady = true; statusText.textContent = 'Referee socket connected.'; render(); });
      socket.addEventListener('close', function () { socketReady = false; busy = false; statusText.textContent = 'Socket disconnected; reconnecting…'; render(); setTimeout(connect, 1200); });
      socket.addEventListener('error', function () { statusText.textContent = 'Socket error; waiting for reconnect…'; render(); });
      socket.addEventListener('message', function (message) {
        let event;
        try { event = JSON.parse(message.data); } catch { return; }
        if (event.type === 'town_forge.connected') pushEvent({ type: 'town_forge.connected', lane: 'socket', status: 'done', message: 'Connected to Town Forge socket.', at: event.at });
        if (event.type === 'town_forge.process') {
          if (event.status === 'running') busy = true;
          if (event.status === 'done' && (event.lane === 'state' || event.message || '').toLowerCase().includes('complete')) busy = false;
          if (event.status === 'error') busy = false;
          pushEvent(event);
        }
        if (event.type === 'town_forge.state') {
          state = event.state;
          busy = state && state.mode === 'forging';
          statusText.textContent = 'Town Forge state: ' + (state ? state.mode : 'unknown') + '.';
          pushEvent({ type: 'town_forge.state', lane: 'state', status: state && state.mode === 'failed' ? 'error' : state && state.mode === 'ready' ? 'done' : 'running', message: 'State update: ' + (state ? state.mode : 'unknown'), state, at: event.at, detail: summarizeEvent(event) });
          render();
        }
        if (event.type === 'town_forge.error') { busy = false; pushEvent({ lane: 'error', status: 'error', message: event.message, at: event.at, detail: summarizeEvent(event) }); render(); }
      });
    }

    forgeButton.addEventListener('click', function () { events = []; busy = true; pushEvent({ lane: 'socket', status: 'running', message: 'Forge Town requested.', at: new Date().toISOString() }); send('town_forge.start'); render(); });
    resetButton.addEventListener('click', function () { events = []; busy = true; pushEvent({ lane: 'socket', status: 'running', message: 'Town Forge reset requested.', at: new Date().toISOString() }); send('town_forge.reset'); render(); });
    connect();
    render();
  </script>
</body>
</html>`, { headers: { "content-type": "text/html;charset=utf-8" } });
}
