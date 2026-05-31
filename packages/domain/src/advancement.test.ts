import { describe, expect, it } from "vitest";
import {
  CampaignArcBriefSchema,
  CampaignArcSchema,
  CampaignFactSchema,
  CampaignSafeHavenStateSchema,
  CampaignTreasureParcelStateSchema,
  DowntimeActionSchema,
  ExpeditionSessionSchema,
  MemoryCompactionReceiptSchema,
  RuleSupplementSchema,
  SafeHavenTemplateSchema,
  TableRunAppendLogEntrySchema,
  TreasureParcelTemplateSchema,
  XpLedgerEntrySchema,
  claimTreasureParcel,
  recoverTreasureParcelToSafeHaven,
  settleRecoveredTreasure,
  toPlayerCampaignFactProjection,
  toPlayerTreasureProjection,
  treasureParcelXpValue
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

  it("derives treasure XP value from template valuation instead of Worker rules", () => {
    expect(treasureParcelXpValue(TreasureParcelTemplateSchema.parse({ ...treasureTemplateInput, valuation: { kind: "fixed_gp", valueGp: 125.9 } }))).toBe(125);
    expect(treasureParcelXpValue(TreasureParcelTemplateSchema.parse(treasureTemplateInput))).toBe(25);
    expect(treasureParcelXpValue(TreasureParcelTemplateSchema.parse({ ...treasureTemplateInput, valuation: { kind: "non_xp_leverage" } }))).toBe(0);
  });

  it("settles recovered treasure only at a settlement-capable SafeHaven", () => {
    const claimed = claimTreasureParcel(CampaignTreasureParcelStateSchema.parse({ parcelId: "parcel-cache", templateId: "fenwater-treasure-cache", campaignId: "campaign-fenwater", state: "undiscovered", currentHolder: { kind: "unknown" }, xpValueGp: 4800 }), { eventId: "event-claim", runId: "run-1" });
    const recovered = recoverTreasureParcelToSafeHaven(claimed, { eventId: "event-return", runId: "run-1", safeHavenId: "fenwater-safehaven-stove-boat" });
    const camp = CampaignSafeHavenStateSchema.parse({ safeHavenId: "fenwater-safehaven-dry-camp", templateId: "fenwater-safehaven-dry-camp", knownToParty: true, availableCapabilities: ["rest", "stash_treasure"] });
    const settlement = CampaignSafeHavenStateSchema.parse({ safeHavenId: "fenwater-safehaven-stove-boat", templateId: "fenwater-safehaven-stove-boat", knownToParty: true, availableCapabilities: ["rest", "settle_treasure"] });

    expect(settleRecoveredTreasure({ campaignId: "campaign-fenwater", runId: "run-1", eventId: "event-settle", safeHaven: camp, parcels: [recovered], participantCharacterIds: ["character-a", "character-b"], rulesReceiptIds: ["ose:treasure-xp"], createdAt: "2026-05-30T00:00:00.000Z" })).toBeUndefined();
    const award = settleRecoveredTreasure({ campaignId: "campaign-fenwater", runId: "run-1", eventId: "event-settle", safeHaven: settlement, parcels: [recovered], participantCharacterIds: ["character-a", "character-b"], rulesReceiptIds: ["ose:treasure-xp"], createdAt: "2026-05-30T00:00:00.000Z" });

    expect(award?.xpLedgerEntry.totalXp).toBe(4800);
    expect(award?.xpLedgerEntry.participants.map((participant) => participant.shareXp)).toEqual([2400, 2400]);
    expect(award?.settledParcels[0]?.state).toBe("settled");
  });

  it("models CampaignArc and player-safe CampaignArcBrief without hidden route scripting", () => {
    const arc = CampaignArcSchema.parse({
      schema: "CampaignArc.v1",
      id: "arc-fenwater-1",
      campaignId: "campaign-fenwater",
      status: "settlement",
      expeditionIds: ["expedition-1"],
      activeLeadFactIds: ["fact-trainer-rumor"],
      treasureParcelIds: ["parcel-cache"],
      xpLedgerEntryIds: ["xp-event-settle"],
      levelingSessionIds: ["level-character-a-2"],
      summary: "The party has a haul counted at the stove boat and needs training access before level-up.",
      updatedAt: "2026-05-30T00:00:00.000Z"
    });
    const brief = CampaignArcBriefSchema.parse({
      schema: "CampaignArcBrief.v1",
      status: arc.status,
      aim: "Decide whether to pursue training access or launch another expedition.",
      whyItMatters: "The haul can change the party if they find someone able to train them.",
      knownRisks: ["Cutters still track the route."],
      visibleChoices: ["ask reedwrights about a trainer", "rest and hire help", "launch the next expedition"],
      sourceFactIds: ["fact-trainer-rumor"]
    });

    expect(arc.status).toBe("settlement");
    expect(JSON.stringify(brief)).not.toMatch(/hidden|strongbox behind|referee/i);
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

  it("projects CampaignFacts without leaking referee-private linked truth", () => {
    const rumor = CampaignFactSchema.parse({
      schema: "CampaignFact.v1",
      id: "fact-rumor-1",
      campaignId: "campaign-1",
      kind: "rumor",
      lifecycle: "rumor",
      visibility: "party_known",
      claim: "The party heard that Mort's ledger can buy safe passage.",
      playerSafeClaim: "A rumor says Mort's ledger can buy safe passage.",
      linkedFactIds: ["fact-hidden-1"],
      sourceEventIds: ["event-1"],
      createdAt: "2026-05-30T00:00:00.000Z"
    });
    const hidden = CampaignFactSchema.parse({
      schema: "CampaignFact.v1",
      id: "fact-hidden-1",
      campaignId: "campaign-1",
      kind: "debt",
      visibility: "referee_private",
      claim: "Mort's ledger is bait for the collectors.",
      sourceEventIds: ["event-2"],
      createdAt: "2026-05-30T00:00:00.000Z"
    });

    const projection = toPlayerCampaignFactProjection(rumor);
    expect(projection).toMatchObject({ claim: "A rumor says Mort's ledger can buy safe passage." });
    expect(projection).not.toHaveProperty("linkedFactIds");
    const playerPrivate = CampaignFactSchema.parse({
      schema: "CampaignFact.v1",
      id: "fact-private-1",
      campaignId: "campaign-1",
      kind: "relationship",
      visibility: "player_private",
      claim: "A private fear or secret plan belongs to one PlayerAgent only.",
      sourceEventIds: ["event-3"],
      createdAt: "2026-05-30T00:00:00.000Z"
    });
    expect(toPlayerCampaignFactProjection(hidden)).toBeUndefined();
    expect(toPlayerCampaignFactProjection(playerPrivate)).toBeUndefined();
  });

  it("models append-only table run log entries outside the retained state window", () => {
    const entry = TableRunAppendLogEntrySchema.parse({
      schema: "TableRunAppendLogEntry.v1",
      sequence: 501,
      runId: "run-1",
      eventId: "event-501",
      beat: 88,
      eventKind: "ruling",
      lane: "world",
      visibility: "public",
      speaker: "Referee",
      text: "The party retreats toward the stove boat with the ledger wrapped in oilcloth.",
      at: "2026-05-30T00:00:00.000Z",
      retainedInState: false,
      factIds: ["fact-ledger-recovered"]
    });

    expect(entry.sequence).toBe(501);
    expect(entry.retainedInState).toBe(false);
  });

  it("models expedition lifecycle, downtime choices, and compaction receipts as domain artifacts", () => {
    const expedition = ExpeditionSessionSchema.parse({
      schema: "ExpeditionSession.v1",
      id: "expedition-1",
      campaignId: "campaign-fenwater",
      runId: "run-1",
      lifecycle: "returning",
      safeHavenId: "fenwater-safehaven-reedwright-stove-boat",
      currentLocationId: "fenwater-location-backwater-ferry",
      carriedParcelIds: ["parcel-ledger"],
      injuredCharacterIds: ["character-osso"],
      openThreadFactIds: ["fact-debt-web"],
      sourceEventIds: ["event-80", "event-91"],
      updatedAt: "2026-05-30T00:00:00.000Z"
    });
    const downtime = DowntimeActionSchema.parse({
      schema: "DowntimeAction.v1",
      id: "downtime-settle-ledger",
      campaignId: "campaign-fenwater",
      safeHavenId: "fenwater-safehaven-reedwright-stove-boat",
      kind: "settle_treasure",
      parcelIds: ["parcel-ledger"],
      status: "available",
      playerSafeSummary: "Dry and appraise the ledger page at the stove boat before counting XP.",
      createdAt: "2026-05-30T00:00:00.000Z"
    });
    const receipt = MemoryCompactionReceiptSchema.parse({
      schema: "MemoryCompactionReceipt.v1",
      id: "memory-1",
      campaignId: "campaign-fenwater",
      runId: "run-1",
      scope: "referee_campaign_digest",
      eventSequenceRange: { from: 0, to: 750 },
      summary: "The party recovered a ledger lead, angered the cutters, and owes the reedwrights a favor.",
      activeFactIds: ["fact-debt-web"],
      createdAt: "2026-05-30T00:00:00.000Z"
    });

    expect(expedition.lifecycle).toBe("returning");
    expect(downtime.kind).toBe("settle_treasure");
    expect(receipt.eventSequenceRange).toEqual({ from: 0, to: 750 });
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
