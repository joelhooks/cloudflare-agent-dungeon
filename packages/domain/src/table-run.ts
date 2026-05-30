import { z } from "zod";

export const TableRunPhaseSchema = z.enum(["exploration", "encounter", "combat", "aftermath"]);
export type TableRunPhase = z.infer<typeof TableRunPhaseSchema>;

export const TableEventLaneSchema = z.enum(["player", "referee", "world", "rules", "dice", "clock", "commit", "error", "artifacts"]);
export const PlayerActionLabelSchema = z.enum(["THOUGHT", "TALK", "FLOAT", "ASK", "LOCK", "ATTACK", "DEFEND", "GRAB", "AID", "WITHDRAW", "CAST"]);
export type PlayerActionLabel = z.infer<typeof PlayerActionLabelSchema>;

export const RefereeRulingLabelSchema = z.enum(["THOUGHT", "RULING", "NEXT"]);
export type RefereeRulingLabel = z.infer<typeof RefereeRulingLabelSchema>;

export const TableEventKindSchema = z.enum([
  "frame_moment",
  "table_talk",
  "thought_bubble",
  "ask_referee",
  "float_action",
  "lock_action",
  "referee_thought",
  "ruling",
  "world_update",
  "procedure_check",
  "dice_roll",
  "clock_tick",
  "encounter_start",
  "combat_round",
  "commit",
  "error"
]);

export const TableEventLinkSchema = z.object({ label: z.string().min(1), href: z.string().optional(), id: z.string().optional() });

export const TableEventSchema = z.object({
  schema: z.union([z.literal("TableEvent.v1"), z.literal("TownModuleTableEvent.v1")]),
  id: z.string().min(1),
  at: z.string().min(1),
  beat: z.number().int().nonnegative(),
  visibility: z.enum(["public", "dev", "private"]),
  lane: TableEventLaneSchema,
  agentId: z.string().optional(),
  speaker: z.string().min(1),
  kind: TableEventKindSchema,
  text: z.string().min(1),
  devText: z.string().optional(),
  links: z.array(TableEventLinkSchema).optional(),
  statePatch: z.unknown().optional()
});
export type TableEvent = z.infer<typeof TableEventSchema>;

export const PlayerActionProposalSchema = z.object({
  label: PlayerActionLabelSchema.optional(),
  body: z.string().min(1),
  sourceText: z.string().min(1).optional()
});
export type PlayerActionProposal = z.infer<typeof PlayerActionProposalSchema>;

export const RefereeRulingSchema = z.object({
  thought: z.string().optional(),
  ruling: z.string().min(1),
  next: z.string().min(1).optional(),
  sourceText: z.string().min(1).optional()
});
export type RefereeRuling = z.infer<typeof RefereeRulingSchema>;

export function parseLabeledActionProposal(text: string, labels: readonly PlayerActionLabel[]): PlayerActionProposal {
  const pattern = new RegExp(`(?:^|\\n|\\b)(${labels.join("|")})\\s*:`, "i");
  const match = text.match(pattern);
  if (!match || match.index === undefined) return PlayerActionProposalSchema.parse({ body: text.trim(), sourceText: text });
  const label = match[1]?.toUpperCase();
  const bodyStart = match.index + match[0].length;
  return PlayerActionProposalSchema.parse({ ...(label ? { label } : {}), body: text.slice(bodyStart).trim() || text.replace(pattern, "").trim(), sourceText: text });
}

export function parseRefereeRulingText(text: string): RefereeRuling {
  const thought = text.match(/THOUGHT:\s*([\s\S]*?)(?:\n\s*RULING:|$)/i)?.[1]?.trim();
  const ruling = text.match(/RULING:\s*([\s\S]*?)(?:\n\s*NEXT:|$)/i)?.[1]?.trim();
  const next = text.match(/NEXT:\s*([\s\S]*)$/i)?.[1]?.trim();
  return RefereeRulingSchema.parse({ ...(thought ? { thought } : {}), ruling: ruling || text.trim(), ...(next ? { next } : {}), sourceText: text });
}

export const CombatObjectiveSchema = z.object({ 
  kind: z.enum(["hold_door", "grab_object", "stop_messenger", "extract_wounded"]),
  text: z.string().min(1),
  progress: z.number().int().nonnegative(),
  target: z.number().int().positive()
});
export type CombatObjective = z.infer<typeof CombatObjectiveSchema>;

