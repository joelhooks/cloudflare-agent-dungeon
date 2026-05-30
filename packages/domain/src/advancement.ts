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
  receiptEventIds: z.array(IdSchema).default([]),
  notes: z.array(z.string().min(1)).default([])
});
export type CampaignTreasureParcelState = z.infer<typeof CampaignTreasureParcelStateSchema>;

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
