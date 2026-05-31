import { z } from "zod";

export const GameplayVisibilitySchema = z.enum(["referee_private", "party_known", "player_private", "player_public", "audience_xray"]);
export type GameplayVisibility = z.infer<typeof GameplayVisibilitySchema>;

export const PlayerSafeVisibilitySchema = z.enum(["party_known", "player_private", "player_public"]);
export type PlayerSafeVisibility = z.infer<typeof PlayerSafeVisibilitySchema>;

const IdSchema = z.string().min(1);

export const TreasureValuationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fixed_gp"), valueGp: z.number().nonnegative() }),
  z.object({ kind: z.literal("requires_referee_appraisal"), suggestedGpRange: z.object({ min: z.number().nonnegative(), max: z.number().nonnegative() }).refine((range) => range.max >= range.min, "max must be >= min").optional() }),
  z.object({ kind: z.literal("non_xp_leverage") })
]);
export type TreasureValuation = z.infer<typeof TreasureValuationSchema>;

export const TreasureEncumbranceSchema = z.object({
  bulk: z.enum(["negligible", "hand", "pack", "sack", "bulky"]).default("hand"),
  notes: z.string().min(1).optional()
});
export type TreasureEncumbrance = z.infer<typeof TreasureEncumbranceSchema>;

export const TreasurePlacementSchema = z.object({
  visibility: z.literal("referee_private"),
  locationId: IdSchema.optional(),
  clue: z.string().min(1).optional(),
  sourceNotes: z.string().min(1).optional()
});
export type TreasurePlacement = z.infer<typeof TreasurePlacementSchema>;

export const TreasureParcelTemplateSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  valuation: TreasureValuationSchema,
  kind: z.enum(["coin", "trade_good", "art_object", "jewelry", "document", "tool", "oddity", "magic_item"]),
  encumbrance: TreasureEncumbranceSchema.default({ bulk: "hand" }),
  placement: TreasurePlacementSchema,
  playerFacing: z.object({ description: z.string().min(1), visibility: PlayerSafeVisibilitySchema.default("party_known") }),
  tags: z.array(z.string().min(1)).default([]),
  visibility: GameplayVisibilitySchema.default("referee_private")
});
export type TreasureParcelTemplate = z.infer<typeof TreasureParcelTemplateSchema>;

export function treasureParcelXpValue(template: TreasureParcelTemplate): number {
  if (template.valuation.kind === "fixed_gp") return Math.floor(template.valuation.valueGp);
  if (template.valuation.kind === "requires_referee_appraisal") return Math.floor(template.valuation.suggestedGpRange?.max ?? 0);
  return 0;
}

export const PlayerTreasureProjectionSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  kind: TreasureParcelTemplateSchema.shape.kind,
  playerFacing: TreasureParcelTemplateSchema.shape.playerFacing,
  tags: z.array(z.string().min(1)).default([]),
  visibility: PlayerSafeVisibilitySchema.default("party_known")
});
export type PlayerTreasureProjection = z.infer<typeof PlayerTreasureProjectionSchema>;

export function toPlayerTreasureProjection(template: TreasureParcelTemplate): PlayerTreasureProjection {
  return PlayerTreasureProjectionSchema.parse({
    id: template.id,
    name: template.name,
    kind: template.kind,
    playerFacing: template.playerFacing,
    tags: template.tags.filter((tag) => !tag.startsWith("referee:")),
    visibility: template.playerFacing.visibility
  });
}

export const TreasureHolderSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("party") }),
  z.object({ kind: z.literal("character"), characterId: IdSchema }),
  z.object({ kind: z.literal("location"), locationId: IdSchema }),
  z.object({ kind: z.literal("safe_haven"), safeHavenId: IdSchema }),
  z.object({ kind: z.literal("unknown") })
]);
export type TreasureHolder = z.infer<typeof TreasureHolderSchema>;

export const CampaignTreasureParcelStateSchema = z.object({
  parcelId: IdSchema,
  templateId: IdSchema,
  campaignId: IdSchema,
  state: z.enum(["undiscovered", "discovered", "claimed", "carried", "cached", "recovered_to_safety", "settled", "lost"]),
  currentHolder: TreasureHolderSchema,
  discoveredInRunId: IdSchema.optional(),
  claimedInRunId: IdSchema.optional(),
  recoveredInRunId: IdSchema.optional(),
  settledInRunId: IdSchema.optional(),
  safeHavenId: IdSchema.optional(),
  xpValueGp: z.number().int().nonnegative().default(0),
  receiptEventIds: z.array(IdSchema).default([]),
  notes: z.array(z.string().min(1)).default([])
});
export type CampaignTreasureParcelState = z.infer<typeof CampaignTreasureParcelStateSchema>;