export const CombatStateSchema = z.object({
  round: z.number().int().nonnegative(),
  foe: z.string().min(1),
  foeHp: z.number().int().nonnegative(),
  foeArmorClass: z.number().int(),
  foeMaxHp: z.number().int().positive().optional(),
  trigger: z.string().min(1),
  objective: CombatObjectiveSchema.optional()
});
export type CombatState = z.infer<typeof CombatStateSchema>;

export const LastEncounterSchema = z.object({
  foe: z.string().min(1),
  outcome: z.enum(["defeated", "escaped", "avoided"]),
  beat: z.number().int().nonnegative()
});
export type LastEncounter = z.infer<typeof LastEncounterSchema>;

export const TableClockSchema = z.object({
  name: z.string().min(1),
  value: z.number().int().nonnegative(),
  max: z.number().int().positive(),
  note: z.string().optional()
});
export type TableClock = z.infer<typeof TableClockSchema>;

export const TablePartyMemberStatusSchema = z.enum(["active", "incapacitated", "dead", "missing"]);
export type TablePartyMemberStatus = z.infer<typeof TablePartyMemberStatusSchema>;

export const TablePartyMemberSchema = z.object({
  playerId: z.string().min(1),
  player: z.string().min(1),
  character: z.string().min(1),
  className: z.string().optional(),
  hp: z.number().int().optional(),
  armorClass: z.number().int().optional(),
  inventory: z.array(z.string()).optional(),
  position: z.string().optional(),
  intent: z.string().optional(),
  status: TablePartyMemberStatusSchema.default("active")
});
export type TablePartyMember = z.infer<typeof TablePartyMemberSchema>;

export function clampTableClock(clock: TableClock): TableClock {
  const parsed = TableClockSchema.parse(clock);
  return { ...parsed, value: Math.min(parsed.max, Math.max(0, parsed.value)) };
}

export function normalizeTablePartyMember(member: z.input<typeof TablePartyMemberSchema>): TablePartyMember {
  const parsed = TablePartyMemberSchema.parse(member);
  if ((parsed.status === "active" || !parsed.status) && typeof parsed.hp === "number" && parsed.hp <= 0) return { ...parsed, hp: 0, status: "incapacitated" };
  return parsed;
}

export function normalizeTableRunPatch<T extends { clocks?: z.input<typeof TableClockSchema>[]; party?: z.input<typeof TablePartyMemberSchema>[] }>(patch: T): T & { clocks?: TableClock[]; party?: TablePartyMember[] } {
  return {
    ...patch,
    ...(Array.isArray(patch.clocks) ? { clocks: patch.clocks.map((clock) => clampTableClock(TableClockSchema.parse(clock))) } : {}),
    ...(Array.isArray(patch.party) ? { party: patch.party.map(normalizeTablePartyMember) } : {})
  };
}

export const TableRunLimitsSchema = z.object({
  maxBeats: z.number().int().positive().optional(),
  sampleSeconds: z.number().int().positive().optional(),
  startedAtMs: z.number().optional()
});
export type TableRunLimits = z.infer<typeof TableRunLimitsSchema>;

export const TableRunStartOptionsSchema = z.object({
  difficulty: z.number().optional(),
  maxBeats: z.number().optional(),
  sampleSeconds: z.number().optional()
});
export type TableRunStartOptions = z.infer<typeof TableRunStartOptionsSchema>;

export const NormalizedTableRunStartOptionsSchema = z.object({
  difficulty: z.number().int().min(1).max(8).optional(),
  maxBeats: z.number().int().positive().optional(),
  sampleSeconds: z.number().int().positive().optional()
});
export type NormalizedTableRunStartOptions = z.infer<typeof NormalizedTableRunStartOptionsSchema>;

export function normalizeTableRunStartOptions(options: TableRunStartOptions): NormalizedTableRunStartOptions {
  const parsed = TableRunStartOptionsSchema.parse(options);
  return NormalizedTableRunStartOptionsSchema.parse({
    ...(typeof parsed.difficulty === "number" && Number.isFinite(parsed.difficulty) ? { difficulty: Math.min(8, Math.max(1, Math.round(parsed.difficulty))) } : {}),
    ...(typeof parsed.maxBeats === "number" && Number.isFinite(parsed.maxBeats) ? { maxBeats: Math.max(1, Math.round(parsed.maxBeats)) } : {}),
    ...(typeof parsed.sampleSeconds === "number" && Number.isFinite(parsed.sampleSeconds) ? { sampleSeconds: Math.max(1, Math.round(parsed.sampleSeconds)) } : {})
  });
}

