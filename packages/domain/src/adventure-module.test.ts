import { describe, expect, it } from "vitest";
import { AdventureModuleSchema, projectAdventureModule } from "./adventure-module";

const module = AdventureModuleSchema.parse({
  schema: "AdventureModule.v1",
  manifest: {
    schema: "AdventureModuleManifest.v1",
    moduleId: "fenwater-drainage",
    title: "Fenwater Drainage",
    source: { kind: "artifacts", repo: "agent-dungeon-town-forges", commit: "59ec68209d85ebd7ab6c7fc2441587d672454de6", paths: ["towns/fenwater-drainage/graph.json"] },
    components: [
      { id: "mort-bar", kind: "location", title: "Mort's bar", visibility: "public" },
      { id: "hidden-ledger", kind: "clue", title: "Ledger cup", visibility: "referee" },
      { id: "private-note", kind: "clue", title: "Unresolved private note", visibility: "private" }
    ]
  },
  components: [
    { id: "mort-bar", kind: "location", title: "Mort's bar", visibility: "public", payload: { anchors: ["ledger"] } },
    { id: "hidden-ledger", kind: "clue", title: "Ledger cup", visibility: "referee", payload: { secret: true } },
    { id: "private-note", kind: "clue", title: "Unresolved private note", visibility: "private" }
  ]
});

describe("AdventureModule", () => {
  it("keeps source module identity separate from table run state", () => {
    expect(module.manifest.moduleId).toBe("fenwater-drainage");
    expect(module.manifest.aliases.ose).toBe("AdventureScenario");
  });

  it("projects component refs without payloads by audience", () => {
    expect(projectAdventureModule(module, "public").components.map((c) => c.id)).toEqual(["mort-bar"]);
    expect(projectAdventureModule(module, "referee").components.map((c) => c.id)).toEqual(["mort-bar", "hidden-ledger"]);
    expect(projectAdventureModule(module, "referee").components[0]).not.toHaveProperty("payload");
  });
});