export function claimTreasureParcel(parcel: CampaignTreasureParcelState, args: { eventId: string; runId?: string }): CampaignTreasureParcelState {
  return CampaignTreasureParcelStateSchema.parse({
    ...parcel,
    state: "claimed",
    currentHolder: { kind: "party" },
    ...(args.runId ? { discoveredInRunId: args.runId, claimedInRunId: args.runId } : {}),
    receiptEventIds: [args.eventId, ...parcel.receiptEventIds].filter((id, index, ids) => ids.indexOf(id) === index).slice(0, 20)
  });
}

export function recoverTreasureParcelToSafeHaven(parcel: CampaignTreasureParcelState, args: { eventId: string; safeHavenId: string; runId?: string }): CampaignTreasureParcelState {
  return CampaignTreasureParcelStateSchema.parse({
    ...parcel,
    state: "recovered_to_safety",
    currentHolder: { kind: "safe_haven", safeHavenId: args.safeHavenId },
    safeHavenId: args.safeHavenId,
    ...(args.runId ? { recoveredInRunId: args.runId } : {}),
    receiptEventIds: [args.eventId, ...parcel.receiptEventIds].filter((id, index, ids) => ids.indexOf(id) === index).slice(0, 20)
  });
}

export function cacheTreasureParcelAtRecoveryBoundary(parcel: CampaignTreasureParcelState, args: { eventId: string; holder: TreasureHolder; runId?: string }): CampaignTreasureParcelState {
  return CampaignTreasureParcelStateSchema.parse({
    ...parcel,
    state: "cached",
    currentHolder: args.holder,
    ...(args.runId ? { recoveredInRunId: args.runId } : {}),
    receiptEventIds: [args.eventId, ...parcel.receiptEventIds].filter((id, index, ids) => ids.indexOf(id) === index).slice(0, 20)
  });
}

export const SafeHavenCapabilitySchema = z.enum(["rest", "stash_treasure", "settle_treasure", "train_level_up", "hire_retainers", "buy_supplies", "recover_hp", "gather_rumors"]);
export type SafeHavenCapability = z.infer<typeof SafeHavenCapabilitySchema>;

export const SafeHavenTemplateSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  capabilities: z.array(SafeHavenCapabilitySchema).min(1),
  access: z.object({ conditions: z.array(z.string().min(1)).default([]), route: z.string().min(1).optional(), factionConstraints: z.array(z.string().min(1)).default([]), visibility: GameplayVisibilitySchema.default("referee_private") }).default(() => ({ conditions: [], factionConstraints: [], visibility: "referee_private" as const })),
  services: z.array(z.object({ id: IdSchema, name: z.string().min(1), notes: z.string().min(1).optional() })).default([]),
  risks: z.array(z.string().min(1)).default([]),
  visibility: GameplayVisibilitySchema.default("referee_private")
});
export type SafeHavenTemplate = z.infer<typeof SafeHavenTemplateSchema>;

export const CampaignSafeHavenStateSchema = z.object({
  safeHavenId: IdSchema,
  templateId: IdSchema,
  knownToParty: z.boolean().default(false),
  availableCapabilities: z.array(SafeHavenCapabilitySchema).default([]),
  stashParcelIds: z.array(IdSchema).default([]),
  lastVisitedRunId: IdSchema.optional(),
  standing: z.enum(["safe", "tenuous", "compromised", "lost"]).default("tenuous"),
  notes: z.array(z.string().min(1)).default([])
});
export type CampaignSafeHavenState = z.infer<typeof CampaignSafeHavenStateSchema>;

export const SettledTreasureXpAwardSchema = z.object({
  xpLedgerEntry: z.lazy(() => XpLedgerEntrySchema),
  settledParcels: z.array(CampaignTreasureParcelStateSchema)
});
export type SettledTreasureXpAward = z.infer<typeof SettledTreasureXpAwardSchema>;