export const TableRunCoreStateSchema = z.object({ 
  mode: z.enum(["idle", "running", "stopped", "failed"]),
  runId: z.string().optional(),
  moduleId: z.string().min(1),
  moduleTitle: z.string().min(1),
  beat: z.number().int().nonnegative(),
  moment: z.number().int().nonnegative(),
  location: z.string().min(1),
  locationId: z.string().optional(),
  sceneId: z.string().optional(),
  visitedLocationIds: z.array(z.string()).default([]),
  activeFrontIds: z.array(z.string()).default([]),
  phase: TableRunPhaseSchema.default("exploration"),
  activeQuestion: z.string().min(1),
  affordances: z.array(z.string()).default([]),
  activeLeads: z.array(z.string()).default([]),
  clocks: z.array(TableClockSchema).default([]),
  party: z.array(TablePartyMemberSchema).default([]),
  combat: CombatStateSchema.optional(),
  lastEncounter: LastEncounterSchema.optional(),
  difficulty: z.number().int().min(1).max(8).default(1),
  runLimits: TableRunLimitsSchema.optional(),
  events: z.array(TableEventSchema).default([]),
  modelCallsUsed: z.number().int().nonnegative().default(0),
  stoppedReason: z.string().optional(),
  error: z.string().optional()
});
export type TableRunCoreState = z.infer<typeof TableRunCoreStateSchema>;

export function advanceCombatObjective(objective: CombatObjective | undefined, tableText: string): { objective?: CombatObjective; completed: boolean; progressText?: string } {
  if (!objective) return { completed: false };
  const matched = objective.kind === "hold_door" ? /hold|brace|block|door|flood|guard|defend/i.test(tableText)
    : objective.kind === "grab_object" ? /grab|take|ledger|token|cup|evidence|object/i.test(tableText)
      : objective.kind === "stop_messenger" ? /stop|block|pin|trip|attack|grab|messenger|cutter|runner/i.test(tableText)
        : /aid|drag|carry|withdraw|protect|wounded|ally/i.test(tableText);
  if (!matched) return { objective, completed: false };
  const next = { ...objective, progress: Math.min(objective.target, objective.progress + 1) };
  return { objective: next, completed: next.progress >= next.target, progressText: `${next.progress}/${next.target}` };
}

export type LocalityRequirement = {
  pattern: RegExp;
  anchor: string;
};

export const defaultLocalityRequirements: LocalityRequirement[] = [
  { pattern: /ledger|cup|mort/i, anchor: "Mort's bar" },
  { pattern: /north ditch|ditch door|shell-token|shell token/i, anchor: "North Ditch door" },
  { pattern: /sluice|black water|water|drain/i, anchor: "sluice mouth" }
];

export function requiredLocalityForAction(text: string, requirements: LocalityRequirement[] = defaultLocalityRequirements): string | undefined {
  return requirements.find((requirement) => requirement.pattern.test(text))?.anchor;
}

export const LocalityActionSchema = z.object({
  agentId: z.string().optional(),
  speaker: z.string().min(1),
  text: z.string().min(1)
});
export type LocalityAction = z.infer<typeof LocalityActionSchema>;

export const LocalityCorrectionSchema = z.object({
  playerId: z.string().min(1),
  character: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  revisedIntent: z.string().min(1)
});
export type LocalityCorrection = z.infer<typeof LocalityCorrectionSchema>;

export function applyLocalityRequirements(input: {
  party: TablePartyMember[];
  actions: LocalityAction[];
  fallbackLocation: string;
  requirements?: LocalityRequirement[];
}): { party: TablePartyMember[]; corrections: LocalityCorrection[] } {
  let party = input.party;
  const corrections: LocalityCorrection[] = [];
  for (const rawAction of input.actions) {
    const action = LocalityActionSchema.parse(rawAction);
    const member = party.find((candidate) => candidate.playerId === action.agentId || candidate.character === action.speaker);
    if (!member) continue;
    const required = requiredLocalityForAction(action.text, input.requirements);
    const position = member.position ?? input.fallbackLocation;
    if (!required || position === required) continue;
    const revisedIntent = `move/setup toward ${required}; original action needs position first`;
    party = party.map((candidate) => candidate.playerId === member.playerId ? { ...candidate, position: required, intent: revisedIntent } : candidate);
    corrections.push(LocalityCorrectionSchema.parse({ playerId: member.playerId, character: member.character, from: position, to: required, revisedIntent }));
  }
  return { party, corrections };
}

export function starterGearForClass(className: string | undefined): string[] {
  const normalized = (className ?? "").toLowerCase();
  if (normalized.includes("fighter") || normalized.includes("dwarf") || normalized.includes("halfling")) return ["shield", "weapon"];
  if (normalized.includes("thief")) return ["rope", "knife", "tools"];
  if (normalized.includes("cleric")) return ["holy symbol", "mace"];
  if (normalized.includes("magic")) return ["fragile scroll", "chalk", "oil"];
  return ["torch", "knife"];
}

