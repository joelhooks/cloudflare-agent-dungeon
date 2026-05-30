import { describe, expect, it } from "vitest";
import {
  CampaignTreasureParcelStateSchema,
  RuleSupplementSchema,
  SafeHavenTemplateSchema,
  TreasureParcelTemplateSchema,
  XpLedgerEntrySchema,
  toPlayerTreasureProjection
} from "./advancement";

const treasureTemplateInput = {
  id: "fenwater-treasure-ledger-page",
  name: "Mort ledger page",
  description: "A water-stained ledger page with names, marks, and route pressure only the Referee should fully interpret.",
  valuation: { kind: "requires_referee_appraisal", suggestedGpRange: { min: 0, max: 25 } },
  kind: "document",
  encumbrance: { bulk: "negligible" },
  placement: {
    visibility: "referee_private",
    locationId: "fenwater-location-morts-bar",
    clue: "Hidden behind the nicked hearth beam if Mort panics.",
    sourceNotes: "Names the debt route and points to the Charter House."
  },
  playerFacing: { description: "A damp ledger page with shell-token marks and several legible names.", visibility: "party_known" },
  tags: ["evidence", "referee:debt-web"],
  visibility: "referee_private"
} as const;

describe("advancement schemas", () => {
  it("parses treasure templates with hidden placement separate from player-facing text", () => {
    const parsed = TreasureParcelTemplateSchema.parse(treasureTemplateInput);

    expect(parsed.valuation.kind).toBe("requires_referee_appraisal");
    expect(parsed.placement.visibility).toBe("referee_private");
    expect(parsed.placement.sourceNotes).toContain("Charter House");
    expect(parsed.playerFacing.description).not.toContain("behind the nicked hearth beam");
  });

  it("requires numeric GP values when valuation is fixed", () => {
    expect(() =>
      TreasureParcelTemplateSchema.parse({
        ...treasureTemplateInput,
        valuation: { kind: "fixed_gp", valueGp: "25" }
      })
    ).toThrow();

    expect(TreasureParcelTemplateSchema.parse({ ...treasureTemplateInput, valuation: { kind: "fixed_gp", valueGp: 25 } }).valuation).toEqual({ kind: "fixed_gp", valueGp: 25 });
  });

  it("projects treasure for players without hidden placement or referee notes", () => {
    const projection = toPlayerTreasureProjection(TreasureParcelTemplateSchema.parse(treasureTemplateInput));

    expect(projection).toMatchObject({ id: "fenwater-treasure-ledger-page", name: "Mort ledger page" });
    expect(projection.playerFacing.description).toContain("shell-token marks");
    expect(projection.tags).not.toContain("referee:debt-web");
    expect(projection).not.toHaveProperty("placement");
    expect(JSON.stringify(projection)).not.toContain("hearth beam");
  });

  it("rejects referee-private and audience-xray player-facing treasure visibility", () => {
    for (const visibility of ["referee_private", "audience_xray"] as const) {
      expect(() =>
        TreasureParcelTemplateSchema.parse({
          ...treasureTemplateInput,
          playerFacing: { ...treasureTemplateInput.playerFacing, visibility }
        })
      ).toThrow();
    }
  });

  it("supports parcel lifecycle states without making TableRun own treasure truth", () => {
    const states = ["undiscovered", "discovered", "claimed", "recovered_to_safety", "settled"] as const;

    expect(
      states.map((state) =>
        CampaignTreasureParcelStateSchema.parse({
          parcelId: `parcel-${state}`,
          templateId: "fenwater-treasure-ledger-page",
          campaignId: "campaign-fenwater",
          state,
          currentHolder: state === "undiscovered" ? { kind: "unknown" } : { kind: "party" },
          receiptEventIds: [`event-${state}`]
        }).state
      )
    ).toEqual(states);
  });

  it("records XP ledger receipts and participant splits without class threshold rules", () => {
    const ledger = XpLedgerEntrySchema.parse({
      id: "xp-ledger-1",
      campaignId: "campaign-fenwater",
      runId: "run-drainage-1",
      source: "recovered_treasure",
      sourceParcelIds: ["parcel-ledger-page"],
      safeHavenId: "fenwater-safehaven-stove-boat",
      totalXp: 50,
      participants: [
        { characterId: "character-a", shareXp: 25 },
        { characterId: "character-b", shareXp: 25 }
      ],
      receiptEventIds: ["event-recovered", "event-settled"],
      rulesReceiptIds: ["old-school-essentials-classic-fantasy-rules-tome-3751c5149a24:treasure-xp-summary"],
      createdAt: "2026-05-30T00:00:00.000Z"
    });

    expect(ledger.source).toBe("recovered_treasure");
    expect(ledger.participants.map((participant) => participant.shareXp)).toEqual([25, 25]);
  });

  it("models safe havens by capabilities, not by town/tavern assumptions", () => {
    const safeHavens = [
      SafeHavenTemplateSchema.parse({ id: "fenwater-safehaven-alder-knoll", name: "Alder Knoll dry camp", description: "High dry ground above the ditch water.", capabilities: ["rest", "stash_treasure"], access: { conditions: ["smoke may reveal the camp"] } }),
      SafeHavenTemplateSchema.parse({ id: "fenwater-safehaven-stove-boat", name: "Reedwright stove boat", description: "A warm boat among reedwright families.", capabilities: ["rest", "settle_treasure", "gather_rumors"], services: [{ id: "guide-talk", name: "route gossip" }] }),
      SafeHavenTemplateSchema.parse({ id: "fenwater-safehaven-pump-mezzanine", name: "Pump House mezzanine", description: "A narrow platform above bad water and machinery.", capabilities: ["stash_treasure"], risks: ["pump pressure advances"] })
    ];

    expect(safeHavens.map((haven) => haven.capabilities)).toEqual([["rest", "stash_treasure"], ["rest", "settle_treasure", "gather_rumors"], ["stash_treasure"]]);
    expect(JSON.stringify(safeHavens)).not.toMatch(/tavern|shop|town/);
  });

  it("stores rule supplement citations and safe summaries, not raw rules corpus", () => {
    const supplement = RuleSupplementSchema.parse({
      id: "rule-supplement-treasure-xp",
      title: "Treasure XP accounting source receipt",
      kind: "campaign_rule",
      scope: "treasure_xp",
      affectedRuleIds: ["ose:treasure-xp"],
      sourceDocId: "old-school-essentials-classic-fantasy-rules-tome-3751c5149a24",
      sourceChunkIds: ["chunk-treasure-xp-summary"],
      summary: "Safe internal summary that points the Referee at source receipts before procedure work.",
      refereeReason: "Use recovered treasure XP as the table's advancement backbone.",
      playerSafeSummary: "Recovered treasure can become XP after settlement.",
      commitEventId: "event-rule-committed",
      visibility: "referee_private"
    });

    expect(supplement.kind).toBe("campaign_rule");
    expect(supplement.affectedRuleIds).toEqual(["ose:treasure-xp"]);
    expect(supplement.sourceChunkIds).toEqual(["chunk-treasure-xp-summary"]);
    expect(supplement.playerSafeSummary).toContain("settlement");
    expect(supplement.summary).not.toContain("XP table");
  });
});