export const XpLedgerEntrySchema = z.object({
  id: IdSchema,
  campaignId: IdSchema,
  runId: IdSchema.optional(),
  source: z.enum(["recovered_treasure", "monster_xp", "quest_reward", "referee_adjustment"]),
  sourceParcelIds: z.array(IdSchema).optional(),
  safeHavenId: IdSchema.optional(),
  totalXp: z.number().int().nonnegative(),
  participants: z.array(z.object({ characterId: IdSchema, shareXp: z.number().int().nonnegative() })).default([]),
  receiptEventIds: z.array(IdSchema).default([]),
  rulesReceiptIds: z.array(IdSchema).default([]),
  createdAt: z.string().datetime()
});
export type XpLedgerEntry = z.infer<typeof XpLedgerEntrySchema>;

export function settleRecoveredTreasure(args: {
  campaignId: string;
  runId?: string;
  eventId: string;
  safeHaven: CampaignSafeHavenState;
  parcels: CampaignTreasureParcelState[];
  participantCharacterIds: string[];
  rulesReceiptIds: string[];
  createdAt: string;
  ledgerEntryId?: string;
}): SettledTreasureXpAward | undefined {
  if (!args.safeHaven.availableCapabilities.includes("settle_treasure")) return undefined;
  const recovered = args.parcels.filter((parcel) => parcel.state === "recovered_to_safety" && parcel.safeHavenId === args.safeHaven.safeHavenId && parcel.xpValueGp > 0);
  if (!recovered.length) return undefined;
  const totalXp = recovered.reduce((sum, parcel) => sum + parcel.xpValueGp, 0);
  const participantCount = Math.max(1, args.participantCharacterIds.length);
  const xpLedgerEntry = XpLedgerEntrySchema.parse({
    id: args.ledgerEntryId ?? `xp-${args.eventId}`,
    campaignId: args.campaignId,
    ...(args.runId ? { runId: args.runId } : {}),
    source: "recovered_treasure",
    sourceParcelIds: recovered.map((parcel) => parcel.parcelId),
    safeHavenId: args.safeHaven.safeHavenId,
    totalXp,
    participants: args.participantCharacterIds.map((characterId) => ({ characterId, shareXp: Math.floor(totalXp / participantCount) })),
    receiptEventIds: [args.eventId],
    rulesReceiptIds: args.rulesReceiptIds,
    createdAt: args.createdAt
  });
  const settledParcels = recovered.map((parcel) => CampaignTreasureParcelStateSchema.parse({ ...parcel, state: "settled", settledInRunId: args.runId }));
  return SettledTreasureXpAwardSchema.parse({ xpLedgerEntry, settledParcels });
}

export const LevelingSessionSchema = z.object({
  id: IdSchema,
  campaignId: IdSchema,
  characterId: IdSchema,
  fromLevel: z.number().int().positive(),
  toLevel: z.number().int().positive(),
  status: z.enum(["available", "pending_training", "committed", "blocked"]),
  triggerLedgerEntryIds: z.array(IdSchema).default([]),
  safeHavenId: IdSchema.optional(),
  requirements: z.array(z.object({ id: IdSchema, description: z.string().min(1), satisfied: z.boolean().optional() })).default([]),
  commitReceiptEventId: IdSchema.optional(),
  rulesReceiptIds: z.array(IdSchema).default([])
});
export type LevelingSession = z.infer<typeof LevelingSessionSchema>;

export const RuleSupplementSchema = z.object({
  id: IdSchema,
  title: z.string().min(1),
  kind: z.enum(["temporary_ruling", "campaign_rule", "module_rule", "rule_citation"]).default("rule_citation"),
  scope: z.enum(["treasure_xp", "leveling", "safe_haven", "class_advancement"]),
  affectedRuleIds: z.array(IdSchema).default([]),
  sourceDocId: IdSchema,
  sourceChunkIds: z.array(IdSchema).default([]),
  summary: z.string().min(1),
  refereeReason: z.string().min(1).optional(),
  playerSafeSummary: z.string().min(1).optional(),
  expiresAt: z.string().datetime().optional(),
  commitEventId: IdSchema.optional(),
  ledgerEntryId: IdSchema.optional(),
  visibility: GameplayVisibilitySchema.default("referee_private")
});
export type RuleSupplement = z.infer<typeof RuleSupplementSchema>;

