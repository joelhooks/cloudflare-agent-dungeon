import { describe, expect, it } from "vitest";
import { TOWN_FORGE_SKILL_KEY, type TownGraph } from "../town-forge";
import { adventureModuleFromFenwaterTownGraph } from "./fenwater";

function townGraph(): TownGraph {
  const locations = Array.from({ length: 5 }, (_, index) => ({
    id: `location-${index + 1}`,
    name: index === 0 ? "Mort's bar" : `Location ${index + 1}`,
    kind: index === 0 ? "tavern" as const : "other" as const,
    publicDescription: `Public description ${index + 1}`,
    visibleAffordances: [`affordance ${index + 1}`],
    linkedNpcIds: [],
    linkedRumorIds: [],
    hiddenNotes: `hidden location ${index + 1}`
  }));
  const npcs = Array.from({ length: 6 }, (_, index) => ({
    id: `npc-${index + 1}`,
    name: `NPC ${index + 1}`,
    role: "local",
    publicTell: `tell ${index + 1}`,
    want: `want ${index + 1}`,
    publicDisposition: "wary",
    linkedLocationIds: ["location-1"],
    hiddenNotes: `hidden npc ${index + 1}`,
    memorySeed: `memory ${index + 1}`
  }));
  const rumors = Array.from({ length: 6 }, (_, index) => ({
    id: `rumor-${index + 1}`,
    text: `Rumor ${index + 1}`,
    truthState: "partial" as const,
    publicClue: `clue ${index + 1}`,
    linkedLocationIds: ["location-1"],
    linkedNpcIds: [],
    hiddenNotes: `hidden rumor ${index + 1}`
  }));
  const latentEncounters = Array.from({ length: 4 }, (_, index) => ({
    id: `encounter-${index + 1}`,
    title: `Encounter ${index + 1}`,
    type: "combat-risk" as const,
    triggerSurfaces: ["pressure"],
    stakes: "someone gets hurt",
    tableVisibleClues: ["wet boots"],
    nonCombatOuts: ["pay", "run"],
    escalation: "the cutter closes",
    aftermathMutation: "the route changes",
    linkedLocationIds: ["location-1"],
    linkedNpcIds: [],
    possibleProcedureReceipts: [],
    hiddenNotes: `hidden encounter ${index + 1}`
  }));
  return {
    schema: "TownGraph.v1",
    id: "fenwater-drainage",
    name: "Fenwater Drainage",
    premise: "A sinking place with too many ledgers.",
    publicVibe: "wet wool and peat smoke",
    hiddenPressure: "debts and water rise together",
    sourceSkill: TOWN_FORGE_SKILL_KEY,
    generatedAt: "2026-05-29T00:00:00.000Z",
    locations,
    npcs,
    rumors,
    latentEncounters,
    publicProjection: {
      startingLocationId: "location-1",
      tableSummary: "A public table summary.",
      visibleLocationIds: ["location-1", "location-2"],
      visibleNpcIds: ["npc-1"],
      visibleRumorIds: ["rumor-1"],
      startingAffordances: ["press Mort", "inspect beam", "watch door"],
      safetyNote: "public safe"
    },
    clocks: [
      { id: "clock-1", name: "Mort panic", pressure: "panic rises", current: 0, max: 6, tickTriggers: ["pressure"], publicSigns: ["sweat"], hiddenNotes: "hidden clock" },
      { id: "clock-2", name: "North Ditch water", pressure: "water rises", current: 0, max: 6, tickTriggers: ["delay"], publicSigns: ["drips"], hiddenNotes: "hidden water" }
    ],
    refereeOpenQuestions: ["who paid Mort?", "where does water go?"],
    validationNotes: ["valid test graph"]
  };
}

describe("Fenwater AdventureModule adapter", () => {
  it("maps a Town Forge graph into AdventureModule components", () => {
    const module = adventureModuleFromFenwaterTownGraph({ town: townGraph(), artifactRepo: "agent-dungeon-town-forges", artifactCommit: "abc123" });
    expect(module.manifest.moduleId).toBe("fenwater-drainage");
    expect(module.manifest.source.kind).toBe("artifacts");
    expect(module.components.some((component) => component.kind === "settlement")).toBe(true);
    expect(module.components.filter((component) => component.kind === "localityAnchor").map((component) => component.title)).toEqual(["Mort's bar", "North Ditch door", "sluice mouth"]);
    expect(module.components.find((component) => component.id === "npc-1")?.visibility).toBe("public");
    expect(module.components.find((component) => component.id === "npc-2")?.visibility).toBe("referee");
  });
});
