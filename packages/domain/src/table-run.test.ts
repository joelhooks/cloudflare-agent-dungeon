import { describe, expect, it } from "vitest";
import { TableRunCoreStateSchema, TableRunOpeningSeedSchema, advanceCombatObjective, clampTableClock, normalizeTablePartyMember, normalizeTableRunPatch, normalizeTableRunStartOptions, parseLabeledActionProposal, parseRefereeRulingText, requiredLocalityForAction, starterGearForClass, summarizeTableRun, tableRunHardStopReason, tableRunSampleStopReason, validateTableRunOpeningSeedForModule } from "./table-run";

describe("table run mechanics", () => {
  it("computes run stop reasons", () => {
    expect(tableRunSampleStopReason({ beat: 4, runLimits: { maxBeats: 4 } }, 1000)).toBe("sample maxBeats 4 reached");
    expect(tableRunSampleStopReason({ beat: 1, runLimits: { sampleSeconds: 45, startedAtMs: 0 } }, 45_001)).toBe("sampleSeconds 45s reached");
    expect(tableRunHardStopReason({ phase: "combat", maxMoments: 100, maxCombatRounds: 3, maxAfterCombatMoments: 2 })).toBe("server hard-stop after 100 moments and 3 combat rounds");
  });

  it("normalizes run harness options", () => {
    expect(normalizeTableRunStartOptions({ difficulty: 99, maxBeats: 0.2, sampleSeconds: 12.6 })).toEqual({ difficulty: 8, maxBeats: 1, sampleSeconds: 13 });
    expect(normalizeTableRunStartOptions({ difficulty: -2 })).toEqual({ difficulty: 1 });
  });

  it("normalizes clock overflow and incapacitated party members", () => {
    expect(clampTableClock({ name: "Water", value: 8, max: 6 })).toEqual({ name: "Water", value: 6, max: 6 });
    expect(normalizeTablePartyMember({ playerId: "player-a", player: "Mara", character: "Hrum", hp: 0 }).status).toBe("incapacitated");
    expect(normalizeTableRunPatch({ clocks: [{ name: "Water", value: 9, max: 6 }], party: [{ playerId: "player-a", player: "Mara", character: "Hrum", hp: -2 }] })).toMatchObject({ clocks: [{ value: 6 }], party: [{ hp: 0, status: "incapacitated" }] });
  });

  it("parses labeled player action proposals", () => {
    expect(parseLabeledActionProposal("I worry. LOCK: grab the ledger", ["THOUGHT", "LOCK"]).label).toBe("LOCK");
    expect(parseLabeledActionProposal("I worry. LOCK: grab the ledger", ["THOUGHT", "LOCK"]).body).toBe("grab the ledger");
  });

  it("parses Referee ruling text", () => {
    const ruling = parseRefereeRulingText("THOUGHT: pressure is visible\nRULING: Mort bolts.\nNEXT: chase or secure evidence?");
    expect(ruling.thought).toBe("pressure is visible");
    expect(ruling.ruling).toBe("Mort bolts.");
    expect(ruling.next).toBe("chase or secure evidence?");
  });

  it("resolves locality anchors for Fenwater-style actions", () => {
    expect(requiredLocalityForAction("grab Mort's ledger cup")).toBe("Mort's bar");
    expect(requiredLocalityForAction("force the North Ditch door")).toBe("North Ditch door");
    expect(requiredLocalityForAction("dive into the sluice water")).toBe("sluice mouth");
    expect(requiredLocalityForAction("watch the room")).toBeUndefined();
  });

  it("seeds starter gear by class", () => {
    expect(starterGearForClass("fighter")).toEqual(["shield", "weapon"]);
    expect(starterGearForClass("thief")).toEqual(["rope", "knife", "tools"]);
    expect(starterGearForClass("cleric")).toEqual(["holy symbol", "mace"]);
    expect(starterGearForClass("magic-user")).toEqual(["fragile scroll", "chalk", "oil"]);
  });

  it("advances combat objectives through concrete tactics", () => {
    const result = advanceCombatObjective({ kind: "stop_messenger", text: "Stop the runner", progress: 0, target: 1 }, "Nessa trips the runner at the door");
    expect(result.completed).toBe(true);
    expect(result.objective?.progress).toBe(1);
  });

  it("validates opening seeds against generic AdventureModule components", () => {
    const module = {
      schema: "AdventureModule.v1" as const,
      manifest: { schema: "AdventureModuleManifest.v1" as const, moduleId: "test-module", title: "Test Module", source: { kind: "local" as const, paths: [] }, components: [], aliases: { ose: "AdventureScenario" as const } },
      components: [
        { id: "location-sink", kind: "location" as const, title: "The Sink", visibility: "public" as const },
        { id: "pressure-cutter", kind: "encounterPressure" as const, title: "Cutter", visibility: "referee" as const }
      ]
    };
    const seed = TableRunOpeningSeedSchema.parse({ id: "opening-sink-1", title: "Sink Start", startingLocationId: "location-sink", visibleSituation: "Rain hits the stones.", immediatePressure: "A cutter is watching.", whyPartyIsTogether: "The party owes the same ferryman.", initialAffordances: ["watch", "move"], activeFrontIds: ["pressure-cutter"] });
    expect(validateTableRunOpeningSeedForModule(seed, module).startingLocationId).toBe("location-sink");
    expect(() => validateTableRunOpeningSeedForModule({ ...seed, startingLocationId: "location-missing" }, module)).toThrow(/unknown location/);
    expect(() => validateTableRunOpeningSeedForModule({ ...seed, activeFrontIds: ["pressure-missing"] }, module)).toThrow(/unknown pressure/);
  });

  it("parses a runtime table state core without Cloudflare bindings", () => {
    const state = TableRunCoreStateSchema.parse({
      mode: "running",
      moduleId: "fenwater-drainage",
      moduleTitle: "Fenwater Drainage",
      beat: 2,
      moment: 2,
      location: "The tavern",
      activeQuestion: "What do you do?",
      party: [{ playerId: "player-a", player: "Mara", character: "Hrum", hp: 4, armorClass: 12 }],
      events: [{ schema: "TownModuleTableEvent.v1", id: "event-1", at: "2026-05-29T00:00:00.000Z", beat: 2, visibility: "public", lane: "commit", speaker: "Referee", kind: "commit", text: "Beat committed." }]
    });

    expect(state.phase).toBe("exploration");
    expect(state.difficulty).toBe(1);
    expect(state.events[0]?.schema).toBe("TownModuleTableEvent.v1");
  });

  it("summarizes receipts from a table run core state", () => {
    const state = TableRunCoreStateSchema.parse({
      mode: "stopped",
      moduleId: "fenwater-drainage",
      moduleTitle: "Fenwater Drainage",
      beat: 4,
      moment: 4,
      location: "Mort's bar",
      activeQuestion: "Stop or retreat?",
      stoppedReason: "sampleSeconds 60s reached",
      events: [
        { schema: "TableEvent.v1", id: "event-1", at: "2026-05-29T00:00:00.000Z", beat: 1, visibility: "public", lane: "rules", speaker: "Referee", kind: "procedure_check", text: "Position matters: this is setup." },
        { schema: "TableEvent.v1", id: "event-2", at: "2026-05-29T00:00:01.000Z", beat: 2, visibility: "public", lane: "world", speaker: "Referee", kind: "combat_round", text: "Objective progress: 1/1." }
      ],
      modelCallsUsed: 3
    });

    const summary = summarizeTableRun(state);
    expect(summary.counts.localityCorrections).toBe(1);
    expect(summary.counts.objectiveProgress).toBe(1);
    expect(summary.counts.combatRows).toBe(1);
    expect(summary.counts.inactivePartyMembers).toBe(0);
    expect(summary.counts.clockOverflows).toBe(0);
    expect(summary.counts.duplicateCommitBeats).toBe(0);
    expect(summary.stoppedReason).toBe("sampleSeconds 60s reached");
  });

  it("prefers cumulative summary counters over retained event-window counts", () => {
    const state = TableRunCoreStateSchema.parse({
      mode: "stopped",
      moduleId: "fenwater-drainage",
      moduleTitle: "Fenwater Drainage",
      beat: 100,
      moment: 100,
      location: "North Ditch door",
      activeQuestion: "What survives the flood?",
      summaryCounters: { totalEvents: 1200, localityCorrections: 77, objectiveProgress: 9, combatRows: 31, inactiveActionAttempts: 2, duplicateCommitBeats: 1 },
      events: [
        { schema: "TableEvent.v1", id: "recent-1", at: "2026-05-29T00:00:00.000Z", beat: 100, visibility: "public", lane: "commit", speaker: "Referee", kind: "commit", text: "Beat 100 committed." }
      ]
    });

    const summary = summarizeTableRun(state);
    expect(summary.counts.events).toBe(1200);
    expect(summary.counts.retainedEvents).toBe(1);
    expect(summary.counts.localityCorrections).toBe(77);
    expect(summary.counts.combatRows).toBe(31);
    expect(summary.counts.inactiveActionAttempts).toBe(2);
    expect(summary.counts.duplicateCommitBeats).toBe(1);
  });
});