export const OseRulesCatalogArtifactSchema = z.object({
  id: IdSchema,
  system: z.string().min(1),
  docId: IdSchema,
  chunkIds: z.array(IdSchema).default([]),
  topic: z.string().min(1),
  safeSummary: z.string().min(1),
  createdAt: z.string().datetime()
});
export type OseRulesCatalogArtifact = z.infer<typeof OseRulesCatalogArtifactSchema>;

export const CampaignFactKindSchema = z.enum(["world", "npc", "location", "faction", "treasure", "rule", "relationship", "threat", "resource", "injury", "debt", "status", "rumor", "false_belief"]);
export type CampaignFactKind = z.infer<typeof CampaignFactKindSchema>;

export const CampaignFactLifecycleSchema = z.enum(["active", "superseded", "resolved", "rumor", "false_belief"]);
export type CampaignFactLifecycle = z.infer<typeof CampaignFactLifecycleSchema>;

export const CampaignFactSchema = z.object({
  schema: z.literal("CampaignFact.v1"),
  id: IdSchema,
  campaignId: IdSchema,
  kind: CampaignFactKindSchema,
  lifecycle: CampaignFactLifecycleSchema.default("active"),
  visibility: GameplayVisibilitySchema.default("referee_private"),
  subjectId: IdSchema.optional(),
  subjectLabel: z.string().min(1).max(160).optional(),
  claim: z.string().min(1).max(700),
  playerSafeClaim: z.string().min(1).max(500).optional(),
  sourceEventIds: z.array(IdSchema).default([]),
  linkedFactIds: z.array(IdSchema).default([]),
  tags: z.array(z.string().min(1).max(80)).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional()
});
export type CampaignFact = z.infer<typeof CampaignFactSchema>;

export const CampaignFactProjectionSchema = CampaignFactSchema.omit({ claim: true, linkedFactIds: true }).extend({ claim: z.string().min(1).max(700) });
export type CampaignFactProjection = z.infer<typeof CampaignFactProjectionSchema>;

export function toPlayerCampaignFactProjection(fact: CampaignFact): CampaignFactProjection | undefined {
  if (fact.visibility === "referee_private" || fact.visibility === "audience_xray") return undefined;
  if (fact.visibility === "player_private") return undefined;
  if (fact.visibility === "player_public" || fact.visibility === "party_known") {
    return CampaignFactProjectionSchema.parse({
      schema: fact.schema,
      id: fact.id,
      campaignId: fact.campaignId,
      kind: fact.kind,
      lifecycle: fact.lifecycle,
      visibility: fact.visibility,
      ...(fact.subjectId ? { subjectId: fact.subjectId } : {}),
      ...(fact.subjectLabel ? { subjectLabel: fact.subjectLabel } : {}),
      claim: fact.playerSafeClaim ?? fact.claim,
      ...(fact.playerSafeClaim ? { playerSafeClaim: fact.playerSafeClaim } : {}),
      sourceEventIds: fact.sourceEventIds,
      tags: fact.tags,
      createdAt: fact.createdAt,
      ...(fact.updatedAt ? { updatedAt: fact.updatedAt } : {})
    });
  }
  return undefined;
}

export const TableRunAppendLogEntrySchema = z.object({
  schema: z.literal("TableRunAppendLogEntry.v1"),
  sequence: z.number().int().nonnegative(),
  runId: IdSchema.optional(),
  eventId: IdSchema,
  beat: z.number().int().nonnegative(),
  eventKind: IdSchema,
  lane: IdSchema,
  visibility: z.enum(["public", "dev", "private"]),
  speaker: z.string().min(1),
  text: z.string().min(1),
  at: z.string().datetime(),
  retainedInState: z.boolean().default(true),
  factIds: z.array(IdSchema).default([])
});
export type TableRunAppendLogEntry = z.infer<typeof TableRunAppendLogEntrySchema>;

export const TableRunAppendLogIndexSchema = z.object({
  schema: z.literal("TableRunAppendLogIndex.v1"),
  campaignId: IdSchema,
  totalEntries: z.number().int().nonnegative(),
  retainedWindowSize: z.number().int().nonnegative(),
  firstSequence: z.number().int().nonnegative().optional(),
  latestSequence: z.number().int().nonnegative().optional(),
  latestEventId: IdSchema.optional(),
  updatedAt: z.string().datetime()
});
export type TableRunAppendLogIndex = z.infer<typeof TableRunAppendLogIndexSchema>;

