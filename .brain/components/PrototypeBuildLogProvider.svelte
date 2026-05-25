<script module lang="ts">
  import { createContext } from "svelte";

  export type PrototypeBuildLogKind = "build" | "fix" | "runtime" | "research" | "memory" | "log";

  export type PrototypeBuildLogSection = {
    heading: string;
    body: string;
  };

  export type PrototypeBuildLogEntry = {
    schema: "PrototypeBuildLogEntry.v1";
    id: string;
    date: string;
    title: string;
    kind: PrototypeBuildLogKind;
    summary: string;
    sourcePath: string;
    migratedFrom?: string;
    sections: PrototypeBuildLogSection[];
    bodyMarkdown: string;
  };

  export type BuildLogFilter = PrototypeBuildLogKind | "all";

  export type PrototypeBuildLogContext = {
    data: {
      readonly entries: PrototypeBuildLogEntry[];
      readonly filters: BuildLogFilter[];
      readonly selectedFilter: BuildLogFilter;
      readonly filteredEntries: PrototypeBuildLogEntry[];
      readonly visibleEntries: PrototypeBuildLogEntry[];
      readonly hasMore: boolean;
      readonly summary: {
        total: number;
        latestDate: string;
        byKind: Record<PrototypeBuildLogKind, number>;
      };
    };
    actions: {
      setFilter: (filter: BuildLogFilter) => void;
      showMore: () => void;
    };
    meta: {
      source: string;
      schema: string;
      freshness: string;
      privacy: "local";
      sideEffects: string[];
    };
  };

  export const [getPrototypeBuildLogContext, setPrototypeBuildLogContext] = createContext<PrototypeBuildLogContext>();

  export function parsePrototypeBuildLogJsonl(raw: string): PrototypeBuildLogEntry[] {
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as PrototypeBuildLogEntry);
  }
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import rawEntries from "../data/prototype-build-log.jsonl?raw";

  type Props = {
    initialFilter?: BuildLogFilter;
    pageSize?: number;
    children?: Snippet;
  };

  let { initialFilter = "all", pageSize = 6, children }: Props = $props();

  const entries = $state.raw(parsePrototypeBuildLogJsonl(rawEntries));
  const filters: BuildLogFilter[] = ["all", "build", "fix", "runtime", "memory", "research", "log"];

  let state = $state({
    selectedFilter: initialFilter,
    visibleCount: pageSize,
  });

  const filteredEntries = $derived(
    state.selectedFilter === "all"
      ? entries
      : entries.filter((entry) => entry.kind === state.selectedFilter)
  );

  const visibleEntries = $derived(filteredEntries.slice().reverse().slice(0, state.visibleCount));
  const hasMore = $derived(state.visibleCount < filteredEntries.length);
  const summary = $derived({
    total: entries.length,
    latestDate: entries.at(-1)?.date ?? "unknown",
    byKind: entries.reduce(
      (acc, entry) => {
        acc[entry.kind] += 1;
        return acc;
      },
      { build: 0, fix: 0, runtime: 0, research: 0, memory: 0, log: 0 } as Record<PrototypeBuildLogKind, number>
    ),
  });

  const actions = {
    setFilter(filter: BuildLogFilter) {
      state.selectedFilter = filter;
      state.visibleCount = pageSize;
    },
    showMore() {
      state.visibleCount = Math.min(state.visibleCount + pageSize, filteredEntries.length);
    },
  };

  setPrototypeBuildLogContext({
    data: {
      get entries() { return entries; },
      get filters() { return filters; },
      get selectedFilter() { return state.selectedFilter; },
      get filteredEntries() { return filteredEntries; },
      get visibleEntries() { return visibleEntries; },
      get hasMore() { return hasMore; },
      get summary() { return summary; },
    },
    actions,
    meta: {
      source: ".brain/data/prototype-build-log.jsonl",
      schema: "PrototypeBuildLogEntry.v1 JSONL",
      freshness: entries.at(-1)?.date ?? "unknown",
      privacy: "local",
      sideEffects: ["filter buttons and show-more mutate local UI state only"],
    },
  });
</script>

<section class="prototype-build-log-provider" data-no-block-select>
  {@render children?.()}
</section>

<style>
  .prototype-build-log-provider {
    display: grid;
    gap: 1rem;
    margin: 1.25rem 0;
  }
</style>
