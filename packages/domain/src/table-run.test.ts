import { describe, expect, it } from "vitest";
import { TableRunCoreStateSchema, advanceCombatObjective, normalizeTableRunStartOptions, parseLabeledActionProposal, parseRefereeRulingText, requiredLocalityForAction, starterGearForClass, summarizeTableRun, tableRunHardStopReason, tableRunSampleStopReason } from "./table-run";

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
    expect(summary.stoppedReason).toBe("sampleSeconds 60s reached");
  });
});