export const ExpeditionLifecycleSchema = z.enum(["in_safe_haven", "outbound", "exploring", "encounter", "returning", "downtime", "stopped"]);
export type ExpeditionLifecycle = z.infer<typeof ExpeditionLifecycleSchema>;

export const ExpeditionSessionSchema = z.object({
  schema: z.literal("ExpeditionSession.v1"),
  id: IdSchema,
  campaignId: IdSchema,
  runId: IdSchema.optional(),
  lifecycle: ExpeditionLifecycleSchema.default("in_safe_haven"),
  safeHavenId: IdSchema.optional(),
  currentLocationId: IdSchema.optional(),
  carriedParcelIds: z.array(IdSchema).default([]),
  recoveredParcelIds: z.array(IdSchema).default([]),
  injuredCharacterIds: z.array(IdSchema).default([]),
  supplyNotes: z.array(z.string().min(1).max(220)).default([]),
  openThreadFactIds: z.array(IdSchema).default([]),
  sourceEventIds: z.array(IdSchema).default([]),
  updatedAt: z.string().datetime()
});
export type ExpeditionSession = z.infer<typeof ExpeditionSessionSchema>;

export const DowntimeActionSchema = z.object({
  schema: z.literal("DowntimeAction.v1"),
  id: IdSchema,
  campaignId: IdSchema,
  safeHavenId: IdSchema,
  kind: z.enum(["rest", "recover_hp", "settle_treasure", "stash_treasure", "hire_retainers", "buy_supplies", "gather_rumors", "train_level_up"]),
  actorCharacterIds: z.array(IdSchema).default([]),
  parcelIds: z.array(IdSchema).default([]),
  factIds: z.array(IdSchema).default([]),
  receiptEventIds: z.array(IdSchema).default([]),
  status: z.enum(["available", "chosen", "resolved", "blocked"]).default("available"),
  playerSafeSummary: z.string().min(1).max(360),
  createdAt: z.string().datetime()
});
export type DowntimeAction = z.infer<typeof DowntimeActionSchema>;

export const CampaignArcStatusSchema = z.enum(["opening", "expedition", "returning", "settlement", "downtime", "training", "closed"]);
export type CampaignArcStatus = z.infer<typeof CampaignArcStatusSchema>;

export const CampaignArcSchema = z.object({
  schema: z.literal("CampaignArc.v1"),
  id: IdSchema,
  campaignId: IdSchema,
  status: CampaignArcStatusSchema,
  expeditionIds: z.array(IdSchema).default([]),
  activeLeadFactIds: z.array(IdSchema).default([]),
  treasureParcelIds: z.array(IdSchema).default([]),
  xpLedgerEntryIds: z.array(IdSchema).default([]),
  levelingSessionIds: z.array(IdSchema).default([]),
  summary: z.string().min(1).max(700),
  updatedAt: z.string().datetime()
});
export type CampaignArc = z.infer<typeof CampaignArcSchema>;

export const CampaignArcBriefSchema = z.object({
  schema: z.literal("CampaignArcBrief.v1"),
  status: CampaignArcStatusSchema,
  aim: z.string().min(1).max(280),
  whyItMatters: z.string().min(1).max(360),
  knownRisks: z.array(z.string().min(1).max(180)).default([]),
  visibleChoices: z.array(z.string().min(1).max(180)).default([]),
  sourceFactIds: z.array(IdSchema).default([])
});
export type CampaignArcBrief = z.infer<typeof CampaignArcBriefSchema>;

export const MemoryCompactionReceiptSchema = z.object({
  schema: z.literal("MemoryCompactionReceipt.v1"),
  id: IdSchema,
  campaignId: IdSchema,
  runId: IdSchema.optional(),
  scope: z.enum(["referee_campaign_digest", "player_memory", "thread_summary"]),
  playerId: IdSchema.optional(),
  eventSequenceRange: z.object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() }),
  summary: z.string().min(1).max(1200),
  activeFactIds: z.array(IdSchema).default([]),
  resolvedFactIds: z.array(IdSchema).default([]),
  createdAt: z.string().datetime()
});
export type MemoryCompactionReceipt = z.infer<typeof MemoryCompactionReceiptSchema>;
