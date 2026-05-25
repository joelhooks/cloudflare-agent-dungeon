<script module lang="ts">
  import { createContext } from "svelte";

  export type AgentSkillBucket =
    | "referee-soul"
    | "referee-campaign-design"
    | "referee-procedure"
    | "referee-tactics"
    | "player-survival"
    | "table";

  export type AgentSkillAudience = "referee" | "player" | "table";
  export type AgentSkillStatus = "planned" | "draft" | "reviewed" | "compiled" | "loaded" | "retired";
  export type AgentSkillPrivacy = "referee-only" | "player-safe" | "table-safe-output" | "referee-only-with-player-safe-summaries";
  export type AgentSkillVolatility =
    | "core-boundary"
    | "deep-lore"
    | "mechanics-procedure"
    | "situation-skeleton"
    | "beat-adjudication"
    | "local-improv"
    | "tactics-inspiration"
    | "player-guidance";

  export type AgentSkillSourceDoc = {
    docId: string;
    chunkId: string;
    label: string;
  };

  export type AgentSkillRuntimeBacking = {
    runtimeStore: "r2";
    runtimePrefix: string;
    runtimeKey: string;
    artifactStore: "artifacts";
    artifactRepo: string;
    artifactPath: string;
    publishMode: "manual-curated";
  };

  export type AgentSkillRuntimeTarget = {
    compileMode: "manual-curated";
    providerLabel: string;
    loadKey: string;
    targetAgents: string[];
    includeInSystemPrompt: boolean;
    loadOnDemand: boolean;
    contextSummary: string;
    maxTokens: number;
    backing: AgentSkillRuntimeBacking;
  };

  export type AgentSkillManifestEntry = {
    schema: "AgentSkillManifestEntry.v1";
    id: string;
    title: string;
    bucket: AgentSkillBucket;
    audience: AgentSkillAudience;
    status: AgentSkillStatus;
    volatility: AgentSkillVolatility;
    privacy: AgentSkillPrivacy;
    description: string;
    triggerNouns: string[];
    sourceNotes: string[];
    sourceDocs: AgentSkillSourceDoc[];
    manualPath: string;
    runtime: AgentSkillRuntimeTarget;
    safetyPolicy: string;
    outputShape: string;
    lastReviewed: string;
  };

  export type AgentSkillManifestContext = {
    data: {
      readonly entries: AgentSkillManifestEntry[];
      readonly byBucket: Record<AgentSkillBucket, number>;
      readonly byStatus: Record<AgentSkillStatus, number>;
      readonly runtimeEntries: AgentSkillManifestEntry[];
      readonly baselineEntries: AgentSkillManifestEntry[];
    };
    meta: {
      source: string;
      schema: string;
      freshness: string;
      privacy: "local";
      sideEffects: string[];
      thinkConsumption: string;
    };
  };

  export const [getAgentSkillManifestContext, setAgentSkillManifestContext] = createContext<AgentSkillManifestContext>();

  export function parseAgentSkillManifestJsonl(raw: string): AgentSkillManifestEntry[] {
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AgentSkillManifestEntry);
  }
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import rawEntries from "../data/agent-skill-manifest.jsonl?raw";

  type Props = {
    children?: Snippet;
  };

  let { children }: Props = $props();

  const entries = $state.raw(parseAgentSkillManifestJsonl(rawEntries));
  const bucketSeed: Record<AgentSkillBucket, number> = {
    "referee-soul": 0,
    "referee-campaign-design": 0,
    "referee-procedure": 0,
    "referee-tactics": 0,
    "player-survival": 0,
    table: 0,
  };
  const statusSeed: Record<AgentSkillStatus, number> = {
    planned: 0,
    draft: 0,
    reviewed: 0,
    compiled: 0,
    loaded: 0,
    retired: 0,
  };

  const byBucket = $derived(entries.reduce((acc, entry) => {
    acc[entry.bucket] += 1;
    return acc;
  }, { ...bucketSeed }));

  const byStatus = $derived(entries.reduce((acc, entry) => {
    acc[entry.status] += 1;
    return acc;
  }, { ...statusSeed }));

  const runtimeEntries = $derived(entries.filter((entry) => entry.runtime));
  const baselineEntries = $derived(entries.filter((entry) => entry.runtime.includeInSystemPrompt));

  setAgentSkillManifestContext({
    data: {
      get entries() { return entries; },
      get byBucket() { return byBucket; },
      get byStatus() { return byStatus; },
      get runtimeEntries() { return runtimeEntries; },
      get baselineEntries() { return baselineEntries; },
    },
    meta: {
      source: ".brain/data/agent-skill-manifest.jsonl",
      schema: "AgentSkillManifestEntry.v1 JSONL",
      freshness: "manual manifest; update when a skill/playbook card changes status or Think runtime target",
      privacy: "local",
      sideEffects: ["read-only rendered manifest; no runtime cards are compiled by this page"],
      thinkConsumption: "Manual-curated manifest maps Brain/manual cards to Think provider labels and load keys. Runtime agents consume compiled cards from R2SkillProvider-backed context blocks; Artifacts keep versioned compiled cards and publish receipts. They do not scrape agentdungeon.ai website pages.",
    },
  });
</script>

<section class="agent-skill-manifest-provider" data-no-block-select>
  {@render children?.()}
</section>

<style>
  .agent-skill-manifest-provider {
    display: grid;
    gap: 1rem;
    margin: 1.25rem 0;
  }
</style>