export const TableRunSummarySchema = z.object({
  mode: z.enum(["idle", "running", "stopped", "failed"]),
  difficulty: z.number().int().min(1).max(8),
  beat: z.number().int().nonnegative(),
  phase: TableRunPhaseSchema,
  stoppedReason: z.string().optional(),
  error: z.string().optional(),
  clocks: z.array(TableClockSchema),
  lastEncounter: LastEncounterSchema.optional(),
  combatObjective: CombatObjectiveSchema.optional(),
  party: z.array(TablePartyMemberSchema),
  visitedLocationIds: z.array(z.string()).default([]),
  activeFrontIds: z.array(z.string()).default([]),
  counts: z.object({
    events: z.number().int().nonnegative(),
    modelCalls: z.number().int().nonnegative(),
    localityCorrections: z.number().int().nonnegative(),
    objectiveProgress: z.number().int().nonnegative(),
    combatRows: z.number().int().nonnegative(),
    inactivePartyMembers: z.number().int().nonnegative().default(0),
    clockOverflows: z.number().int().nonnegative().default(0),
    duplicateCommitBeats: z.number().int().nonnegative().default(0)
  }),
  interesting: z.array(TableEventSchema.pick({ beat: true, lane: true, kind: true, speaker: true, text: true }))
});
export type TableRunSummary = z.infer<typeof TableRunSummarySchema>;

export function tableRunSampleStopReason(state: Pick<TableRunCoreState, "beat" | "runLimits">, nowMs: number): string | undefined {
  const maxBeats = state.runLimits?.maxBeats;
  const sampleSeconds = state.runLimits?.sampleSeconds;
  if (maxBeats && state.beat >= maxBeats) return `sample maxBeats ${maxBeats} reached`;
  if (sampleSeconds && typeof state.runLimits?.startedAtMs === "number" && Number.isFinite(state.runLimits.startedAtMs) && nowMs - state.runLimits.startedAtMs >= sampleSeconds * 1000) return `sampleSeconds ${sampleSeconds}s reached`;
  return undefined;
}

export function tableRunHardStopReason(input: { phase: TableRunPhase; maxMoments: number; maxCombatRounds: number; maxAfterCombatMoments: number }): string {
  if (input.phase === "combat") return `server hard-stop after ${input.maxMoments} moments and ${input.maxCombatRounds} combat rounds`;
  if (input.phase === "aftermath") return `server hard-stop after ${input.maxMoments} moments, combat, and ${input.maxAfterCombatMoments} aftermath beats`;
  return `server hard-stop after ${input.maxMoments} moments`;
}

export function summarizeTableRun(state: TableRunCoreState): TableRunSummary {
  const interesting = state.events.filter((event) => /Party tactic|Objective|Encounter|drops|Aftermath|Position matters|acts first|runner|water takes|damage|attacks|sample|maxBeats|sampleSeconds/i.test(event.text)).slice(0, 30).map((event) => ({ beat: event.beat, lane: event.lane, kind: event.kind, speaker: event.speaker, text: event.text }));
  const commitBeats = new Map<number, number>();
  for (const event of state.events) {
    if (event.kind !== "commit") continue;
    commitBeats.set(event.beat, (commitBeats.get(event.beat) ?? 0) + 1);
  }

  return TableRunSummarySchema.parse({
    mode: state.mode,
    difficulty: state.difficulty,
    beat: state.beat,
    phase: state.phase,
    stoppedReason: state.stoppedReason,
    error: state.error,
    clocks: state.clocks,
    lastEncounter: state.lastEncounter,
    combatObjective: state.combat?.objective,
    party: state.party,
    visitedLocationIds: state.visitedLocationIds,
    activeFrontIds: state.activeFrontIds,
    counts: {
      events: state.events.length,
      modelCalls: state.modelCallsUsed,
      localityCorrections: state.events.filter((event) => /Position matters/i.test(event.text)).length,
      objectiveProgress: state.events.filter((event) => /Objective progress/i.test(event.text)).length,
      combatRows: state.events.filter((event) => event.kind === "combat_round").length,
      inactivePartyMembers: state.party.filter((member) => (member.status ?? "active") !== "active" || (member.hp ?? 1) <= 0).length,
      clockOverflows: state.clocks.filter((clock) => clock.value > clock.max).length,
      duplicateCommitBeats: [...commitBeats.values()].filter((count) => count > 1).length
    },
    interesting
  });
}
