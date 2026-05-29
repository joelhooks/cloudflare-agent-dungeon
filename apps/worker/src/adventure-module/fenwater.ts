import {
  AdventureModuleSchema,
  type AdventureModule,
  type AdventureModuleComponent,
  type AdventureModuleComponentRef
} from "@cloudflare-agent-dungeon/domain";
import type { TownGraph } from "../town-forge";

const FENWATER_ARTIFACT_PATHS = [
  "towns/fenwater-drainage/graph.json",
  "towns/fenwater-drainage/receipts.jsonl",
  "towns/fenwater-drainage/referee.svx",
  "towns/fenwater-drainage/public-projection.svx",
  "towns/fenwater-drainage/index.svx"
] as const;

export const FENWATER_DRAINAGE_MODULE_ID = "fenwater-drainage";
export const FENWATER_DRAINAGE_ARTIFACT_COMMIT = "59ec68209d85ebd7ab6c7fc2441587d672454de6";
export const FENWATER_DRAINAGE_ARTIFACT_PATHS = [...FENWATER_ARTIFACT_PATHS];

function componentRef(component: AdventureModuleComponent): AdventureModuleComponentRef {
  const { payload: _payload, ...ref } = component;
  return ref;
}

export function adventureModuleFromFenwaterTownGraph(input: {
  town: TownGraph;
  artifactRepo: string;
  artifactCommit: string;
}): AdventureModule {
  const { town, artifactRepo, artifactCommit } = input;
  const projection = town.publicProjection;
  const visibleLocationIds = new Set(projection.visibleLocationIds);
  const visibleNpcIds = new Set(projection.visibleNpcIds);
  const visibleRumorIds = new Set(projection.visibleRumorIds);

  const components: AdventureModuleComponent[] = [
    {
      id: town.id,
      kind: "settlement",
      title: town.name,
      visibility: "public",
      payload: {
        tableSummary: projection.tableSummary,
        startingLocationId: projection.startingLocationId
      }
    },
    ...town.locations.map((location) => ({
      id: location.id,
      kind: "location" as const,
      title: location.name,
      visibility: visibleLocationIds.has(location.id) ? "public" as const : "referee" as const,
      payload: location
    })),
    ...town.npcs.map((npc) => ({
      id: npc.id,
      kind: "npc" as const,
      title: npc.name,
      visibility: visibleNpcIds.has(npc.id) ? "public" as const : "referee" as const,
      payload: npc
    })),
    ...town.rumors.map((rumor) => ({
      id: rumor.id,
      kind: "clue" as const,
      title: rumor.text.slice(0, 80),
      visibility: visibleRumorIds.has(rumor.id) ? "public" as const : "referee" as const,
      payload: rumor
    })),
    ...town.clocks.map((clock) => ({
      id: clock.id,
      kind: "clock" as const,
      title: clock.name,
      visibility: "referee" as const,
      payload: clock
    })),
    ...town.latentEncounters.map((encounter) => ({
      id: encounter.id,
      kind: "encounterPressure" as const,
      title: encounter.title,
      visibility: "referee" as const,
      payload: encounter
    })),
    { id: "fenwater-mort-bar", kind: "localityAnchor", title: "Mort's bar", visibility: "public", payload: { requires: ["ledger", "cup", "Mort"] } },
    { id: "fenwater-north-ditch-door", kind: "localityAnchor", title: "North Ditch door", visibility: "public", payload: { requires: ["north ditch", "ditch door", "shell-token"] } },
    { id: "fenwater-sluice-mouth", kind: "localityAnchor", title: "sluice mouth", visibility: "public", payload: { requires: ["sluice", "black water", "drain"] } }
  ];

  return AdventureModuleSchema.parse({
    schema: "AdventureModule.v1",
    manifest: {
      schema: "AdventureModuleManifest.v1",
      moduleId: town.id,
      title: town.name,
      source: {
        kind: "artifacts",
        repo: artifactRepo,
        commit: artifactCommit,
        paths: FENWATER_DRAINAGE_ARTIFACT_PATHS
      },
      components: components.map(componentRef)
    },
    components
  });
}
