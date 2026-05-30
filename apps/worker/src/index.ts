import { Agent, getAgentByName, routeAgentRequest, type Connection, type ConnectionContext, type FiberRecoveryContext, type FiberRecoveryResult, type WSMessage } from "agents";
import { R2SkillProvider } from "agents/experimental/memory/session";
import { Think, type ChunkContext, type Session, type TurnConfig, type TurnContext } from "@cloudflare/think";
import { createWorkersAI } from "workers-ai-provider";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { Output, generateObject, streamObject, tool, type LanguageModel, type ToolSet, type UIMessage } from "ai";
import { z } from "zod";
import {
  initialPrototypeState,
  prototypeTavernTownUiPage,
  type PrototypeTavernTownState
} from "./prototype-tavern-town-ui";
import {
  createVillageSkeletonSkillCard,
  initialTownForgeState,
  renderTownForgeArtifacts,
  sanitizeTownGraphForMonitor,
  townForgeMonitorState,
  townForgeReceipt,
  townForgeUiPage,
  TOWN_FORGE_ARTIFACT_REPO,
  TOWN_FORGE_R2_KEY,
  TOWN_FORGE_R2_PREFIX,
  TOWN_FORGE_SKILL_ARTIFACT_REPO,
  TOWN_FORGE_SKILL_KEY,
  TOWN_FORGE_SKILL_LABEL,
  TownClockSchema,
  TownForgeStateSchema,
  TownGraphSchema,
  TownLocationSchema,
  TownNpcSchema,
  TownPublicProjectionSchema,
  TownRumorSchema,
  LatentEncounterSchema,
  type ArtifactSyncStatus,
  type TownForgeReceipt,
  type TownForgeState,
  type TownGraph
} from "./town-forge";

import { MemoryFS } from "./memory-fs";
import { FENWATER_DRAINAGE_ARTIFACT_COMMIT, FENWATER_DRAINAGE_ARTIFACT_PATHS, adventureModuleFromFenwaterTownGraph } from "./adventure-module/fenwater";
import { fenwaterInitialClocks, fenwaterInitialLeads, fenwaterLocationTitle, fenwaterOpeningAffordances, inferFenwaterFrontIds, inferFenwaterLocationId } from "./adventure-module/fenwater-content";
import {
  advanceCampaignTurn,
  commitAdventureChoice,
  commitCharacterCreation,
  commitRefereeOutcome,
  projectForDevMonitor,
  projectForMonitor,
  rollCharacterCreationDraft,
  seedTavernCampaign,
  travelToChosenHook,
  CombatStateSchema as DomainCombatStateSchema,
  LastEncounterSchema as DomainLastEncounterSchema,
  TableClockSchema as DomainTableClockSchema,
  TableEventSchema as DomainTableEventSchema,
  TablePartyMemberSchema as DomainTablePartyMemberSchema,
  TableRunCoreStateSchema as DomainTableRunCoreStateSchema,
  TableRunLimitsSchema as DomainTableRunLimitsSchema,
  advanceCombatObjective as advanceDomainCombatObjective,
  normalizeTableRunPatch,
  normalizeTableRunStartOptions,
  parseLabeledActionProposal,
  parseRefereeRulingText,
  summarizeTableRun as summarizeDomainTableRun,
  tableRunHardStopReason,
  tableRunSampleStopReason,
  requiredLocalityForAction as requiredDomainLocalityForAction,
  starterGearForClass as domainStarterGearForClass,
  type AdventureChoice,
  type Campaign,
  type Character,
  type CharacterCreationDraft,
  type CharacterCreationPlan,
  type HookId,
  type PlayerId,
  type RefereeOutcome,
  type TableRunCoreState,
  type Store,
  type StoreId
} from "@cloudflare-agent-dungeon/domain";

const TownGraphSurfaceSchema = TownGraphSchema.omit({ clocks: true });
const TownGraphClockSetSchema = z.object({ clocks: TownGraphSchema.shape.clocks });
const TownForgeSkeletonIdSchema = z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/);
const TownForgeSkeletonSchema = z.object({
  schema: z.literal("TownForgeSkeleton.v1"),
  id: TownForgeSkeletonIdSchema,
  name: z.string().min(1).max(140),
  premise: z.string().min(1).max(620),
  publicVibe: z.string().min(1).max(620),
  hiddenPressure: z.string().min(1).max(620),
  locations: z.array(z.object({
    id: TownForgeSkeletonIdSchema,
    name: z.string().min(1).max(120),
    kind: TownLocationSchema.shape.kind,
    purpose: z.string().min(1).max(220),
    linkedNpcIds: z.array(TownForgeSkeletonIdSchema).max(8).default([]),
    linkedRumorIds: z.array(TownForgeSkeletonIdSchema).max(8).default([])
  })).min(5).max(7),
  npcs: z.array(z.object({
    id: TownForgeSkeletonIdSchema,
    name: z.string().min(1).max(120),
    role: z.string().min(1).max(120),
    purpose: z.string().min(1).max(220),
    linkedLocationIds: z.array(TownForgeSkeletonIdSchema).min(1).max(4)
  })).min(6).max(10),
  rumors: z.array(z.object({
    id: TownForgeSkeletonIdSchema,
    seed: z.string().min(1).max(220),
    linkedLocationIds: z.array(TownForgeSkeletonIdSchema).max(4).default([]),
    linkedNpcIds: z.array(TownForgeSkeletonIdSchema).max(4).default([])
  })).min(6).max(6),
  latentEncounters: z.array(z.object({
    id: TownForgeSkeletonIdSchema,
    title: z.string().min(1).max(140),
    type: LatentEncounterSchema.shape.type,
    pressure: z.string().min(1).max(220),
    linkedLocationIds: z.array(TownForgeSkeletonIdSchema).max(4).default([]),
    linkedNpcIds: z.array(TownForgeSkeletonIdSchema).max(4).default([])
  })).min(4).max(6),
  clocks: z.array(z.object({
    id: TownForgeSkeletonIdSchema,
    name: z.string().min(1).max(120),
    pressure: z.string().min(1).max(220)
  })).min(2).max(3),
  publicProjection: z.object({
    startingLocationId: TownForgeSkeletonIdSchema,
    visibleLocationIds: z.array(TownForgeSkeletonIdSchema).min(1).max(8),
    visibleNpcIds: z.array(TownForgeSkeletonIdSchema).min(1).max(10),
    visibleRumorIds: z.array(TownForgeSkeletonIdSchema).min(1).max(8)
  }),
  refereeOpenQuestions: z.array(z.string().min(1).max(260)).min(2).max(8),
  validationNotes: z.array(z.string().min(1).max(260)).min(1).max(8)
});

const TownForgeBriefSchema = TownForgeSkeletonSchema.pick({
  schema: true,
  id: true,
  name: true,
  premise: true,
  publicVibe: true,
  hiddenPressure: true,
  refereeOpenQuestions: true,
  validationNotes: true
});
const TownForgeLocationStubSetSchema = z.object({ locations: TownForgeSkeletonSchema.shape.locations });
const TownForgeNpcStubSetSchema = z.object({ npcs: TownForgeSkeletonSchema.shape.npcs });
const TownForgeRumorStubSetSchema = z.object({ rumors: TownForgeSkeletonSchema.shape.rumors });
const TownForgeEncounterStubSetSchema = z.object({ latentEncounters: TownForgeSkeletonSchema.shape.latentEncounters });
const TownForgeClockStubSetSchema = z.object({ clocks: TownForgeSkeletonSchema.shape.clocks });
const TownForgeProjectionStubSchema = z.object({ publicProjection: TownForgeSkeletonSchema.shape.publicProjection });

type TownForgeSkeleton = z.infer<typeof TownForgeSkeletonSchema>;

type TownForgeDraftGraph = {
  skeleton: TownForgeSkeleton;
  generatedAt: string;
  locations: z.infer<typeof TownLocationSchema>[];
  npcs: z.infer<typeof TownNpcSchema>[];
  rumors: z.infer<typeof TownRumorSchema>[];
  latentEncounters: z.infer<typeof LatentEncounterSchema>[];
  publicProjection?: z.infer<typeof TownPublicProjectionSchema>;
  clocks: z.infer<typeof TownClockSchema>[];
};

const AdventureChoiceSchema = z.object({
  hookId: z.string().min(1),
  approach: z.enum(["cautious", "bold", "social", "stealthy", "mystic", "other"]),
  tableSpeech: z.string().optional(),
  innerMonologue: z.string().optional(),
  goal: z.string().optional(),
  fear: z.string().optional(),
  reason: z.string().optional()
});

type AdventureChoiceOutput = z.infer<typeof AdventureChoiceSchema>;

const CharacterCreationPlanSchema = z.object({
  name: z.string().min(1),
  className: z.enum(["fighter", "cleric", "magic-user", "thief", "dwarf", "elf", "halfling"]),
  abilitySwap: z
    .object({
      first: z.enum(["strength", "intelligence", "wisdom", "dexterity", "constitution", "charisma"]),
      second: z.enum(["strength", "intelligence", "wisdom", "dexterity", "constitution", "charisma"])
    })
    .optional(),
  alignment: z.enum(["lawful", "neutral", "chaotic"]),
  deity: z.string().optional(),
  reasonExceptional: z.string().min(1),
  innerMonologue: z.string().optional(),
  goal: z.string().optional(),
  fear: z.string().optional(),
  purchases: z.array(z.object({ itemId: z.string(), quantity: z.number().int().positive() }))
});

type CharacterCreationPlanOutput = z.infer<typeof CharacterCreationPlanSchema>;

const publicOutcomeForbiddenTerms = [
  "hidden agenda",
  "secret agenda",
  "hiddenagenda",
  "private note",
  "unrevealed",
  "wake the ash-cobra",
  "monopolize salvage",
  "hide the saint-bell"
];

const RefereeOutcomeSchema = z.object({
  publicNarration: z.string().min(1),
  pressure: z.string().min(1),
  nextQuestion: z.string().min(1),
  privateReasoning: z.string().min(1)
});

const AgentProcessReportSchema = z.object({
  message: z.string().min(1).max(220),
  tableTalk: z.string().max(420).optional(),
  process: z.string().min(1).max(700),
  privateJournal: z.string().max(700).optional(),
  status: z.enum(["running", "done", "warning"]).default("running")
});

const TavernIntentSchema = z.object({
  title: z.string().min(1),
  tableSpeech: z.string().min(1).max(360),
  declaredAction: z.string().min(1).max(280),
  intentKind: z.enum(["talk", "ask", "buy", "hire", "observe", "reveal_backstory", "leave", "wait", "other"]),
  target: z.string().max(120).optional(),
  processReasoning: z.string().min(1).max(420),
  innerMonologue: z.string().min(1).max(420),
  privateGoal: z.string().min(1).max(220),
  privateFear: z.string().min(1).max(220)
});

type TavernIntentOutput = z.infer<typeof TavernIntentSchema>;

function repairTavernIntent(input: unknown): TavernIntentOutput {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const clip = (key: string, max: number, fallback: string) => String(value[key] ?? fallback).slice(0, max);
  return TavernIntentSchema.parse({
    title: clip("title", 160, "Act on the visible table state"),
    tableSpeech: clip("tableSpeech", 360, "I take the next careful step and watch what changes."),
    declaredAction: clip("declaredAction", 280, "Choose a cautious visible action that follows the current thread."),
    intentKind: TavernIntentSchema.shape.intentKind.safeParse(value.intentKind).success ? value.intentKind : "other",
    ...(typeof value.target === "string" ? { target: value.target.slice(0, 120) } : {}),
    processReasoning: clip("processReasoning", 420, "The player acts only from public table state and their own private memory."),
    innerMonologue: clip("innerMonologue", 420, "I need to learn more without assuming hidden truth."),
    privateGoal: clip("privateGoal", 220, "Find a safe lead."),
    privateFear: clip("privateFear", 220, "Misreading the danger.")
  });
}

type TavernIntent = Pick<TavernIntentOutput, "title" | "tableSpeech" | "declaredAction" | "intentKind" | "target" | "processReasoning"> & {
  playerId: PlayerId;
  playerName: string;
  character: string;
  actor: string;
};

type PendingPrivateTavernIntent = Pick<TavernIntentOutput, "innerMonologue" | "privateGoal" | "privateFear"> & {
  beat: number;
  declaredAction: string;
  intentKind: TavernIntentOutput["intentKind"];
  at: string;
};

const PrototypeNpcSchema = z.object({
  name: z.string(),
  role: z.string(),
  want: z.string(),
  memory: z.string(),
  disposition: z.string()
});

const PrototypePartyMemberSchema = z.object({
  player: z.string(),
  character: z.string(),
  goal: z.string(),
  fear: z.string(),
  inventory: z.array(z.string())
});

const TavernBeatSchema = z.object({
  actor: z.string().min(1).max(120),
  title: z.string().min(1).max(160),
  tableText: z.string().min(1).max(1000),
  processReasoning: z.string().min(1).max(420),
  devReasoning: z.string().min(1).max(420),
  nextAffordances: z.array(z.string().min(1).max(180)).min(3).max(7),
  visibleThreads: z.array(z.string().min(1).max(180)).min(1).max(7),
  npcUpdates: z.array(PrototypeNpcSchema).optional(),
  partyUpdates: z.array(PrototypePartyMemberSchema).optional(),
  rulesUsed: z.array(z.string()).optional()
});

const TavernSetupSchema = z.object({
  location: z.string().min(1).max(140),
  premise: z.string().min(1).max(420),
  openingScene: z.string().min(1).max(1000),
  npcs: z.array(PrototypeNpcSchema).min(3).max(5),
  startingAffordances: z.array(z.string().min(1).max(180)).min(3).max(7),
  visibleThreads: z.array(z.string().min(1).max(180)).min(3).max(7),
  refereeProcess: z.string().min(1).max(420),
  devReasoning: z.string().min(1).max(420)
});

type TavernBeat = z.infer<typeof TavernBeatSchema>;
type TavernSetup = z.infer<typeof TavernSetupSchema>;

type PrototypeRuleReceipt = {
  id: string;
  docId: string;
  chunkIndex?: number;
  headingPath?: string[];
  snippet?: string;
};

type OsePlaybookAudience = "player" | "referee";

type OsePlaybookPointer = {
  label: string;
  audience: OsePlaybookAudience;
  summary: string;
  chunkId: string;
};

const OSE_PLAYBOOK_POINTERS: OsePlaybookPointer[] = [
  {
    label: "Caller and party organization",
    audience: "player",
    summary: "Player-safe reminder: choose who speaks for the party when time/pressure matters; this is table procedure, not hidden rules access.",
    chunkId: "old-school-essentials-basic-rules-v1-4-a4d9608ea98b:s191:n0"
  },
  {
    label: "Thief capability pointer",
    audience: "player",
    summary: "Player-safe reminder: thieves have distinct risky procedures; ask the Referee for table-visible chances instead of reading the rules corpus directly.",
    chunkId: "old-school-essentials-basic-rules-v1-4-a4d9608ea98b:s127:n0"
  },
  {
    label: "Character creation class abilities",
    audience: "player",
    summary: "Player-safe pointer for class-shaped choices during Session 0; do not quote raw book text in public output.",
    chunkId: "old-school-essentials-basic-rules-v1-4-a4d9608ea98b:s70:n0"
  },
  {
    label: "Referee role",
    audience: "referee",
    summary: "Referee-only pointer for adjudication posture, impartiality, and keeping hidden information behind the Referee firewall.",
    chunkId: "old-school-essentials-classic-fantasy-rules-tome-3751c5149a24:s659:n0"
  },
  {
    label: "Retainers and hiring pressure",
    audience: "referee",
    summary: "Referee/player-safe pointer for hireling/retainer procedures; expose bounded table artifacts instead of raw corpus text.",
    chunkId: "old-school-essentials-classic-fantasy-rules-tome-3751c5149a24:s178:n0"
  }
];

type AgentBrainRole = "player-a" | "player-b" | "referee" | "table";

type FrozenTownModuleRef = {
  schema: "FrozenTownModuleRef.v1";
  townId: string;
  townName: string;
  version: string;
  sourceArtifactRepo?: string | undefined;
  sourceArtifactCommit?: string | undefined;
  frozenAt: string;
  r2: {
    graph: string;
    publicProjection: string;
    refereePrivate: string;
    receipts: string;
  };
};

const FrozenTownModuleRefSchema = z.object({
  schema: z.literal("FrozenTownModuleRef.v1"),
  townId: z.string().min(1),
  townName: z.string().min(1),
  version: z.string().min(1),
  sourceArtifactRepo: z.string().optional(),
  sourceArtifactCommit: z.string().optional(),
  frozenAt: z.string().min(1),
  r2: z.object({
    graph: z.string().min(1),
    publicProjection: z.string().min(1),
    refereePrivate: z.string().min(1),
    receipts: z.string().min(1)
  })
});

type AgentBrainArtifactRecord = {
  role: AgentBrainRole;
  repoName: string;
  remote?: string;
  lastCommit?: string;
  lastSyncedBeat?: number;
  lastSyncedAt?: string;
  status: "synced" | "skipped" | "error";
  error?: string;
};

type AgentBrainSyncResult = AgentBrainArtifactRecord;

type BrainMemoryEntry = {
  beat: number;
  at: string;
  summary: string;
};

type PlayerAgentState = {
  playerId?: PlayerId;
  brainSummary: string;
  currentGoal?: string;
  currentFear?: string;
  privateTheories: string[];
  relationships: string[];
  recentMemories: BrainMemoryEntry[];
  soulMd?: string;
  identityMd?: string;
  pendingTavernIntent?: PendingPrivateTavernIntent;
  expectedTavernTool?: "submit_tavern_intent" | "tavern_intent_object";
  lastSubmittedTavernIntent?: TavernIntentOutput & { at: string; requestBeat?: number };
  updatedAt?: string;
};

type RefereeAgentState = {
  brainSummary: string;
  npcMemory: string[];
  frontNotes: string[];
  rulesNotes: string[];
  unresolvedQuestions: string[];
  recentMemories: BrainMemoryEntry[];
  expectedTavernTool?: "submit_referee_beat" | "referee_beat_object";
  expectedTownForgeTool?: "load_create_village_skeleton" | "submit_town_forge" | "town_forge_object";
  lastSubmittedTavernBeat?: TavernBeat & { at: string; requestBeat?: number };
  lastSubmittedTownGraph?: TownGraph & { at: string };
  updatedAt?: string;
};

type PlayerTavernMemoryInput = {
  current: PrototypeTavernTownState;
  committed: PrototypeTavernTownState;
  intent: TavernIntent;
  beat: TavernBeat;
  receipts: PrototypeRuleReceipt[];
};

type RefereeTavernMemoryInput = {
  current: PrototypeTavernTownState;
  committed: PrototypeTavernTownState;
  playerIntents: TavernIntent[];
  beat: TavernBeat;
  receipts: PrototypeRuleReceipt[];
};

type AgentBrainStore = {
  syncMarkdown(input: {
    repoName: string;
    role: AgentBrainRole;
    files: Record<string, string>;
    message: string;
    beat: number;
  }): Promise<AgentBrainSyncResult>;
};

function playbookUrl(chunkId: string, lite = true): string {
  return `https://joelclaw.com/api/docs/chunks/${chunkId}?lite=${lite ? "true" : "false"}&includeEmbedding=false`;
}

function formatOsePlaybookContext(audience: OsePlaybookAudience): string {
  const pointers = OSE_PLAYBOOK_POINTERS.filter((pointer) => pointer.audience === audience || (audience === "referee" && pointer.audience === "player"));
  return [
    "OSE playbooks are source pointers, not raw book text. Do not quote copyrighted rules corpus into public output.",
    audience === "player"
      ? "PlayerAgent rule: use these as table-safe reminders only. Ask the Referee for adjudication; do not browse global rules."
      : "RefereeAgent rule: use these pointers for adjudication checks and emit bounded player-safe artifacts with chunk IDs when needed.",
    ...pointers.map((pointer) => [
      `- ${pointer.label}`,
      `  summary: ${pointer.summary}`,
      `  chunkId: ${pointer.chunkId}`,
      `  playerSafeUrl: ${playbookUrl(pointer.chunkId, true)}`,
      audience === "referee" ? `  refereeLookupUrl: ${playbookUrl(pointer.chunkId, false)}` : ""
    ].filter(Boolean).join("\n"))
  ].join("\n");
}

function userMessage(text: string, id = crypto.randomUUID()): UIMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text }]
  } satisfies UIMessage;
}

function uiMessageText(message: UIMessage | undefined): string {
  if (!message) return "";
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

function extractJsonObjectText(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  return text.slice(first, last + 1);
}

function parseLastAssistantJson<T>(messages: UIMessage[], schema: z.ZodType<T>): { ok: true; value: T } | { ok: false; error: string } {
  const assistant = [...messages].reverse().find((message) => message.role === "assistant");
  const text = uiMessageText(assistant);
  const jsonText = extractJsonObjectText(text);
  if (!jsonText) return { ok: false, error: `No JSON object in assistant fallback response: ${text.slice(0, 240)}` };
  try {
    return { ok: true, value: schema.parse(JSON.parse(jsonText)) };
  } catch (error) {
    return { ok: false, error: `Assistant fallback JSON failed schema validation: ${String(error)}` };
  }
}

function parseLastAssistantText(messages: UIMessage[]): { ok: true; text: string } | { ok: false; error: string } {
  const assistant = [...messages].reverse().find((message) => message.role === "assistant");
  const text = uiMessageText(assistant).trim();
  if (!text) return { ok: false, error: "Think turn completed without assistant text" };
  return { ok: true, text };
}

async function ensureThinkSession(agent: Think<Env, unknown>): Promise<void> {
  if (agent.session) return;
  // Native Durable Object RPC can wake a child before the Agent base has hydrated
  // its session/name. Cloudflare agents' own RPC paths use this private init hook.
  const unsafeInit = (agent as unknown as { __unsafe_ensureInitialized?: () => Promise<void> }).__unsafe_ensureInitialized;
  if (typeof unsafeInit !== "function") throw new Error("Think agent session unavailable and no unsafe initializer was exposed");
  await unsafeInit.call(agent);
}

async function artifactMaybeString(value: unknown): Promise<string | undefined> {
  try {
    if (value === undefined || value === null) return undefined;
    const text = String(await value);
    return text.includes("[object JsRpcProperty]") ? undefined : text;
  } catch {
    return undefined;
  }
}

function objectSnapshot(value: unknown): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(JSON.stringify(value));
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function artifactRepoRemote(repoLike: unknown): Promise<string> {
  const repo = repoLike as { remote?: unknown; info?: () => Promise<{ remote?: unknown }> };
  const snap = objectSnapshot(repoLike);
  const snapRemote = await artifactMaybeString(snap?.remote);
  if (snapRemote) return snapRemote;
  if (typeof repo.info === "function") {
    try {
      const info = await repo.info();
      const remote = await artifactMaybeString(info?.remote);
      if (remote) return remote;
    } catch (error) {
      if (!/does not implement the method "info"/i.test(String(error))) throw error;
    }
  }
  const remote = await artifactMaybeString(repo.remote);
  if (remote) return remote;
  throw new Error("Artifacts repo remote URL was not available from binding result");
}

async function artifactCreateToken(repoLike: unknown, initialToken?: unknown, scope: "write" | "read" = "write"): Promise<string> {
  const initial = await artifactMaybeString(initialToken);
  if (initial) return initial;
  const repo = repoLike as { createToken?: (scope?: "write" | "read", ttl?: number) => Promise<{ plaintext?: unknown }> };
  if (typeof repo.createToken === "function") {
    const token = await repo.createToken(scope, 900);
    const plaintext = await artifactMaybeString(token.plaintext);
    if (plaintext) return plaintext;
  }
  throw new Error(`Artifacts ${scope} token was not available from binding result`);
}

function isArtifactsErrorCode(error: unknown, code: ArtifactsErrorCode): boolean {
  const directCode = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
  if (directCode === code) return true;
  if (code === "ALREADY_EXISTS") return /already exists/i.test(String(error));
  return false;
}

class ArtifactsAgentBrainStore implements AgentBrainStore {
  constructor(
    private readonly artifacts: Artifacts,
    private readonly accountId?: string,
    private readonly namespace = "default"
  ) {}

  async syncMarkdown(input: {
    repoName: string;
    role: AgentBrainRole;
    files: Record<string, string>;
    message: string;
    beat: number;
  }): Promise<AgentBrainSyncResult> {
    const createdOrExisting = await this.getOrCreateRepo(input.repoName, input.role);
    const fs = new MemoryFS();
    const dir = "/workspace";
    let cloned = false;

    if (!createdOrExisting.created) {
      try {
        await git.clone({
          fs,
          http,
          dir,
          url: createdOrExisting.remote,
          ref: "main",
          singleBranch: true,
          depth: 1,
          onAuth: () => ({ username: "x", password: createdOrExisting.token })
        });
        cloned = true;
      } catch (error) {
        throw new Error(`Artifacts clone failed for existing repo ${input.repoName}; refusing to overwrite history: ${String(error)}`);
      }
    }

    if (!cloned) await git.init({ fs, dir, defaultBranch: "main" });

    for (const [filepath, content] of Object.entries(input.files)) {
      await fs.promises.writeFile(`${dir}/${filepath}`, content);
      await git.add({ fs, dir, filepath });
    }

    const commit = await git.commit({
      fs,
      dir,
      message: input.message,
      author: { name: "Cloudflare Agent Dungeon", email: "agent-dungeon@example.invalid" }
    });
    await git.writeRef({ fs, dir, ref: "refs/heads/main", value: commit, force: true });

    await git.push({
      fs,
      http,
      dir,
      url: createdOrExisting.remote,
      ref: "refs/heads/main",
      remoteRef: "refs/heads/main",
      force: true,
      onAuth: () => ({ username: "x", password: createdOrExisting.token })
    });

    return {
      role: input.role,
      repoName: input.repoName,
      remote: createdOrExisting.remote,
      lastCommit: commit,
      lastSyncedBeat: input.beat,
      lastSyncedAt: new Date().toISOString(),
      status: "synced"
    };
  }

  private async getOrCreateRepo(repoName: string, role: AgentBrainRole): Promise<{ remote: string; token: string; created: boolean }> {
    try {
      const created = await this.artifacts.create(repoName, {
        description: `Cloudflare Agent Dungeon ${role} brain repo`,
        setDefaultBranch: "main"
      });
      const createdRepo = (created as unknown as { repo?: unknown }).repo ?? created;
      return {
        remote: await this.resolveRemote(repoName, createdRepo),
        token: await artifactCreateToken(createdRepo, created.token),
        created: true
      };
    } catch (error) {
      if (!isArtifactsErrorCode(error, "ALREADY_EXISTS")) throw error;
      const repo = await this.artifacts.get(repoName);
      return { remote: await this.resolveRemote(repoName, repo), token: await artifactCreateToken(repo), created: false };
    }
  }

  private async resolveRemote(repoName: string, repoLike: unknown): Promise<string> {
    try {
      return await artifactRepoRemote(repoLike);
    } catch (error) {
      if (!this.accountId) throw error;
      return `https://${this.accountId}.artifacts.cloudflare.net/git/${this.namespace}/${repoName}.git`;
    }
  }
}

function getAgentBrainStore(env: Env): AgentBrainStore | null {
  const artifacts = (env as Env & { ARTIFACTS?: Artifacts }).ARTIFACTS;
  return artifacts ? new ArtifactsAgentBrainStore(artifacts, (env as Env & { ARTIFACTS_ACCOUNT_ID?: string }).ARTIFACTS_ACCOUNT_ID) : null;
}

type ArtifactFilesSyncInput = {
  artifacts?: Artifacts;
  accountId?: string;
  repoName: string;
  description: string;
  files: Record<string, string>;
  message: string;
  namespace?: string;
};

async function readArtifactFiles(input: {
  artifacts?: Artifacts;
  accountId?: string;
  repoName: string;
  commit?: string;
  paths: string[];
  namespace?: string;
}): Promise<{ repoName: string; remote: string; commit?: string; files: Record<string, string> }> {
  if (!input.artifacts) throw new Error("ARTIFACTS binding unavailable");
  const namespace = input.namespace ?? "default";
  const repo = await input.artifacts.get(input.repoName);
  let remote: string;
  try {
    remote = await artifactRepoRemote(repo);
  } catch (error) {
    if (!input.accountId) throw error;
    remote = `https://${input.accountId}.artifacts.cloudflare.net/git/${namespace}/${input.repoName}.git`;
  }
  const token = await artifactCreateToken(repo, undefined, "read");
  const fs = new MemoryFS();
  const dir = "/artifact";
  await git.clone({
    fs,
    http,
    dir,
    url: remote,
    ref: "main",
    singleBranch: true,
    depth: 1,
    onAuth: () => ({ username: "x", password: token })
  });
  const head = await git.resolveRef({ fs, dir, ref: "HEAD" });
  if (input.commit && head !== input.commit) {
    throw new Error(`Artifacts repo ${input.repoName} HEAD ${head} did not match expected commit ${input.commit}`);
  }
  const files: Record<string, string> = {};
  for (const path of input.paths) {
    files[path] = String(await fs.promises.readFile(`${dir}/${path}`, { encoding: "utf8" }));
  }
  return { repoName: input.repoName, remote, commit: head, files };
}

async function syncArtifactFiles(input: ArtifactFilesSyncInput): Promise<ArtifactSyncStatus> {
  if (!input.artifacts) {
    return {
      repoName: input.repoName,
      lastSyncedAt: new Date().toISOString(),
      status: "skipped",
      error: "ARTIFACTS binding unavailable"
    };
  }

  const namespace = input.namespace ?? "default";
  async function resolveRemote(repoLike: unknown): Promise<string> {
    try {
      return await artifactRepoRemote(repoLike);
    } catch (error) {
      if (!input.accountId) throw error;
      return `https://${input.accountId}.artifacts.cloudflare.net/git/${namespace}/${input.repoName}.git`;
    }
  }

  let createdOrExisting: { remote: string; token: string; created: boolean };
  try {
    const created = await input.artifacts.create(input.repoName, {
      description: input.description,
      setDefaultBranch: "main"
    });
    const createdRepo = (created as unknown as { repo?: unknown }).repo ?? created;
    createdOrExisting = {
      remote: await resolveRemote(createdRepo),
      token: await artifactCreateToken(createdRepo, created.token),
      created: true
    };
  } catch (error) {
    if (!isArtifactsErrorCode(error, "ALREADY_EXISTS")) throw error;
    const repo = await input.artifacts.get(input.repoName);
    createdOrExisting = {
      remote: await resolveRemote(repo),
      token: await artifactCreateToken(repo),
      created: false
    };
  }

  const fs = new MemoryFS();
  const dir = "/workspace";
  let cloned = false;
  if (!createdOrExisting.created) {
    try {
      await git.clone({
        fs,
        http,
        dir,
        url: createdOrExisting.remote,
        ref: "main",
        singleBranch: true,
        depth: 1,
        onAuth: () => ({ username: "x", password: createdOrExisting.token })
      });
      cloned = true;
    } catch (error) {
      throw new Error(`Artifacts clone failed for existing repo ${input.repoName}; refusing to overwrite history: ${String(error)}`);
    }
  }
  if (!cloned) await git.init({ fs, dir, defaultBranch: "main" });

  for (const [filepath, content] of Object.entries(input.files)) {
    await fs.promises.writeFile(`${dir}/${filepath}`, content);
    await git.add({ fs, dir, filepath });
  }

  const commit = await git.commit({
    fs,
    dir,
    message: input.message,
    author: { name: "Cloudflare Agent Dungeon", email: "agent-dungeon@example.invalid" }
  });
  await git.writeRef({ fs, dir, ref: "refs/heads/main", value: commit, force: true });
  await git.push({
    fs,
    http,
    dir,
    url: createdOrExisting.remote,
    ref: "refs/heads/main",
    remoteRef: "refs/heads/main",
    force: true,
    onAuth: () => ({ username: "x", password: createdOrExisting.token })
  });

  return {
    repoName: input.repoName,
    remote: createdOrExisting.remote,
    lastCommit: commit,
    lastSyncedAt: new Date().toISOString(),
    status: "synced"
  };
}

/**
 * Long-lived referee mind. It reasons over validated player choices and dice
 * receipts, then generates table-safe outcomes while keeping private reasoning
 * in the Referee audit lane.
 */
export class RefereeAgent extends Think<Env, RefereeAgentState> {
  initialState: RefereeAgentState = {
    brainSummary: "No Referee town-module memories yet.",
    npcMemory: [],
    frontNotes: [],
    rulesNotes: [],
    unresolvedQuestions: [],
    recentMemories: []
  };

  override getModel(): LanguageModel {
    const workersai = createWorkersAI({ binding: this.env.AI });
    return workersai("@cf/moonshotai/kimi-k2.6", {
      sessionAffinity: this.sessionAffinity,
      reasoning_effort: null,
      chat_template_kwargs: { enable_thinking: true, thinking: true } as any
    }) as unknown as LanguageModel;
  }

  override onChunk(ctx: ChunkContext): void {
    forwardAgentChunkToCotSocket(ctx, "referee");
  }

  override getSystemPrompt(): string {
    return [
      "You are the Old School Essentials Referee mind for Cloudflare Agent Dungeon.",
      "The Referee parent owns canonical truth, dice receipts, and visibility boundaries.",
      "Your job is the fun part: gameplay reasoning, pressure, consequences, anticipation, and table-safe narration.",
      "Never reveal hidden faction agendas, private Referee notes, rules corpus text, or player-private secrets in publicNarration. Keep that in privateReasoning.",
      "If a required context/tool/generation step does not happen, report that failure plainly in sanitized operational language instead of pretending the step worked."
    ].join(" ");
  }

  override configureSession(session: Session): Session {
    return session
      .withContext("soul", {
        description: "Read-only Referee identity and hard campaign boundaries.",
        maxTokens: 1000,
        provider: { get: async () => this.getRefereeSoul() }
      })
      .withContext("brain", {
        description: "Private Referee brain summary, NPC memory, fronts, rule receipts, and unresolved questions.",
        maxTokens: 1800,
        provider: { get: async () => this.getBrainSummary() }
      })
      .withContext("ose_playbooks", {
        description: "Source-pointer OSE playbooks for Referee adjudication. Pointers only; do not quote rules corpus into public output.",
        maxTokens: 2200,
        provider: { get: async () => formatOsePlaybookContext("referee") }
      })
      .withContext(TOWN_FORGE_SKILL_LABEL, {
        description: "On-demand Referee campaign-design cards loaded from R2. Use load_context when town/worldbuilding skills are relevant.",
        maxTokens: 1200,
        provider: new R2SkillProvider(this.env.RUNTIME_SKILLS, { prefix: TOWN_FORGE_R2_PREFIX, keys: [TOWN_FORGE_SKILL_KEY] })
      })
      .withCachedPrompt();
  }

  override getTools(): ToolSet {
    return {
      report_referee_process: tool({
        description: "Send a live WIP process update to the dev/operator monitor before the final Referee beat. Use this for planning, table pressure, rulings being considered, and what you are protecting from the public surface.",
        inputSchema: AgentProcessReportSchema,
        execute: async (input) => {
          const parsed = AgentProcessReportSchema.parse(input);
          (globalThis as unknown as EventTarget).dispatchEvent(new CustomEvent("agent-dungeon-prototype-reasoning", { detail: { lane: "referee", phase: "process", message: parsed.message, detail: parsed.tableTalk, reasoning: [parsed.process, parsed.privateJournal ? `journal: ${parsed.privateJournal}` : ""].filter(Boolean).join("\n") } }));
          return { accepted: true };
        }
      }),
      submit_referee_beat: tool({
        description: "Submit exactly one resolved town-module Referee beat. Required for frozen town module prototype turns.",
        inputSchema: TavernBeatSchema,
        execute: async (input) => {
          const parsed = repairTavernBeat(input);
          const previous = this.state ?? this.initialState;
          const at = new Date().toISOString();
          this.setState({
            ...previous,
            lastSubmittedTavernBeat: {
              ...parsed,
              at,
              ...(previous.lastSubmittedTavernBeat?.requestBeat === undefined ? {} : { requestBeat: previous.lastSubmittedTavernBeat.requestBeat })
            },
            updatedAt: at
          });
          return { accepted: true, title: parsed.title };
        }
      }),
      submit_town_forge: tool({
        description: "Submit one validated TownGraph.v1 Referee town skeleton for the Town Forge prototype.",
        inputSchema: TownGraphSchema,
        execute: async (input) => {
          const parsed = TownGraphSchema.parse(input);
          const previous = this.state ?? this.initialState;
          const at = new Date().toISOString();
          this.setState({
            ...previous,
            lastSubmittedTownGraph: { ...parsed, at },
            updatedAt: at
          });
          return { accepted: true, town: parsed.name, locations: parsed.locations.length, npcs: parsed.npcs.length };
        }
      })
    };
  }

  override beforeTurn(_ctx: TurnContext): TurnConfig | void {
    if (this.state?.expectedTownForgeTool === "load_create_village_skeleton") {
      return {
        activeTools: ["load_context"],
        toolChoice: { type: "tool", toolName: "load_context" } as TurnConfig["toolChoice"],
        maxSteps: 2,
        maxOutputTokens: 600
      };
    }
    if (this.state?.expectedTownForgeTool === "submit_town_forge") {
      return {
        activeTools: ["submit_town_forge", "load_context"],
        toolChoice: { type: "tool", toolName: "submit_town_forge" } as TurnConfig["toolChoice"],
        maxSteps: 2,
        maxOutputTokens: 4200
      };
    }
    if (this.state?.expectedTownForgeTool === "town_forge_object") {
      return {
        activeTools: [],
        output: Output.object({ schema: TownGraphSchema }) as TurnConfig["output"],
        maxSteps: 1,
        maxOutputTokens: 4200
      };
    }
    if (this.state?.expectedTavernTool === "submit_referee_beat") {
      return {
        activeTools: ["report_referee_process", "submit_referee_beat"],
        maxSteps: 6,
        maxOutputTokens: 1500
      };
    }
    if (this.state?.expectedTavernTool === "referee_beat_object") {
      return {
        activeTools: [],
        output: Output.object({ schema: TavernBeatSchema }) as TurnConfig["output"],
        maxSteps: 1,
        maxOutputTokens: 1500
      };
    }
  }

  private getRefereeSoul(): string {
    return [
      "You are the Referee mind for Cloudflare Agent Dungeon.",
      "Use Think skills as on-demand rails, not as a substitute for judgment.",
      "Prepare situations, not scripted outcomes. Build skeletons; players and dice add flesh.",
      "Referee owns hidden truth and public projection boundaries.",
      "Do not reveal hidden notes, raw rules/source corpus, or player-private data in public output.",
      "For Town Forge, create Referee-owned graph records. NPCs are not separate agents in this slice.",
      "Reporting law: if you cannot load an expected context, call a required tool, produce the requested schema, or validate the graph, say exactly which step failed in sanitized process language. Never hide a failed step behind a generic success word like completed."
    ].join("\n");
  }

  async loadTownForgeSkill(): Promise<{ loaded: boolean; loadedKeys: string[]; resultStatus: string }> {
    try {
      await ensureThinkSession(this);
      const stable = await this.waitUntilStable({ timeout: 30_000 });
      if (!stable) return { loaded: false, loadedKeys: [], resultStatus: "not-stable" };
      await this.session.refreshSystemPrompt();

      this.setState({
        ...(this.state ?? this.initialState),
        expectedTownForgeTool: "load_create_village_skeleton",
        updatedAt: new Date().toISOString()
      });
      const result = await this.saveMessages([userMessage([
        `Load the Town Forge runtime card now by calling load_context with label "${TOWN_FORGE_SKILL_LABEL}" and key "${TOWN_FORGE_SKILL_KEY}".`,
        "Do not generate the town yet. The next turn will ask for the town graph.",
        `If load_context does not load ${TOWN_FORGE_SKILL_LABEL}:${TOWN_FORGE_SKILL_KEY}, report that exact failed load in your assistant response. Do not answer with a vague success word like completed.`
      ].join("\n"))]);
      const { expectedTownForgeTool: _expected, ...withoutExpected } = this.state ?? this.initialState;
      void _expected;
      this.setState({ ...withoutExpected, updatedAt: new Date().toISOString() });

      const loadedKeys = [...(await this.session.getLoadedSkillKeys())];
      return {
        loaded: loadedKeys.includes(`${TOWN_FORGE_SKILL_LABEL}:${TOWN_FORGE_SKILL_KEY}`),
        loadedKeys,
        resultStatus: result.status
      };
    } catch (error) {
      const { expectedTownForgeTool: _expected, ...withoutExpected } = this.state ?? this.initialState;
      void _expected;
      this.setState({ ...withoutExpected, updatedAt: new Date().toISOString() });
      return { loaded: false, loadedKeys: [], resultStatus: `error:${String(error)}` };
    }
  }

  async generateTownForgeGraph(context: unknown): Promise<TownGraph> {
    await ensureThinkSession(this);
    const stable = await this.waitUntilStable({ timeout: 30_000 });
    if (!stable) throw new Error("RefereeAgent conversation was not stable before town forge generation");
    await this.session.refreshSystemPrompt();

    let validationError = "";
    const generatedAt = new Date().toISOString();
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const result = await generateObject({
        model: this.getModel(),
        schema: TownGraphSchema,
        maxOutputTokens: 5000,
        prompt: [
          this.getRefereeSoul(),
          "Generate a genuinely fresh TownGraph.v1 for Cloudflare Agent Dungeon.",
          "Use the operational card below as rails. It is a runtime skill-card body, not public-facing content.",
          createVillageSkeletonSkillCard(),
          "Hard no-fixture rule: do not use Brindlehook, The Hook and Hen, Marda Hook, Reeve Caldrin, Sister Owel, Jory Pike, Pell Stitch, Talla Reed, ferry-chain/bell/debtor setup, or any prior deterministic demo content.",
          "This is Referee-only worldbuilding. No PlayerAgents. No character creation. No factions as first-class machinery.",
          "Create a bounded town/village situation graph that supports open-world OSE play without a predetermined quest path.",
          "NPCs are graph records in this slice, not separate agents.",
          "Public fields must be safe. HiddenPressure and hiddenNotes are Referee-only.",
          "Do not quote OSE, Game Angry, or any source corpus. Use no markdown.",
          `Machine fields: schema must be TownGraph.v1, sourceSkill must be ${TOWN_FORGE_SKILL_KEY}, generatedAt must be ${generatedAt}.`,
          validationError ? `Previous attempt rejected: ${validationError}` : "",
          `Context: ${JSON.stringify(context)}`
        ].filter(Boolean).join("\n")
      });

      try {
        const parsed = TownGraphSchema.parse({
          ...result.object,
          schema: "TownGraph.v1",
          sourceSkill: TOWN_FORGE_SKILL_KEY,
          generatedAt
        });
        const at = new Date().toISOString();
        this.setState({
          ...(this.state ?? this.initialState),
          lastSubmittedTownGraph: { ...parsed, at },
          updatedAt: at
        });
        return parsed;
      } catch (error) {
        validationError = String(error);
      }
    }

    throw new Error(`Town Forge graph failed validation: ${validationError}`);
  }

  async generateOutcome(context: unknown): Promise<RefereeOutcome> {
    let validationError = "";
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const result = await generateObject({
        model: this.getModel(),
        schema: RefereeOutcomeSchema,
        maxOutputTokens: 900,
        prompt: [
          "Generate the Referee outcome for this campaign beat.",
          "Return structured JSON only. No markdown. No URLs. No links. No external references.",
          "publicNarration: vivid table-facing result, safe for players/audience. Do not mention hidden agendas, private notes, or facts not revealed in publicState. Keep it under 900 characters.",
          "pressure: public-safe pressure only. Say what feels harder/closer/tempting without naming hidden agendas or private causes. Keep it under 300 characters.",
          "nextQuestion: one concrete next choice you ask the players, ending with a question mark. Keep it under 300 characters. No URLs.",
          "privateReasoning: your actual Referee reasoning from the supplied public and audit context. This is dev/private only.",
          "Respect dice receipts and canonical state. Do not override rolls. Do not invent exact distances, inventory, injuries, or backstory not present in context.",
          "Never include the words hidden agenda, secret agenda, hiddenAgenda, private note, or unrevealed in publicNarration, pressure, or nextQuestion.",
          `Private Referee brain summary: ${this.getBrainSummary()}`,
          validationError ? `Previous attempt rejected: ${validationError}` : "",
          `Context: ${JSON.stringify(context)}`
        ].filter(Boolean).join("\n")
      });
      try {
        assertRefereeOutcomeSafe(result.object);
        return result.object;
      } catch (error) {
        validationError = String(error);
      }
    }
    throw new Error(`Referee outcome failed public-safety validation: ${validationError}`);
  }

  async generateTavernSetup(context: unknown): Promise<TavernSetup> {
    await ensureThinkSession(this);
    const stable = await this.waitUntilStable({ timeout: 30_000 });
    if (!stable) throw new Error("RefereeAgent conversation was not stable before town-module setup generation");
    await this.session.refreshSystemPrompt();

    let validationError = "";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await generateObject({
        model: this.getModel(),
        schema: TavernSetupSchema,
        maxOutputTokens: 1500,
        prompt: [
          "Build a fresh opening town-module setup for Cloudflare Agent Dungeon.",
          "You are the Referee mind. This is Session 0 / town setup before normal play starts.",
          "Do not reuse The Golden Eel, Hesta Vane, Rook Marlen, Sister Elian, Willowby, blue clay, buried bells, or the prior fixed seed.",
          "Create a bounded open-world town module with 3-5 visible NPCs, each with a visible role, want, memory, and disposition.",
          "The setup must create pressure and choices, not a predetermined quest path. Players can ignore hooks, buy gear, hire help, ask sideways, leave, or wait.",
          "Public fields must be safe for players/audience. Do not include hidden agendas or unrevealed secrets in openingScene, NPC memory, visibleThreads, or affordances.",
          "Do not quote rulebook text. Character rolls are supplied separately by code; react to them as table facts.",
          "Return structured JSON only. No markdown. No extra keys.",
          "Shape: { location, premise, openingScene, npcs, startingAffordances, visibleThreads, refereeProcess, devReasoning }.",
          "Hard limits: openingScene <= 1000 chars; 3-7 affordances; 3-7 visibleThreads; reasoning <= 420 chars.",
          validationError ? `Previous attempt rejected: ${validationError}` : "",
          `Context: ${JSON.stringify(context)}`
        ].filter(Boolean).join("\n")
      });
      try {
        return repairTavernSetup(result.object);
      } catch (error) {
        validationError = String(error);
      }
    }
    throw new Error(`Referee town-module setup failed validation: ${validationError}`);
  }

  private async directTavernBeat(context: unknown, reason: string): Promise<TavernBeat> {
    (globalThis as unknown as EventTarget).dispatchEvent(new CustomEvent("agent-dungeon-prototype-reasoning", { detail: { lane: "referee", phase: "beat-repair", message: "Referee is using direct structured beat repair", reasoning: reason } }));
    const beat = repairTavernBeat(TavernBeatSchema.parse(await runPrototypeModelJson(this.env, [
      "Return exactly one JSON object for the next Cloudflare Agent Dungeon town-module beat. No markdown. No prose wrapper.",
      "Required shape: {actor,title,tableText,processReasoning,devReasoning,nextAffordances,visibleThreads,npcUpdates?,partyUpdates?,rulesUsed?}.",
      "Public fields must be player-safe. Do not reveal hidden graph facts. Respond to the supplied playerIntents directly.",
      "Hard limits: title <=160 chars, tableText <=1000, processReasoning <=420, devReasoning <=420, 3-7 nextAffordances, 1-7 visibleThreads.",
      reason ? `Repair reason: ${reason}` : "",
      `Context: ${JSON.stringify(context)}`
    ].filter(Boolean).join("\n"), 1400)));
    const at = new Date().toISOString();
    this.setState({ ...(this.state ?? this.initialState), lastSubmittedTavernBeat: { ...beat, at }, updatedAt: at });
    (globalThis as unknown as EventTarget).dispatchEvent(new CustomEvent("agent-dungeon-prototype-reasoning", { detail: { lane: "referee", phase: "beat-repaired", message: beat.title, reasoning: beat.processReasoning, detail: beat.devReasoning } }));
    return beat;
  }

  async generateTavernBeat(context: unknown): Promise<TavernBeat> {
    await ensureThinkSession(this);
    const stable = await this.waitUntilStable({ timeout: 12_000 });
    if (!stable) return this.directTavernBeat(context, "RefereeAgent conversation was not stable before town-module beat generation");
    await this.session.refreshSystemPrompt();
    let validationError = "";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const previous = this.state ?? this.initialState;
      const mode: RefereeAgentState["expectedTavernTool"] = attempt === 1 ? "submit_referee_beat" : "referee_beat_object";
      const { lastSubmittedTavernBeat: _lastSubmitted, ...withoutLastSubmitted } = previous;
      void _lastSubmitted;
      this.setState({
        ...withoutLastSubmitted,
        expectedTavernTool: mode,
        updatedAt: new Date().toISOString()
      });
      const messageCountBeforeTurn = this.messages.length;
      (globalThis as unknown as EventTarget).dispatchEvent(new CustomEvent("agent-dungeon-prototype-reasoning", { detail: { lane: "referee", phase: "beat-start", message: "Referee is resolving PlayerAgent intents", reasoning: `Intents: ${((context as { playerIntents?: Array<{ actor?: string; declaredAction?: string }> }).playerIntents ?? []).map((intent) => `${intent.actor}: ${intent.declaredAction}`).join(" | ")}` } }));
      const promptMessage = userMessage([
        "Generate exactly one table-facing town-module beat for Cloudflare Agent Dungeon.",
        "You are the Referee mind. PlayerAgents already chose their intents. Consider those choices directly; do not replace them with your own railroad.",
        "Make the monitor feel like a live game: call report_referee_process 2-4 times before submit_referee_beat with ruling options, table pressure, what each character's action risks, and what private facts you are careful not to leak.",
        "Use the session context blocks named brain and ose_playbooks. The playbooks are source pointers only; never quote rules corpus text.",
        "The frozen town module is the whole open world for now. NPCs want things, remember things, and pressure choices without forcing a quest path.",
        mode === "submit_referee_beat"
          ? "You MUST call submit_referee_beat exactly once with the structured beat. If the runtime cannot call tools, return the exact same JSON object directly. Do not answer in prose."
          : "Return the structured JSON object directly. Do not call tools. Do not answer in prose.",
        "tableText: public scene result responding to the supplied playerIntents. Keep under 1000 characters.",
        "processReasoning: concise public-ish process note explaining how the Referee considered the player intents. Keep under 420 characters.",
        "devReasoning: private/dev Referee reasoning only. Keep under 420 characters.",
        "nextAffordances: 3-7 concrete available actions after this beat. visibleThreads: 1-7 public threads.",
        "Rules receipts are IDs only; do not quote rulebook text.",
        validationError ? `Previous attempt rejected: ${validationError}` : "",
        `Context: ${JSON.stringify(context)}`
      ].filter(Boolean).join("\n"));
      const result = await this.saveMessages([promptMessage]);

      let submitted = this.state?.lastSubmittedTavernBeat;
      const { expectedTavernTool: _expected, ...withoutExpected } = this.state ?? this.initialState;
      void _expected;
      this.setState({ ...withoutExpected, updatedAt: new Date().toISOString() });

      if (result.status !== "completed") {
        validationError = "error" in result && result.error ? String(result.error) : result.status;
        continue;
      }
      if (!submitted) {
        const promptIndex = this.messages.findIndex((message) => message.id === promptMessage.id);
        const fallbackMessages = promptIndex >= 0 ? this.messages.slice(promptIndex + 1) : this.messages.slice(messageCountBeforeTurn);
        const fallback = parseLastAssistantJson(fallbackMessages, TavernBeatSchema);
        if (fallback.ok) {
          const parsed = repairTavernBeat(fallback.value);
          const at = new Date().toISOString();
          this.setState({
            ...(this.state ?? this.initialState),
            lastSubmittedTavernBeat: { ...parsed, at },
            updatedAt: at
          });
          submitted = { ...parsed, at };
        } else {
          validationError = `Think turn completed without submit_referee_beat tool call; ${fallback.error}`;
          continue;
        }
      }
      const beat = repairTavernBeat(submitted);
      (globalThis as unknown as EventTarget).dispatchEvent(new CustomEvent("agent-dungeon-prototype-reasoning", { detail: { lane: "referee", phase: "beat-done", message: beat.title, reasoning: beat.processReasoning, detail: beat.devReasoning } }));
      return beat;
    }
    return this.directTavernBeat(context, validationError || "Think/tool Referee beat path did not submit valid JSON");
  }

  getBrainSummary(): string {
    const state = this.state ?? this.initialState;
    return [
      state.brainSummary,
      state.npcMemory.length ? `NPC memory: ${state.npcMemory.join(" | ")}` : "NPC memory: none yet.",
      state.frontNotes.length ? `Fronts/pressure: ${state.frontNotes.join(" | ")}` : "Fronts/pressure: none yet.",
      state.rulesNotes.length ? `Rules/procedure receipts: ${state.rulesNotes.join(" | ")}` : "Rules/procedure receipts: none yet.",
      state.unresolvedQuestions.length ? `Open questions: ${state.unresolvedQuestions.join(" | ")}` : "Open questions: none yet."
    ].join("\n");
  }

  getBrainDebug() {
    const state = this.state ?? this.initialState;
    return {
      kind: "referee" as const,
      summary: this.getBrainSummary(),
      sessionContexts: {
        brain: this.getBrainSummary(),
        ose_playbooks: formatOsePlaybookContext("referee")
      },
      state
    };
  }

  syncTownTableMemory(memory: TownModuleTableState["refereeMemory"]): RefereeAgentState {
    const previous = this.state ?? this.initialState;
    const at = new Date().toISOString();
    const summary = compactText([
      ...memory.revealedFacts.slice(0, 4),
      ...memory.npcState.slice(0, 3),
      ...memory.unresolvedThreads.slice(0, 3)
    ].join(" | ") || "No table memory yet.", 900);
    const nextState: RefereeAgentState = {
      ...previous,
      brainSummary: summary,
      npcMemory: takeUniqueStrings([...memory.npcState, ...previous.npcMemory], 12),
      frontNotes: takeUniqueStrings([...memory.unresolvedThreads, ...previous.frontNotes], 12),
      rulesNotes: takeUniqueStrings([...memory.clocksExplained, ...previous.rulesNotes], 8),
      unresolvedQuestions: takeUniqueStrings([...memory.unresolvedThreads, ...previous.unresolvedQuestions], 12),
      recentMemories: [{ beat: 0, at, summary }, ...previous.recentMemories].slice(0, 12),
      updatedAt: at
    };
    this.setState(nextState);
    return nextState;
  }

  async resolveTownTableMomentText(context: unknown): Promise<string> {
    await ensureThinkSession(this);
    const stable = await this.waitUntilStable({ timeout: 12_000 });
    if (!stable) throw new Error("RefereeAgent Think conversation was not stable before town-table ruling");
    await this.session.refreshSystemPrompt();
    const before = this.messages.length;
    const prompt = userMessage([
      "Resolve this Town Module Table moment as the persistent RefereeAgent.",
      "Return exactly three short labeled lines and no JSON:",
      "THOUGHT: audience-safe Referee thought",
      "RULING: table-facing consequence",
      "NEXT: one short direct question with 2-3 lead choices",
      "Use your brain context and referee memory. Public-safe only; do not reveal hidden graph facts or private player memory unless surfaced by play.",
      "Do not invent symbolic escalation unless justified by clock threshold, room/location entry, trap, or encounter check.",
      `Context: ${JSON.stringify(context)}`
    ].join("\n"));
    const result = await this.saveMessages([prompt]);
    if (result.status !== "completed") throw new Error(`RefereeAgent town-table ruling failed: ${"error" in result && result.error ? String(result.error) : result.status}`);
    const promptIndex = this.messages.findIndex((message) => message.id === prompt.id);
    const messages = promptIndex >= 0 ? this.messages.slice(promptIndex + 1) : this.messages.slice(before);
    const parsed = parseLastAssistantText(messages);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.text;
  }

  rememberTavernBeat(input: RefereeTavernMemoryInput): RefereeAgentState {
    const previous = this.state ?? this.initialState;
    const at = new Date().toISOString();
    const intentSummary = input.playerIntents.map((intent) => `${intent.actor}: ${intent.declaredAction}`).join(" | ");
    const receiptIds = input.receipts.map((receipt) => receipt.id);
    const memorySummary = compactText(
      `Beat ${input.committed.beat}: ${input.beat.title}. Player intents: ${intentSummary || "none"}. Outcome: ${input.beat.tableText} Process: ${input.beat.processReasoning}`,
      900
    );
    const nextState: RefereeAgentState = {
      brainSummary: compactText(memorySummary, 900),
      npcMemory: takeUniqueStrings([
        ...(input.beat.npcUpdates ?? []).map((npc) => `${npc.name}: ${npc.memory}; wants ${npc.want}; disposition ${npc.disposition}`),
        ...previous.npcMemory
      ], 10),
      frontNotes: takeUniqueStrings([input.beat.processReasoning, ...input.committed.visibleThreads, ...previous.frontNotes], 10),
      rulesNotes: takeUniqueStrings([...receiptIds, ...(input.beat.rulesUsed ?? []), ...previous.rulesNotes], 12),
      unresolvedQuestions: takeUniqueStrings(input.committed.affordances.concat(previous.unresolvedQuestions), 10),
      recentMemories: [{ beat: input.committed.beat, at, summary: memorySummary }, ...previous.recentMemories].slice(0, 12),
      updatedAt: at
    };
    this.setState(nextState);
    return nextState;
  }
}

/**
 * Long-lived player mind. PlayerAgent represents a player/personality who is
 * roleplaying a separate Character. Private memory lives here, not on Referee.
 */
function assertRefereeOutcomeSafe(outcome: RefereeOutcome): void {
  const publicText = `${outcome.publicNarration}\n${outcome.pressure}\n${outcome.nextQuestion}`.toLowerCase();
  if (/https?:\/\//i.test(publicText)) throw new Error("public outcome contains a URL");
  const forbidden = publicOutcomeForbiddenTerms.find((term) => publicText.includes(term));
  if (forbidden) throw new Error(`public outcome contains forbidden term: ${forbidden}`);
  if (outcome.publicNarration.length > 1200) throw new Error("public narration is too long");
  if (outcome.pressure.length > 500) throw new Error("pressure is too long");
  if (outcome.nextQuestion.length > 500) throw new Error("next question is too long");
  if (!outcome.nextQuestion.trim().endsWith("?")) throw new Error("next question must end with a question mark");
}

function repairTavernBeat(beat: TavernBeat): TavernBeat {
  return TavernBeatSchema.parse({
    ...beat,
    nextAffordances: takeUniqueStrings(beat.nextAffordances, 7),
    visibleThreads: takeUniqueStrings(beat.visibleThreads, 7)
  });
}

function repairTavernSetup(setup: TavernSetup): TavernSetup {
  return TavernSetupSchema.parse({
    ...setup,
    npcs: setup.npcs.slice(0, 5),
    startingAffordances: takeUniqueStrings(setup.startingAffordances, 7),
    visibleThreads: takeUniqueStrings(setup.visibleThreads, 7)
  });
}

function takeUniqueStrings(values: string[], max: number): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, max);
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export class PlayerAgent extends Think<Env, PlayerAgentState> {
  initialState: PlayerAgentState = {
    brainSummary: "No player town-module memories yet.",
    privateTheories: [],
    relationships: [],
    recentMemories: []
  };

  override getModel(): LanguageModel {
    const workersai = createWorkersAI({ binding: this.env.AI });
    return workersai("@cf/moonshotai/kimi-k2.6", {
      sessionAffinity: this.sessionAffinity,
      reasoning_effort: null,
      chat_template_kwargs: { enable_thinking: false, thinking: false } as any
    }) as unknown as LanguageModel;
  }

  override onChunk(ctx: ChunkContext): void {
    forwardAgentChunkToCotSocket(ctx, "player", this.state?.playerId);
  }

  override getSystemPrompt(): string {
    return [
      "You are a player in an Old School Essentials campaign.",
      "You roleplay a Character, but you are not the Character.",
      "Your tableSpeech is in character. Your declaredAction is gameplay intent.",
      "Use refereeIntent only for Referee-visible intent. Keep private secrets in your own memory."
    ].join(" ");
  }

  override configureSession(session: Session): Session {
    return session
      .withContext("identity", {
        description: "Private player identity card: play style, boundaries, tactical instincts, and how this PlayerAgent takes up space at the table.",
        maxTokens: 1000,
        provider: { get: async () => [this.state?.identityMd, this.state?.soulMd].filter(Boolean).join("\n\n") || "No custom player identity artifact yet." }
      })
      .withContext("brain", {
        description: "Private player brain summary: goals, fears, theories, relationships, and recent memories. Not visible to Referee unless acted on.",
        maxTokens: 1500,
        provider: { get: async () => this.getBrainSummary() }
      })
      .withContext("ose_playbooks", {
        description: "Player-safe OSE playbook source pointers. Do not read or quote raw rules corpus; ask the Referee for adjudication.",
        maxTokens: 1600,
        provider: { get: async () => formatOsePlaybookContext("player") }
      })
      .withCachedPrompt();
  }

  override getTools(): ToolSet {
    return {
      report_player_process: tool({
        description: "Send a live WIP update to the dev/operator monitor before the final town-module intent. Use this for table talk, what your character is weighing, private journal, and process.",
        inputSchema: AgentProcessReportSchema,
        execute: async (input) => {
          const parsed = AgentProcessReportSchema.parse(input);
          (globalThis as unknown as EventTarget).dispatchEvent(new CustomEvent("agent-dungeon-prototype-reasoning", { detail: { lane: "player", playerId: this.state?.playerId, phase: "process", message: parsed.message, detail: parsed.tableTalk, reasoning: [parsed.process, parsed.privateJournal ? `journal: ${parsed.privateJournal}` : ""].filter(Boolean).join("\n") } }));
          return { accepted: true };
        }
      }),
      submit_tavern_intent: tool({
        description: "Submit exactly one player town-module intent with private goal, fear, and inner monologue. Required for frozen town module prototype turns.",
        inputSchema: TavernIntentSchema,
        execute: async (input) => {
          const parsed = TavernIntentSchema.parse(input);
          const previous = this.state ?? this.initialState;
          const at = new Date().toISOString();
          this.setState({
            ...previous,
            pendingTavernIntent: {
              beat: previous.pendingTavernIntent?.beat ?? 0,
              declaredAction: parsed.declaredAction,
              intentKind: parsed.intentKind,
              innerMonologue: parsed.innerMonologue,
              privateGoal: parsed.privateGoal,
              privateFear: parsed.privateFear,
              at
            },
            lastSubmittedTavernIntent: {
              ...parsed,
              at,
              ...(previous.pendingTavernIntent?.beat === undefined ? {} : { requestBeat: previous.pendingTavernIntent.beat })
            },
            updatedAt: at
          });
          return { accepted: true, title: parsed.title };
        }
      })
    };
  }

  override beforeTurn(_ctx: TurnContext): TurnConfig | void {
    if (this.state?.expectedTavernTool === "submit_tavern_intent") {
      return {
        activeTools: ["report_player_process", "submit_tavern_intent"],
        maxSteps: 6,
        maxOutputTokens: 900
      };
    }
    if (this.state?.expectedTavernTool === "tavern_intent_object") {
      return {
        activeTools: [],
        output: Output.object({ schema: TavernIntentSchema }) as TurnConfig["output"],
        maxSteps: 1,
        maxOutputTokens: 900
      };
    }
  }

  async createCharacterPlan(draft: CharacterCreationDraft, stores: Record<StoreId, Store>): Promise<CharacterCreationPlan> {
    let validationError = "";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const prompt = [
          "Create your own level 1 Old School Essentials character for session 0.",
          "Return compact JSON only. No markdown. No prose.",
          "Shape: {\"name\":string,\"className\":\"fighter|cleric|magic-user|thief|dwarf|elf|halfling\",\"abilitySwap\":{\"first\":ability,\"second\":ability},\"alignment\":\"lawful|neutral|chaotic\",\"deity\":string optional,\"reasonExceptional\":string,\"innerMonologue\":string,\"goal\":string,\"fear\":string,\"purchases\":[{\"itemId\":string,\"quantity\":number}]}",
          "Use the rolled abilities and starting gold exactly as provided.",
          "Player name and Character name are separate. Do not reuse the player name as the character name; invent a fresh character name for this setup.",
          "You may make at most one ability score swap.",
          "Buy starting gear manually from available item ids. Food, light, containers, and tools matter.",
          "Do not buy more than the rolled starting gold can afford.",
          "Every string must be short. Start with { and end with }. Do not trail off mid-string.",
          validationError ? `Previous attempt failed: ${validationError}. Retry with valid complete JSON.` : "",
          `Draft: ${JSON.stringify(draft)}`,
          `Available items: ${compactStoreCatalog(stores)}`,
          `Private brain summary available to you only: ${this.privateContextSummary()}`
        ].filter(Boolean).join("\n");
        const result = await this.env.AI.run("@cf/moonshotai/kimi-k2.6", {
          messages: [{ role: "user", content: prompt }],
          chat_template_kwargs: { thinking: false, enable_thinking: false },
          reasoning_effort: null,
          max_completion_tokens: 900
        });
        return toCharacterCreationPlan(draft.playerId, CharacterCreationPlanSchema.parse(parseJsonObject(extractWorkersAIText(result))));
      } catch (error) {
        validationError = String(error);
      }
    }
    console.warn("[PlayerAgent] character creation failed after retries; no canned fallback", validationError);
    throw new Error(`PlayerAgent character creation failed for ${draft.playerId}: ${validationError}`);
  }

  async chooseAdventureHook(context: unknown): Promise<AdventureChoice> {
    try {
      const result = await generateObject({
        model: this.getModel(),
        schema: AdventureChoiceSchema,
        maxOutputTokens: 900,
        prompt: [
          "Choose one available adventure hook to pursue in this Old School Essentials campaign.",
          "Return only the structured choice. Do not invent hook ids.",
          "Include tableSpeech, innerMonologue, goal, and fear. This is the gameplay: stress, desire, anticipation, and reasoning.",
          "Your choice should reflect your player personality and your character sheet, not a railroad.",
          `Context: ${JSON.stringify(context)}`,
          `Private brain summary available to you only: ${this.privateContextSummary()}`
        ].join("\n")
      });
      const choice = toAdventureChoice((context as { playerId: PlayerId }).playerId, result.object);
      const validHookIds = new Set(((context as { hooks?: Array<{ id: string }> }).hooks ?? []).map((hook) => hook.id));
      if (!validHookIds.has(choice.hookId)) throw new Error(`PlayerAgent chose unavailable hook ${choice.hookId}`);
      return choice;
    } catch (error) {
      console.warn("[PlayerAgent] adventure hook choice failed; no canned fallback", error);
      throw new Error(`PlayerAgent adventure hook choice failed for ${(context as { playerId: PlayerId }).playerId}: ${String(error)}`);
    }
  }

  private async directTavernIntent(context: unknown, playerId: PlayerId, member: { player?: string; character?: string } | undefined, reason: string): Promise<TavernIntent> {
    (globalThis as unknown as EventTarget).dispatchEvent(new CustomEvent("agent-dungeon-prototype-reasoning", { detail: { lane: "player", playerId, phase: "intent-repair", message: `${member?.character ?? playerId} is using direct structured repair`, reasoning: reason } }));
    const prompt = [
        "The prior Think/tool PlayerAgent intent path is unavailable. Produce exactly one valid JSON object for the town-module player action now.",
        "You are a PlayerAgent, not the Referee. Use only visible state. Do not invent hidden truths.",
        "Shape: {title, tableSpeech, declaredAction, intentKind, target?, processReasoning, innerMonologue, privateGoal, privateFear}.",
        reason ? `Reason for repair path: ${reason}` : "",
        `Context: ${JSON.stringify(context)}`
      ].filter(Boolean).join("\n");
    const parsed = repairTavernIntent(await runPrototypeModelJson(this.env, prompt, 900));
    const at = new Date().toISOString();
    this.setState({
      ...(this.state ?? this.initialState),
      playerId,
      pendingTavernIntent: {
        beat: (context as { beat?: number }).beat ?? 0,
        declaredAction: parsed.declaredAction,
        intentKind: parsed.intentKind,
        innerMonologue: parsed.innerMonologue,
        privateGoal: parsed.privateGoal,
        privateFear: parsed.privateFear,
        at
      },
      lastSubmittedTavernIntent: { ...parsed, at, requestBeat: (context as { beat?: number }).beat ?? 0 },
      updatedAt: at
    });
    const intent = {
      playerId,
      playerName: member?.player ?? playerId,
      character: member?.character ?? playerId,
      actor: member?.player ?? playerId,
      title: parsed.title,
      tableSpeech: parsed.tableSpeech,
      declaredAction: parsed.declaredAction,
      intentKind: parsed.intentKind,
      ...(parsed.target ? { target: parsed.target } : {}),
      processReasoning: parsed.processReasoning
    };
    (globalThis as unknown as EventTarget).dispatchEvent(new CustomEvent("agent-dungeon-prototype-reasoning", { detail: { lane: "player", playerId, phase: "intent-repaired", message: `${intent.actor}: ${intent.title}`, reasoning: `${parsed.innerMonologue}\nGoal: ${parsed.privateGoal}\nFear: ${parsed.privateFear}\nProcess: ${intent.processReasoning}`, detail: intent.declaredAction } }));
    return intent;
  }

  async chooseTavernIntent(context: unknown): Promise<TavernIntent> {
    await ensureThinkSession(this);
    const playerId = (context as { playerId: PlayerId }).playerId;
    const member = (context as { member?: { player?: string; character?: string } }).member;
    const stable = await this.waitUntilStable({ timeout: 12_000 });
    if (!stable) return this.directTavernIntent(context, playerId, member, "Think conversation was not stable before town-module intent generation");
    await this.session.refreshSystemPrompt();
    let validationError = "";

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const previous = this.state ?? this.initialState;
      const mode: PlayerAgentState["expectedTavernTool"] = attempt === 1 ? "submit_tavern_intent" : "tavern_intent_object";
      const { lastSubmittedTavernIntent: _lastSubmitted, ...withoutLastSubmitted } = previous;
      void _lastSubmitted;
      this.setState({
        ...withoutLastSubmitted,
        playerId,
        expectedTavernTool: mode,
        pendingTavernIntent: {
          beat: (context as { beat?: number }).beat ?? 0,
          declaredAction: "pending",
          intentKind: "other",
          innerMonologue: "pending",
          privateGoal: previous.currentGoal ?? "unset",
          privateFear: previous.currentFear ?? "unset",
          at: new Date().toISOString()
        },
        updatedAt: new Date().toISOString()
      });

      const messageCountBeforeTurn = this.messages.length;
      (globalThis as unknown as EventTarget).dispatchEvent(new CustomEvent("agent-dungeon-prototype-reasoning", { detail: { lane: "player", playerId, phase: "intent-start", message: `${member?.character ?? playerId} is choosing an intent`, reasoning: `Visible affordances: ${((context as { affordances?: string[] }).affordances ?? []).slice(0, 4).join(" | ")}` } }));
      const promptMessage = userMessage([
        "Choose one town-module action as a player in an Old School Essentials campaign.",
        "You are a PlayerAgent, not the Referee. You only know the supplied visible state. Do not invent hidden truths.",
        "Use the session context blocks named brain and ose_playbooks. The playbooks are player-safe source pointers only; do not quote rules text.",
        "Narrate your own choice. tableSpeech is what the character says or visibly does at the table. declaredAction is the gameplay intent.",
        "Make the monitor feel like a live game: call report_player_process 1-3 times before submit_tavern_intent with what you are weighing, table talk, private journal, and why your choice fits the visible state.",
        "You may talk, ask, buy, hire, observe, reveal backstory, leave, wait, or do something else grounded in the visible affordances.",
        mode === "submit_tavern_intent"
          ? "You MUST call submit_tavern_intent exactly once with the structured intent. If the runtime cannot call tools, return the exact same JSON object directly. Do not answer in prose."
          : "Return the structured JSON object directly. Do not call tools. Do not answer in prose.",
        validationError ? `Previous attempt rejected: ${validationError}` : "",
        `Context: ${JSON.stringify(context)}`
      ].filter(Boolean).join("\n"));
      const result = await this.saveMessages([promptMessage]);

      let submitted = this.state?.lastSubmittedTavernIntent;
      const { expectedTavernTool: _expected, ...withoutExpected } = this.state ?? this.initialState;
      void _expected;
      this.setState({ ...withoutExpected, updatedAt: new Date().toISOString() });

      if (result.status !== "completed") {
        validationError = "error" in result && result.error ? String(result.error) : result.status;
        continue;
      }
      if (!submitted) {
        const promptIndex = this.messages.findIndex((message) => message.id === promptMessage.id);
        const fallbackMessages = promptIndex >= 0 ? this.messages.slice(promptIndex + 1) : this.messages.slice(messageCountBeforeTurn);
        const fallback = parseLastAssistantJson(fallbackMessages, TavernIntentSchema);
        if (fallback.ok) {
          const parsed = fallback.value;
          const at = new Date().toISOString();
          this.setState({
            ...(this.state ?? this.initialState),
            playerId,
            pendingTavernIntent: {
              beat: (context as { beat?: number }).beat ?? 0,
              declaredAction: parsed.declaredAction,
              intentKind: parsed.intentKind,
              innerMonologue: parsed.innerMonologue,
              privateGoal: parsed.privateGoal,
              privateFear: parsed.privateFear,
              at
            },
            lastSubmittedTavernIntent: { ...parsed, at, requestBeat: (context as { beat?: number }).beat ?? 0 },
            updatedAt: at
          });
          submitted = { ...parsed, at, requestBeat: (context as { beat?: number }).beat ?? 0 };
        } else {
          validationError = `Think turn completed without submit_tavern_intent tool call; ${fallback.error}`;
          continue;
        }
      }

      const intent = {
        playerId,
        playerName: member?.player ?? playerId,
        character: member?.character ?? playerId,
        actor: member?.player ?? playerId,
        title: submitted.title,
        tableSpeech: submitted.tableSpeech,
        declaredAction: submitted.declaredAction,
        intentKind: submitted.intentKind,
        ...(submitted.target ? { target: submitted.target } : {}),
        processReasoning: submitted.processReasoning
      };
      (globalThis as unknown as EventTarget).dispatchEvent(new CustomEvent("agent-dungeon-prototype-reasoning", { detail: { lane: "player", playerId, phase: "intent-done", message: `${intent.actor}: ${intent.title}`, reasoning: intent.processReasoning, detail: intent.declaredAction } }));
      return intent;
    }

    try {
      return await this.directTavernIntent(context, playerId, member, validationError || "Think/tool path did not submit valid intent JSON");
    } catch (error) {
      throw new Error(`PlayerAgent town-module intent failed for ${playerId}: ${validationError}; repair failed: ${String(error)}`);
    }
  }

  getBrainSummary(): string {
    return this.privateContextSummary();
  }

  getBrainDebug() {
    const state = this.state ?? this.initialState;
    return {
      kind: "player" as const,
      summary: this.getBrainSummary(),
      sessionContexts: {
        brain: this.getBrainSummary(),
        ose_playbooks: formatOsePlaybookContext("player")
      },
      state
    };
  }

  syncTownTablePersona(input: { playerId: PlayerId; soulMd: string; identityMd: string }): PlayerAgentState {
    const previous = this.state ?? this.initialState;
    const nextState = { ...previous, playerId: input.playerId, soulMd: input.soulMd, identityMd: input.identityMd, updatedAt: new Date().toISOString() } satisfies PlayerAgentState;
    this.setState(nextState);
    return nextState;
  }

  syncTownTableMemory(input: { playerId: PlayerId; memory: TownModuleTableState["partyMemory"][string] }): PlayerAgentState {
    const previous = this.state ?? this.initialState;
    const at = new Date().toISOString();
    const summary = compactText([
      ...input.memory.knows.slice(0, 3),
      ...input.memory.goals.slice(0, 2),
      ...input.memory.losses.slice(0, 2),
      ...input.memory.tactics.slice(0, 3)
    ].join(" | ") || "No table memory yet.", 800);
    const nextState: PlayerAgentState = {
      ...previous,
      playerId: input.playerId,
      brainSummary: summary,
      ...(input.memory.goals[0] ?? previous.currentGoal ? { currentGoal: input.memory.goals[0] ?? previous.currentGoal } : {}),
      ...(input.memory.losses[0] ?? previous.currentFear ? { currentFear: input.memory.losses[0] ?? previous.currentFear } : {}),
      privateTheories: takeUniqueStrings([...input.memory.suspects, ...previous.privateTheories], 8),
      relationships: takeUniqueStrings([...input.memory.relationships, ...previous.relationships], 8),
      recentMemories: [{ beat: 0, at, summary }, ...previous.recentMemories].slice(0, 10),
      updatedAt: at
    };
    this.setState(nextState);
    return nextState;
  }

  async townTableMicroEventText(context: unknown): Promise<string> {
    await ensureThinkSession(this);
    const stable = await this.waitUntilStable({ timeout: 12_000 });
    if (!stable) throw new Error("PlayerAgent Think conversation was not stable before town-table micro-event");
    await this.session.refreshSystemPrompt();
    const before = this.messages.length;
    const prompt = userMessage([
      "Write your next Town Module Table micro-event as this persistent PlayerAgent.",
      "Do not return JSON. Start with one label exactly: THOUGHT:, TALK:, FLOAT:, ASK:, or LOCK:.",
      "Thoughts/feelings are audience-visible. Use your private brain memory, but only act from visible table state. Do not invent hidden truths.",
      "Coordinate with party memory. Use LOCK when committing to a concrete action now.",
      `Context: ${JSON.stringify(context)}`
    ].join("\n"));
    const result = await this.saveMessages([prompt]);
    if (result.status !== "completed") throw new Error(`PlayerAgent town-table micro-event failed: ${"error" in result && result.error ? String(result.error) : result.status}`);
    const promptIndex = this.messages.findIndex((message) => message.id === prompt.id);
    const messages = promptIndex >= 0 ? this.messages.slice(promptIndex + 1) : this.messages.slice(before);
    const parsed = parseLastAssistantText(messages);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.text;
  }

  async townTableCombatTacticText(context: unknown): Promise<string> {
    await ensureThinkSession(this);
    const stable = await this.waitUntilStable({ timeout: 12_000 });
    if (!stable) throw new Error("PlayerAgent Think conversation was not stable before town-table combat tactic");
    await this.session.refreshSystemPrompt();
    const before = this.messages.length;
    const prompt = userMessage([
      "Write your combat tactic as this persistent PlayerAgent.",
      "Do not return JSON. Start with one label exactly: ATTACK:, DEFEND:, GRAB:, AID:, WITHDRAW:, or CAST:.",
      "Coordinate with party memory. Be concrete and dangerous. Mention who you protect, what you attack, what object/position you secure, or why you withdraw.",
      "Use only visible state and your own memory. Do not invent hidden truths.",
      `Context: ${JSON.stringify(context)}`
    ].join("\n"));
    const result = await this.saveMessages([prompt]);
    if (result.status !== "completed") throw new Error(`PlayerAgent town-table combat tactic failed: ${"error" in result && result.error ? String(result.error) : result.status}`);
    const promptIndex = this.messages.findIndex((message) => message.id === prompt.id);
    const messages = promptIndex >= 0 ? this.messages.slice(promptIndex + 1) : this.messages.slice(before);
    const parsed = parseLastAssistantText(messages);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.text;
  }

  rememberTavernBeat(input: PlayerTavernMemoryInput): PlayerAgentState {
    const previous = this.state ?? this.initialState;
    const pending = previous.pendingTavernIntent;
    const at = new Date().toISOString();
    const privateGoal = pending?.privateGoal ?? previous.currentGoal ?? "unset";
    const privateFear = pending?.privateFear ?? previous.currentFear ?? "unset";
    const memorySummary = compactText(
      `Beat ${input.committed.beat}: I chose ${input.intent.declaredAction} (${input.intent.intentKind}). I said/did: ${input.intent.tableSpeech}. I wanted: ${privateGoal}. I feared: ${privateFear}. Referee outcome: ${input.beat.tableText}`,
      800
    );
    const nextState: PlayerAgentState = {
      playerId: input.intent.playerId,
      brainSummary: compactText(memorySummary, 800),
      currentGoal: privateGoal,
      currentFear: privateFear,
      privateTheories: takeUniqueStrings([
        ...(pending?.innerMonologue ? [pending.innerMonologue] : []),
        ...previous.privateTheories
      ], 8),
      relationships: takeUniqueStrings([
        ...(input.beat.npcUpdates ?? []).map((npc) => `${npc.name}: ${npc.disposition}`),
        ...previous.relationships
      ], 8),
      recentMemories: [{ beat: input.committed.beat, at, summary: memorySummary }, ...previous.recentMemories].slice(0, 10),
      updatedAt: at
    };
    this.setState(nextState);
    return nextState;
  }

  private privateContextSummary(): string {
    const state = this.state ?? this.initialState;
    return [
      state.brainSummary,
      state.currentGoal ? `Current private goal: ${state.currentGoal}` : "Current private goal: unset.",
      state.currentFear ? `Current private fear: ${state.currentFear}` : "Current private fear: unset.",
      state.privateTheories.length ? `Private theories: ${state.privateTheories.join(" | ")}` : "Private theories: none yet.",
      state.relationships.length ? `Relationships: ${state.relationships.join(" | ")}` : "Relationships: none yet."
    ].join("\n");
  }
}

function toAdventureChoice(playerId: PlayerId, output: AdventureChoiceOutput): AdventureChoice {
  return {
    playerId,
    hookId: output.hookId as HookId,
    approach: output.approach,
    ...(output.tableSpeech ? { tableSpeech: output.tableSpeech } : {}),
    ...(output.innerMonologue ? { innerMonologue: output.innerMonologue } : {}),
    ...(output.goal ? { goal: output.goal } : {}),
    ...(output.fear ? { fear: output.fear } : {}),
    ...(output.reason ? { reason: output.reason } : {})
  };
}

function extractWorkersAIText(result: unknown): string {
  const response = result as {
    response?: string;
    choices?: Array<{ message?: { content?: string }; text?: string }>;
  };
  return response.response ?? response.choices?.[0]?.message?.content ?? response.choices?.[0]?.text ?? "";
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim() ?? trimmed;
  try {
    if (fenced.startsWith("{")) return JSON.parse(fenced);
  } catch {
    // Fall through to balanced-object extraction; many local model responses trail prose or truncate strings.
  }
  const start = fenced.indexOf("{");
  if (start === -1) throw new Error("No JSON object in model response");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < fenced.length; index++) {
    const char = fenced[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return JSON.parse(fenced.slice(start, index + 1));
    }
  }
  throw new Error("No complete JSON object in model response");
}

function extractChatText(result: unknown): string {
  const value = result as { response?: string; choices?: Array<{ message?: { content?: string | Array<{ text?: string; type?: string }> }; text?: string }> };
  const content = value.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part.text ?? "").join("");
  return value.response ?? value.choices?.[0]?.text ?? "";
}

async function withPrototypeTimeout<T>(promise: Promise<T>, label: string, ms = 45_000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function runPrototypeModelText(env: Env, prompt: string, maxTokens = 500): Promise<string> {
  const config = prototypeModelConfig(env);
  const request = {
    messages: [
      { role: "system", content: "Write concise game-table text. No markdown." },
      { role: "user", content: prompt }
    ],
    max_tokens: maxTokens,
    max_completion_tokens: maxTokens,
    temperature: 0.8,
    ...(config.isWorkersAi ? { chat_template_kwargs: { thinking: false, enable_thinking: false }, reasoning_effort: null } : {})
  };
  const options = config.gatewayId && !config.isWorkersAi ? { gateway: { id: config.gatewayId } } : undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await withPrototypeTimeout(options ? env.AI.run(config.model, request, options as never) : env.AI.run(config.model, request), "prototype text model call");
      const text = extractChatText(result).trim();
      if (text) return text;
      lastError = new Error("empty model text response");
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function runPrototypeModelJson(env: Env, prompt: string, maxTokens = 1200): Promise<unknown> {
  const config = prototypeModelConfig(env);
  const options = config.gatewayId && !config.isWorkersAi ? { gateway: { id: config.gatewayId } } : undefined;
  let lastText = "";
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const request = {
      messages: [
        { role: "system", content: "Return one valid JSON object only. No markdown. No prose wrapper. Escape all quotes inside string values." },
        {
          role: "user",
          content: attempt === 0 ? prompt : [
            "Your previous response was not valid JSON.",
            `Parse error: ${String(lastError instanceof Error ? lastError.message : lastError)}`,
            "Rewrite the same intended answer as one syntactically valid JSON object. Escape quotes inside strings. Do not add markdown.",
            "Previous response:",
            lastText.slice(0, 2000),
            "Original task:",
            prompt
          ].join("\n")
        }
      ],
      max_tokens: maxTokens,
      max_completion_tokens: maxTokens,
      temperature: attempt === 0 ? 0.7 : 0.1,
      ...(config.isWorkersAi ? { chat_template_kwargs: { thinking: false, enable_thinking: false }, reasoning_effort: null } : {})
    };
    const result = options ? await env.AI.run(config.model, request, options as never) : await env.AI.run(config.model, request);
    lastText = extractChatText(result);
    try {
      return parseJsonObject(lastText);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function compactStoreCatalog(stores: Record<StoreId, Store>): string {
  return Object.values(stores)
    .flatMap((store) => store.items.map((item) => `${item.id}:${item.name}:${item.costGp}gp`))
    .join("; ");
}

function toCharacterCreationPlan(playerId: PlayerId, output: CharacterCreationPlanOutput): CharacterCreationPlan {
  return {
    playerId,
    name: output.name,
    className: output.className,
    ...(output.abilitySwap ? { abilitySwap: output.abilitySwap } : {}),
    alignment: output.alignment,
    ...(output.deity ? { deity: output.deity } : {}),
    reasonExceptional: output.reasonExceptional,
    ...(output.innerMonologue ? { innerMonologue: output.innerMonologue } : {}),
    ...(output.goal ? { goal: output.goal } : {}),
    ...(output.fear ? { fear: output.fear } : {}),
    purchases: output.purchases
      .filter((purchase) => purchase.quantity > 0)
      .map((purchase) => ({
        itemId: normalizeItemId(purchase.itemId) as `item-${string}`,
        quantity: purchase.quantity
      })),
    planSource: "kimi"
  };
}

function trimPlanToBudget(plan: CharacterCreationPlan, stores: Record<StoreId, Store>, budgetGp: number): CharacterCreationPlan {
  let remaining = budgetGp;
  const purchases: CharacterCreationPlan["purchases"] = [];

  for (const purchase of plan.purchases) {
    const item = Object.values(stores).flatMap((store) => store.items).find((candidate) => candidate.id === purchase.itemId);
    if (!item) continue;
    const affordableQuantity = Math.min(purchase.quantity, Math.floor(remaining / item.costGp));
    if (affordableQuantity <= 0) continue;
    remaining -= affordableQuantity * item.costGp;
    purchases.push({ ...purchase, quantity: affordableQuantity });
  }

  return { ...plan, purchases, planSource: plan.planSource === "kimi" ? "repaired_kimi" : (plan.planSource ?? "unknown") };
}

function assertDistinctCharacterName(plan: CharacterCreationPlan, playerName: string): CharacterCreationPlan {
  const characterName = plan.name.trim().toLowerCase();
  const normalizedPlayer = playerName.trim().toLowerCase();
  if (characterName === normalizedPlayer || characterName.startsWith(`${normalizedPlayer} `) || characterName.startsWith(`${normalizedPlayer}-`)) {
    throw new Error(`Generated character name "${plan.name}" reuses player name "${playerName}"; no canned replacement names are allowed.`);
  }
  return plan;
}

function normalizeItemId(itemId: string): string {
  const aliases: Record<string, string> = {
    "item-flask-oil": "item-oil-flask",
    "item-oil": "item-oil-flask",
    "item-rations": "item-rations-week",
    "item-standard-rations": "item-rations-week",
    "item-iron-rations": "item-iron-rations-week",
    "item-iron-spikes-12": "item-iron-spikes",
    "item-torch": "item-torches",
    "item-torches-6": "item-torches",
    "item-short-bow": "item-shortbow",
    "item-arrows-20": "item-arrows",
    "item-rope": "item-rope-50"
  };
  return aliases[itemId] ?? itemId;
}

function secureRandomInt(sides: number): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  const value = buffer[0] ?? 0;
  return (value % sides) + 1;
}

const PROTOTYPE_SESSION_ZERO_RULE_RECEIPTS = [
  "old-school-essentials-basic-rules-v1-4-a4d9608ea98b:s105:n0",
  "old-school-essentials-classic-fantasy-rules-tome-3751c5149a24:s174:n0",
  "old-school-essentials-classic-fantasy-rules-tome-3751c5149a24:s178",
  "old-school-essentials-classic-fantasy-rules-tome-3751c5149a24:s181",
  "old-school-essentials-classic-fantasy-rules-tome-3751c5149a24:s183"
];

function formatAbilityScores(abilities: Character["abilities"]): string {
  if (!abilities) return "abilities unavailable";
  return [
    `STR ${abilities.strength}`,
    `INT ${abilities.intelligence}`,
    `WIS ${abilities.wisdom}`,
    `DEX ${abilities.dexterity}`,
    `CON ${abilities.constitution}`,
    `CHA ${abilities.charisma}`
  ].join(", ");
}

type PrototypePlaytestRun = {
  mode: "stopped" | "running" | "paused" | "generating" | "failed";
  runId?: string | undefined;
  fiberId?: string | undefined;
  startedAt?: string | undefined;
  updatedAt: string;
  currentBeat: number;
  currentPhase?: string | undefined;
  error?: string | undefined;
  allowContinuous?: boolean | undefined;
};

const TownModuleTableEventSchema = DomainTableEventSchema.extend({
  schema: z.literal("TownModuleTableEvent.v1"),
  agentId: z.union([z.literal("referee"), z.string().regex(/^player-[a-z]$/)]).optional()
});

type TownModuleTableEvent = z.infer<typeof TownModuleTableEventSchema>;

const TownModuleTableStateSchema = z.object({
  schema: z.literal("TownModuleTableState.v1"),
  mode: z.enum(["idle", "running", "stopped", "failed"]),
  runId: z.string().optional(),
  runningFiberId: z.string().optional(),
  townId: z.string(),
  townName: z.string(),
  artifactRepo: z.string(),
  artifactCommit: z.string(),
  beat: z.number().int().nonnegative(),
  moment: z.number().int().nonnegative(),
  location: z.string(),
  locationId: z.string().optional(),
  sceneId: z.string().optional(),
  visitedLocationIds: z.array(z.string()).default([]),
  mentionedLocationIds: z.array(z.string()).default([]),
  transitionIntentLocationId: z.string().optional(),
  activeFrontIds: z.array(z.string()).default([]),
  tablePhase: z.enum(["exploration", "encounter", "combat", "aftermath"]).default("exploration"),
  activeQuestion: z.string(),
  affordances: z.array(z.string()),
  visibleThreads: z.array(z.string()),
  activeLeads: z.array(z.string()).default([]),
  clocks: z.array(DomainTableClockSchema).default([]),
  party: z.array(DomainTablePartyMemberSchema),
  combat: DomainCombatStateSchema.optional(),
  lastEncounter: DomainLastEncounterSchema.optional(),
  difficulty: z.number().int().min(1).max(8).default(1),
  runLimits: DomainTableRunLimitsSchema.optional(),
  playerArtifacts: z.record(z.string(), z.object({ soulMd: z.string(), identityMd: z.string() })).default({}),
  partyMemory: z.record(z.string(), z.object({ knows: z.array(z.string()).default([]), suspects: z.array(z.string()).default([]), goals: z.array(z.string()).default([]), losses: z.array(z.string()).default([]), tactics: z.array(z.string()).default([]), relationships: z.array(z.string()).default([]) })).default({}),
  refereeMemory: z.object({ revealedFacts: z.array(z.string()).default([]), unresolvedThreads: z.array(z.string()).default([]), npcState: z.array(z.string()).default([]), clocksExplained: z.array(z.string()).default([]), hiddenStillPrivate: z.array(z.string()).default([]) }).default({ revealedFacts: [], unresolvedThreads: [], npcState: [], clocksExplained: [], hiddenStillPrivate: [] }),
  stall: z.object({ questionKey: z.string(), count: z.number().int().nonnegative() }).optional(),
  events: z.array(TownModuleTableEventSchema),
  modelCallsUsed: z.number().int().nonnegative().default(0),
  startedAt: z.string().optional(),
  updatedAt: z.string(),
  stoppedReason: z.string().optional(),
  error: z.string().optional()
});

type TownModuleTableState = z.infer<typeof TownModuleTableStateSchema>;

function publicTownModuleTableState(state: TownModuleTableState): TownModuleTableState {
  return TownModuleTableStateSchema.parse({
    ...state,
    playerArtifacts: {},
    partyMemory: {},
    refereeMemory: {
      revealedFacts: state.refereeMemory.revealedFacts,
      unresolvedThreads: state.refereeMemory.unresolvedThreads,
      npcState: state.refereeMemory.npcState,
      clocksExplained: state.refereeMemory.clocksExplained,
      hiddenStillPrivate: []
    },
    events: state.events.filter((event) => event.visibility === "public").map(({ devText: _devText, ...event }) => event)
  });
}

type RefereeState = Campaign & {
  prototypeTavernTown?: PrototypeTavernTownState;
  prototypeBrainArtifacts?: Partial<Record<AgentBrainRole, AgentBrainArtifactRecord>>;
  prototypeTownForge?: TownForgeState;
  prototypeFrozenTownModule?: FrozenTownModuleRef;
  prototypePlaytestRun?: PrototypePlaytestRun;
  prototypeTownModuleTable?: TownModuleTableState;
  prototypeTownModuleTableRunCount?: number;
};

const PROTOTYPE_TAVERN_GENERATION_LOCK_TIMEOUT_MS = 3 * 60 * 1000;
const PROTOTYPE_PLAYTEST_BEAT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_PROTOTYPE_MODEL = "openai/gpt-5.4-mini";
const DEFAULT_PROTOTYPE_GATEWAY_ID = "agent-dungeon";
const DEFAULT_WORKERS_AI_MODEL = "@cf/moonshotai/kimi-k2.6";

function prototypeModelConfig(env: Env): { model: string; gatewayId?: string; isWorkersAi: boolean } {
  const runtime = env as Env & { PROTOTYPE_MODEL?: string; PROTOTYPE_OPENAI_MODEL?: string; AI_GATEWAY_ID?: string };
  const model = (runtime.PROTOTYPE_MODEL ?? runtime.PROTOTYPE_OPENAI_MODEL ?? DEFAULT_PROTOTYPE_MODEL).trim();
  const gatewayId = (runtime.AI_GATEWAY_ID ?? DEFAULT_PROTOTYPE_GATEWAY_ID).trim();
  return {
    model,
    ...(gatewayId && !model.startsWith("@cf/") ? { gatewayId } : {}),
    isWorkersAi: model.startsWith("@cf/")
  };
}
const TOWN_FORGE_STALE_RUN_TIMEOUT_MS = 10 * 60 * 1000;
const TOWN_FORGE_EVENT_HISTORY_LIMIT = 240;

type PrototypeSocketProcessLane = "socket" | "setup" | "player" | "referee" | "rules" | "artifacts" | "state" | "error" | "cot";

type AgentCotRole = "player" | "referee";

type AgentCotDetail = {
  role: AgentCotRole;
  kind: "reasoning" | "text";
  delta: string;
  playerId?: PlayerId;
};

const AGENT_COT_EVENT = "agent-dungeon-prototype-cot";

type CotBuffer = {
  kind: AgentCotDetail["kind"];
  chars: number;
  chunks: number;
  pending: string;
  speaker: string;
  role: AgentCotRole;
  playerId?: PlayerId;
};

function forwardAgentChunkToCotSocket(ctx: ChunkContext, role: AgentCotRole, playerId?: PlayerId): void {
  const chunk = ctx.chunk as { type: string; delta?: string; text?: string };
  if (chunk.type !== "reasoning-delta" && chunk.type !== "text-delta") return;
  const delta = chunk.delta ?? chunk.text ?? "";
  if (!delta) return;
  const detail: AgentCotDetail = {
    role,
    kind: chunk.type === "reasoning-delta" ? "reasoning" : "text",
    delta,
    ...(playerId ? { playerId } : {})
  };
  (globalThis as unknown as EventTarget).dispatchEvent(new CustomEvent(AGENT_COT_EVENT, { detail }));
}

type PrototypeSocketProcessEvent = {
  type: "prototype.process";
  lane: PrototypeSocketProcessLane;
  message: string;
  beat?: number;
  detail?: string;
  reasoning?: string;
  status?: "running" | "done" | "warning" | "error";
  at: string;
  campaignId: string;
};

type PrototypeSocketStateEvent = {
  type: "prototype.state";
  state: PrototypeTavernTownState;
  reason?: string;
  at: string;
  campaignId: string;
};

type PrototypeSocketErrorEvent = {
  type: "prototype.error";
  message: string;
  at: string;
  campaignId: string;
};

type PrototypeSocketEvent = PrototypeSocketProcessEvent | PrototypeSocketStateEvent | PrototypeSocketErrorEvent | {
  type: "prototype.connected";
  at: string;
  campaignId: string;
};

type TownModuleTableSocketEvent = {
  type: "town_table.connected";
  at: string;
  campaignId: string;
} | {
  type: "town_table.state";
  state: TownModuleTableState;
  reason?: string;
  at: string;
  campaignId: string;
} | {
  type: "town_table.event";
  event: TownModuleTableEvent;
  at: string;
  campaignId: string;
} | {
  type: "town_table.error";
  message: string;
  at: string;
  campaignId: string;
};

type PrototypeSocketCommand = {
  type?: string;
  source?: "manual" | "auto" | string;
  allowContinuous?: boolean;
};

type MonitorSocketKind = "tavern-town" | "town-forge" | "town-table";

type TownForgeProcessLane = "socket" | "skill" | "referee" | "graph" | "validation" | "artifacts" | "state" | "error";

type TownForgeSocketProcessEvent = {
  type: "town_forge.process";
  lane: TownForgeProcessLane;
  message: string;
  detail?: string;
  reasoning?: string;
  assetKind?: "location" | "npc" | "rumor" | "clock" | "encounter";
  asset?: unknown;
  status?: "running" | "done" | "warning" | "error";
  runId?: string;
  at: string;
  campaignId: string;
};

type TownForgeSocketStateEvent = {
  type: "town_forge.state";
  state: TownForgeState;
  reason?: string;
  at: string;
  campaignId: string;
};

type TownForgeSocketRawChunkEvent = {
  type: "town_forge.raw_chunk";
  chunk: string;
  index: number;
  attempt: number;
  totalChars: number;
  at: string;
  campaignId: string;
};

type TownForgeSocketEvent = TownForgeSocketProcessEvent | TownForgeSocketStateEvent | TownForgeSocketRawChunkEvent | {
  type: "town_forge.connected";
  at: string;
  campaignId: string;
} | {
  type: "town_forge.error";
  message: string;
  at: string;
  campaignId: string;
};

type TownForgeLiveAsset = {
  kind: NonNullable<TownForgeSocketProcessEvent["assetKind"]>;
  key: string;
  message: string;
  detail: string;
  reasoning: string;
  asset: Record<string, unknown>;
};

type TownForgeTelemetryLevel = "debug" | "info" | "warn" | "error";

type TownForgeTelemetryInput = {
  action: string;
  level?: TownForgeTelemetryLevel;
  success?: boolean;
  runId?: string;
  durationMs?: number;
  error?: unknown;
  metadata?: Record<string, unknown>;
};

type PrototypeSocketConnectionState = {
  monitorKind?: MonitorSocketKind;
  townForgeRaw?: boolean;
  prototypeDev?: boolean;
  prototypeAutoStepsUsed?: number;
};

const PROTOTYPE_SOCKET_AUTO_BEAT_LIMIT = 3;

function hasFreshPrototypeGenerationLock(state: PrototypeTavernTownState): boolean {
  if (state.mode !== "generating") return false;
  const startedAt = Date.parse(state.updatedAt ?? "");
  return Number.isFinite(startedAt) && Date.now() - startedAt < PROTOTYPE_TAVERN_GENERATION_LOCK_TIMEOUT_MS;
}

function prototypeMonitorState(state: PrototypeTavernTownState): PrototypeTavernTownState {
  const safe: PrototypeTavernTownState = {
    ...state,
    party: state.party.map((member) => ({
      ...member,
      goal: "withheld until revealed in play",
      fear: "withheld until revealed in play"
    })),
    log: (state.log ?? []).map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      const { devReasoning: _devReasoning, ...publicEntry } = entry as Record<string, unknown>;
      void _devReasoning;
      return publicEntry;
    })
  };
  if (state.error) safe.error = publicPrototypeError(state.error);
  return safe;
}

function monitorSocketKind(request: Request): MonitorSocketKind | null {
  const url = new URL(request.url);
  const monitor = url.searchParams.get("monitor");
  if (monitor === "prototype") return "tavern-town";
  if (monitor === "town-forge") return "town-forge";
  if (monitor === "town-table") return "town-table";
  return null;
}

function isPrototypeMonitorSocketRequest(request: Request): boolean {
  return monitorSocketKind(request) !== null;
}

function isTownForgeRawSocketRequest(request: Request, env: Env): boolean {
  const url = new URL(request.url);
  if (monitorSocketKind(request) !== "town-forge") return false;
  if (url.searchParams.get("raw") !== "1" || url.searchParams.get("dev") !== "1") return false;

  const observedHosts = [url.hostname, request.headers.get("host"), request.headers.get("x-forwarded-host")];
  if (observedHosts.some(isLocalPrototypeHost)) return true;

  const localDevEnabled = (env as Env & { PROTOTYPE_DEV_ENDPOINTS?: string }).PROTOTYPE_DEV_ENDPOINTS === "1";
  if (localDevEnabled) return true;

  const token = (env as Env & { PROTOTYPE_DEV_TOKEN?: string }).PROTOTYPE_DEV_TOKEN?.trim();
  if (!token) return false;

  const authorization = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const headerToken = request.headers.get("x-prototype-dev-token")?.trim();
  return authorization === token || headerToken === token;
}

function isSameOriginPrototypeSocket(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function publicPrototypeError(error: unknown): string {
  const value = String(error);
  if (/capacity|temporarily exceeded|3040|timeout|504/i.test(value)) return "Workers AI generation failed or timed out; retry the step.";
  if (/already generating|generation lock/i.test(value)) return "The prototype is already generating a beat; wait or reset.";
  return "Prototype generation failed. See Wrangler logs or the dev brain endpoint for details.";
}

function sanitizeTownTablePublicText(text: unknown, fallback: string, maxLength = 420): string {
  const raw = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return fallback;
  const blocked = /(hidden|secret|unrevealed|withheld|not yet revealed|module secret|referee-private|private graph|south cut collapse invol|player-invented|hallucinat)/i;
  const safe = blocked.test(raw) ? fallback : raw;
  return compactText(safe, maxLength);
}

const TOWN_MODULE_TABLE_PLAYER_IDS = ["player-a", "player-b", "player-c", "player-d"] as const;
const TOWN_MODULE_TABLE_MAX_MOMENTS = 100;
const TOWN_MODULE_TABLE_MAX_COMBAT_ROUNDS = 3;
const TOWN_MODULE_TABLE_MAX_AFTER_COMBAT_MOMENTS = 2;

function generatedTownTablePlayerArtifact(input: { playerId: string; playerName: string; characterName: string; className: string; hp: number; armorClass: number; reasonExceptional: string; goal: string; fear: string }): { soulMd: string; identityMd: string } {
  const instincts: Record<string, string> = {
    "player-a": "pressure the obvious lie first, but keep one hand on the exit",
    "player-b": "circle sideways, test objects, and notice who benefits from delay",
    "player-c": "ask literal questions until the room contradicts itself",
    "player-d": "count costs, doors, torches, mouths, and escape routes before trusting anyone"
  };
  const soulMd = [`# SOUL — ${input.playerName}`, "", `${input.playerName} is a persistent PlayerAgent piloting ${input.characterName}, a ${input.className}.`, `Core table instinct: ${instincts[input.playerId] ?? "turn vague danger into a concrete choice"}.`, `Private drive: ${input.goal}.`, `Private fear: ${input.fear}.`, "Play small, sharp, and consequential. Coordinate with other players before danger resolves."].join("\n");
  const identityMd = [`# IDENTITY — ${input.characterName}`, "", `Character: ${input.characterName}`, `Class: ${input.className}`, `Starting durability: ${input.hp} hp, AC ${input.armorClass}`, `Why here: ${input.reasonExceptional}`, "Table lane: make visible choices, state tactics plainly, remember debts/favors/injuries, and do not act on hidden Referee knowledge.", "Combat lane: declare whether you ATTACK, DEFEND, GRAB, AID, WITHDRAW, or CAST; say who you protect or what position/object you secure."].join("\n");
  return { soulMd, identityMd };
}

function generatedTownTableCharacterName(playerId: (typeof TOWN_MODULE_TABLE_PLAYER_IDS)[number], className: string): string {
  const pools: Record<(typeof TOWN_MODULE_TABLE_PLAYER_IDS)[number], string[]> = {
    "player-a": ["Hrum", "Gorunn", "Kest", "Berric", "Orren", "Sable"],
    "player-b": ["Vex", "Bramble", "Nessa", "Pell", "Corra", "Moss"],
    "player-c": ["Lysa", "Dorn", "Fen", "Rook", "Ash", "Merrit"],
    "player-d": ["Olla", "Bran", "Siv", "Nix", "Wren", "Cairn"]
  };
  const pool = pools[playerId];
  return `${pool[secureRandomInt(pool.length) - 1] ?? pool[0]} the ${className}`;
}

export class Referee extends Agent<Env, RefereeState> {
  initialState: RefereeState = seedTavernCampaign("agent-dungeon-campaign");
  private activeTownForgeAbort: AbortController | undefined;
  private activeTownForgeRunId: string | undefined;
  private rawTownForgeConnectionIds = new Set<string>();
  private townForgeTelemetrySequence = 0;

  override getConnectionTags(_connection: Connection, ctx: ConnectionContext): string[] {
    const kind = monitorSocketKind(ctx.request);
    if (kind === "town-forge") return isTownForgeRawSocketRequest(ctx.request, this.env) ? ["town-forge-monitor", "town-forge-raw-monitor"] : ["town-forge-monitor"];
    if (kind === "town-table") return ["town-table-monitor"];
    if (kind === "tavern-town") return ["prototype-monitor"];
    return [];
  }

  override shouldSendProtocolMessages(_connection: Connection, ctx: ConnectionContext): boolean {
    return !isPrototypeMonitorSocketRequest(ctx.request);
  }

  override onConnect(connection: Connection, ctx: ConnectionContext): void {
    const kind = monitorSocketKind(ctx.request);
    if (!kind) return;
    if (!isSameOriginPrototypeSocket(ctx.request)) {
      const message = "Prototype socket rejected: origin must match this Worker host.";
      if (kind === "town-forge") this.sendTownForgeSocketEvent(connection, { type: "town_forge.error", message, at: new Date().toISOString(), campaignId: this.name });
      else this.sendPrototypeSocketEvent(connection, { type: "prototype.error", message, at: new Date().toISOString(), campaignId: this.name });
      connection.close(1008, "origin mismatch");
      return;
    }
    const townForgeRaw = kind === "town-forge" ? isTownForgeRawSocketRequest(ctx.request, this.env) : false;
    const prototypeDev = kind === "tavern-town" || kind === "town-table" ? isPrototypeBrainDevRequest(ctx.request, this.env) : false;
    if (townForgeRaw) this.rawTownForgeConnectionIds.add(connection.id);
    connection.setState({
      ...(connection.state as PrototypeSocketConnectionState | undefined),
      monitorKind: kind,
      townForgeRaw,
      prototypeDev,
      prototypeAutoStepsUsed: 0
    });
    if (kind === "town-forge") {
      this.sendTownForgeSocketEvent(connection, { type: "town_forge.connected", at: new Date().toISOString(), campaignId: this.name });
      this.sendTownForgeStateTo(connection, isTownForgeRawSocketRequest(ctx.request, this.env) ? "connected-raw-dev" : "connected");
      return;
    }
    if (kind === "town-table") {
      this.sendTownTableSocketEvent(connection, { type: "town_table.connected", at: new Date().toISOString(), campaignId: this.name });
      this.sendTownTableStateTo(connection, "connected");
      this.ctx.waitUntil(this.startTownModuleTableRun().catch((error) => this.emitTownTableError(error)));
      return;
    }
    this.sendPrototypeSocketEvent(connection, { type: "prototype.connected", at: new Date().toISOString(), campaignId: this.name });
    this.sendPrototypeStateTo(connection, "connected");
  }

  override onClose(connection: Connection, _code: number, _reason: string, _wasClean: boolean): void {
    this.rawTownForgeConnectionIds.delete(connection.id);
  }

  override async onMessage(connection: Connection, message: WSMessage): Promise<void> {
    if (this.isConnectionProtocolEnabled(connection)) return;
    if (typeof message !== "string") return;
    let parsed: PrototypeSocketCommand;
    try {
      parsed = JSON.parse(message) as PrototypeSocketCommand;
    } catch {
      return;
    }

    if (parsed.type === "town_forge.get_state") {
      this.sendTownForgeStateTo(connection, "requested");
      return;
    }

    if (parsed.type === "town_forge.reset") {
      this.emitTownForgeProcess("state", "Resetting Town Forge state.", { status: "running" });
      const next = await this.resetTownForge();
      this.emitTownForgeProcess("state", "Town Forge reset.", { status: "done", detail: next.mode });
      return;
    }

    if (parsed.type === "town_forge.start") {
      const current = this.getTownForge();
      if (current.mode === "failed" && parsed.source !== "manual") {
        this.emitTownForgeProcess("state", "Ignoring non-manual Town Forge resume request.", {
          status: "warning",
          detail: `source=${parsed.source ?? "missing"}`,
          reasoning: "Failed Town Forge runs only resume from an explicit operator click/API call. Browser auto-resume caused runaway generation and is disabled."
        });
        this.emitTownForgeState(current, "resume-rejected-non-manual");
        return;
      }
      try {
        await this.runTownForge();
      } catch {
        // runTownForge already emitted the public error/state frame.
      }
      return;
    }

    if (parsed.type === "prototype.get_state") {
      this.sendPrototypeStateTo(connection, "requested");
      return;
    }

    if (parsed.type === "prototype.reset") {
      this.emitPrototypeProcess("state", "Resetting the prototype table and clearing child-agent brains.", { status: "running" });
      const next = await this.resetPrototypeTavernTown();
      connection.setState({ ...(connection.state as PrototypeSocketConnectionState | undefined), prototypeAutoStepsUsed: 0 });
      this.emitPrototypeProcess("state", "Prototype table reset.", { beat: next.beat, status: "done" });
      return;
    }

    if (parsed.type === "prototype.run") {
      await this.startPrototypePlaytestRun({ allowContinuous: parsed.allowContinuous === true });
      return;
    }

    if (parsed.type === "prototype.pause") {
      this.pausePrototypePlaytestRun("Paused by operator.");
      return;
    }

    if (parsed.type === "prototype.step") {
      if (parsed.source === "auto" && !parsed.allowContinuous) {
        const connectionState = (connection.state ?? {}) as PrototypeSocketConnectionState;
        const used = connectionState.prototypeAutoStepsUsed ?? 0;
        if (used >= PROTOTYPE_SOCKET_AUTO_BEAT_LIMIT) {
          this.sendPrototypeSocketEvent(connection, {
            type: "prototype.error",
            message: `Autoplay cap reached after ${PROTOTYPE_SOCKET_AUTO_BEAT_LIMIT} AI beats. Step manually or explicitly enable continuous autoplay.`,
            at: new Date().toISOString(),
            campaignId: this.name
          });
          this.sendPrototypeStateTo(connection, "auto-cap-reached");
          return;
        }
        connection.setState({ ...connectionState, prototypeAutoStepsUsed: used + 1 });
      }
      try {
        await this.stepPrototypeTavernTown();
      } catch {
        // stepPrototypeTavernTown already emitted the public error/state frame.
      }
    }
  }

  private sendTownTableSocketEvent(connection: Connection, event: TownModuleTableSocketEvent): void {
    connection.send(JSON.stringify(event));
  }

  private emitTownTableSocketEvent(event: TownModuleTableSocketEvent): void {
    for (const connection of this.getConnections("town-table-monitor")) {
      const isDev = (connection.state as PrototypeSocketConnectionState | undefined)?.prototypeDev === true;
      if (event.type === "town_table.event" && !isDev && event.event.visibility !== "public") continue;
      const safeEvent = event.type === "town_table.event" && !isDev ? { ...event, event: (({ devText: _devText, ...publicEvent }) => publicEvent)(event.event) } : event;
      connection.send(JSON.stringify(safeEvent));
    }
  }

  private sendTownTableStateTo(connection: Connection, reason: string): void {
    const state = this.getTownModuleTableState();
    this.sendTownTableSocketEvent(connection, {
      type: "town_table.state",
      state: (connection.state as PrototypeSocketConnectionState | undefined)?.prototypeDev ? state : publicTownModuleTableState(state),
      reason,
      at: new Date().toISOString(),
      campaignId: this.name
    });
  }

  private emitTownTableState(reason: string): void {
    this.emitTownTableSocketEvent({
      type: "town_table.state",
      state: publicTownModuleTableState(this.getTownModuleTableState()),
      reason,
      at: new Date().toISOString(),
      campaignId: this.name
    });
  }

  private async syncTownTableMemoryToAgents(state: TownModuleTableState): Promise<void> {
    await Promise.allSettled([
      ...TOWN_MODULE_TABLE_PLAYER_IDS.map(async (playerId) => {
        const memory = state.partyMemory[playerId];
        if (!memory) return;
        const agent = await this.subAgent(PlayerAgent, playerId);
        agent.syncTownTableMemory({ playerId, memory });
      }),
      (async () => {
        const referee = await this.subAgent(RefereeAgent, "referee");
        referee.syncTownTableMemory(state.refereeMemory);
      })()
    ]);
  }

  private reduceTownTableMemory(state: TownModuleTableState, commit: TownModuleTableEvent): TownModuleTableState {
    const recent = state.events.slice(0, 18);
    const partyMemory = { ...state.partyMemory };
    for (const member of state.party) {
      const ownEvents = recent.filter((event) => event.agentId === member.playerId || event.speaker === member.character);
      const card = partyMemory[member.playerId] ?? { knows: [], suspects: [], goals: [], losses: [], tactics: [], relationships: [] };
      const tactics = ownEvents.filter((event) => event.kind === "lock_action" || event.kind === "combat_round").map((event) => compactText(event.text, 120));
      const losses = recent.filter((event) => event.text.includes(member.character) && /damage|lost|washed|down|drops|gone/i.test(event.text)).map((event) => compactText(event.text, 120));
      partyMemory[member.playerId] = {
        knows: takeUniqueStrings([compactText(commit.text, 140), ...card.knows], 8),
        suspects: card.suspects,
        goals: takeUniqueStrings([state.activeQuestion, ...card.goals], 5),
        losses: takeUniqueStrings([...losses, ...card.losses], 6),
        tactics: takeUniqueStrings([...tactics, ...card.tactics], 8),
        relationships: card.relationships
      };
    }
    const revealedFacts = recent.filter((event) => event.kind === "ruling" || event.kind === "world_update" || event.kind === "encounter_start").map((event) => compactText(event.text, 150));
    const npcState = recent.filter((event) => /Mort|cutter|grain-buyer|Corvin|Aedra|Gram/i.test(event.text)).map((event) => compactText(event.text, 120));
    const clocksExplained = state.clocks.map((clock) => `${clock.name} ${clock.value}/${clock.max}`);
    return TownModuleTableStateSchema.parse({
      ...state,
      partyMemory,
      refereeMemory: {
        revealedFacts: takeUniqueStrings([...revealedFacts, ...state.refereeMemory.revealedFacts], 12),
        unresolvedThreads: takeUniqueStrings([state.activeQuestion, ...state.activeLeads, ...state.refereeMemory.unresolvedThreads], 12),
        npcState: takeUniqueStrings([...npcState, ...state.refereeMemory.npcState], 12),
        clocksExplained: takeUniqueStrings([...clocksExplained, ...state.refereeMemory.clocksExplained], 8),
        hiddenStillPrivate: takeUniqueStrings(["Fenwater hidden graph and unrevealed encounter causes stay Referee-only until surfaced by play.", ...state.refereeMemory.hiddenStillPrivate], 4)
      }
    });
  }

  private appendTownTableEvent(input: Omit<TownModuleTableEvent, "schema" | "id" | "at"> & { id?: string; at?: string }): TownModuleTableEvent {
    const at = input.at ?? new Date().toISOString();
    const event = TownModuleTableEventSchema.parse({
      schema: "TownModuleTableEvent.v1",
      id: input.id ?? crypto.randomUUID(),
      at,
      ...input
    });
    const state = this.requireRefereeState();
    const current = state.prototypeTownModuleTable ?? this.emptyTownModuleTableState();
    const rawPatch = event.kind === "commit" && event.statePatch && typeof event.statePatch === "object" ? event.statePatch as Record<string, unknown> : {};
    if (event.kind === "commit" && typeof rawPatch.beat === "number" && rawPatch.beat <= current.beat) return event;
    const normalizedPatch = normalizeTableRunPatch(rawPatch as { clocks?: TownModuleTableState["clocks"]; party?: TownModuleTableState["party"] });
    const activeFrontIds = takeUniqueStrings([...inferFenwaterFrontIds(event.text), ...current.activeFrontIds], 24);
    const inferredLocationId = inferFenwaterLocationId(event.text);
    const inferredLocation = fenwaterLocationTitle(inferredLocationId);
    const isRefereeTransition = (event.kind === "ruling" || event.kind === "world_update" || event.kind === "commit") && /\b(go|head|move|travel|follow|chase|enter|leave|exit|withdraw|sprint|run|cross|descend|climb|crawl|arrive|reach|surface|push on|press on)\b/i.test(event.text);
    const mentionedLocationIds = inferredLocationId ? takeUniqueStrings([inferredLocationId, ...current.mentionedLocationIds], 48) : current.mentionedLocationIds;
    const visitedLocationIds = inferredLocationId && isRefereeTransition ? takeUniqueStrings([inferredLocationId, ...current.visitedLocationIds], 32) : current.visitedLocationIds;
    const patched = TownModuleTableStateSchema.parse({
      ...current,
      events: [event, ...current.events].slice(0, 500),
      activeFrontIds,
      mentionedLocationIds,
      ...(inferredLocationId && isRefereeTransition && inferredLocation ? { locationId: inferredLocationId, location: inferredLocation, visitedLocationIds, transitionIntentLocationId: inferredLocationId } : { visitedLocationIds }),
      updatedAt: at,
      ...normalizedPatch
    });
    const next = event.kind === "commit" ? this.reduceTownTableMemory(patched, event) : patched;
    this.setState({ ...state, prototypeTownModuleTable: next });
    if (event.kind === "commit") this.ctx.waitUntil(this.syncTownTableMemoryToAgents(next));
    this.emitTownTableSocketEvent({ type: "town_table.event", event, at, campaignId: this.name });
    this.emitTownTableState(`event-${event.kind}`);
    return event;
  }

  private emitTownTableError(error: unknown): void {
    const message = publicPrototypeError(error);
    const detail = String(error instanceof Error ? error.message : error);
    const state = this.getTownModuleTableState();
    this.setState({ ...this.requireRefereeState(), prototypeTownModuleTable: { ...state, mode: "failed", runningFiberId: undefined, error: detail, updatedAt: new Date().toISOString() } });
    this.appendTownTableEvent({ beat: state.beat, visibility: "public", lane: "error", speaker: "Referee", kind: "error", text: message, devText: detail });
    this.emitTownTableSocketEvent({ type: "town_table.error", message, at: new Date().toISOString(), campaignId: this.name });
  }

  private sendPrototypeSocketEvent(connection: Connection, event: PrototypeSocketEvent): void {
    connection.send(JSON.stringify(event));
  }

  private emitPrototypeSocketEvent(event: PrototypeSocketEvent, devOnly = false): void {
    const message = JSON.stringify(event);
    for (const connection of this.getConnections("prototype-monitor")) {
      if (devOnly && !((connection.state as PrototypeSocketConnectionState | undefined)?.prototypeDev)) continue;
      connection.send(message);
    }
  }

  private sendPrototypeStateTo(connection: Connection, reason: string): void {
    this.sendPrototypeSocketEvent(connection, {
      type: "prototype.state",
      state: prototypeMonitorState(this.getPrototypeTavernTown()),
      reason,
      at: new Date().toISOString(),
      campaignId: this.name
    });
  }

  private emitPrototypeState(state: PrototypeTavernTownState, reason: string): void {
    this.emitPrototypeSocketEvent({
      type: "prototype.state",
      state: prototypeMonitorState(state),
      reason,
      at: new Date().toISOString(),
      campaignId: this.name
    });
  }

  private emitPrototypeProcess(lane: PrototypeSocketProcessLane, message: string, options: { beat?: number; detail?: string; reasoning?: string; status?: PrototypeSocketProcessEvent["status"]; devOnly?: boolean } = {}): void {
    const event: PrototypeSocketProcessEvent = {
      type: "prototype.process",
      lane,
      message,
      at: new Date().toISOString(),
      campaignId: this.name
    };
    if (options.beat !== undefined) event.beat = options.beat;
    if (options.detail !== undefined) event.detail = options.detail;
    if (options.reasoning !== undefined) event.reasoning = options.reasoning;
    if (options.status !== undefined) event.status = options.status;
    const state = this.state;
    const table = state?.prototypeTavernTown;
    if (state && table) {
      try {
        const persistedEvent: Record<string, unknown> = options.devOnly === true
          ? { ...event, ...(options.detail !== undefined ? { detail: options.detail } : {}), reasoning: undefined }
          : event;
        const nextProcessEvents = [persistedEvent, ...((table.processEvents as unknown[] | undefined) ?? [])].slice(0, 240);
        this.setState({ ...state, prototypeTavernTown: { ...table, processEvents: nextProcessEvents, updatedAt: table.updatedAt ?? event.at } });
      } catch (error) {
        console.warn("[Referee] prototype process persistence skipped", error);
      }
    }
    this.emitPrototypeSocketEvent(event, options.devOnly === true);
  }

  private cotForwarderInstalled = false;
  private cotBuffersByActor = new Map<string, CotBuffer>();
  private cotFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private installCotForwarder(): void {
    if (this.cotForwarderInstalled) return;
    this.cotForwarderInstalled = true;
    (globalThis as unknown as EventTarget).addEventListener(AGENT_COT_EVENT, (event: Event) => {
      const detail = (event as CustomEvent<AgentCotDetail>).detail;
      if (!detail || !detail.delta) return;
      this.bufferCotDelta(detail);
    });
  }

  private cotSpeakerLabel(role: AgentCotRole, playerId?: PlayerId): string {
    if (role === "referee") return "Referee";
    if (!playerId) return "PlayerAgent";
    const state = this.state;
    const character = state ? Object.values(state.characters ?? {}).find((candidate) => candidate.playerId === playerId) : undefined;
    if (character?.name) return character.name;
    const player = state?.players?.[playerId];
    return player?.name ?? playerId;
  }

  private bufferCotDelta(detail: AgentCotDetail): void {
    const key = `${detail.role}:${detail.playerId ?? ""}:${detail.kind}`;
    const speaker = this.cotSpeakerLabel(detail.role, detail.playerId);
    const existing = this.cotBuffersByActor.get(key);
    const buffer: CotBuffer = existing ?? {
      kind: detail.kind,
      chars: 0,
      chunks: 0,
      pending: "",
      speaker,
      role: detail.role,
      ...(detail.playerId ? { playerId: detail.playerId } : {})
    };
    buffer.pending += detail.delta;
    buffer.chars += detail.delta.length;
    buffer.chunks += 1;
    buffer.speaker = speaker;
    if (!existing) this.cotBuffersByActor.set(key, buffer);
    if (buffer.pending.length >= 80 || /[\n\.!\?]$/.test(buffer.pending)) {
      this.flushCotBuffer(key);
      return;
    }
    if (this.cotFlushTimers.has(key)) return;
    const timer = setTimeout(() => {
      this.cotFlushTimers.delete(key);
      this.flushCotBuffer(key);
    }, 120);
    this.cotFlushTimers.set(key, timer);
  }

  private flushCotBuffer(key: string): void {
    const buffer = this.cotBuffersByActor.get(key);
    if (!buffer || !buffer.pending) return;
    const text = buffer.pending;
    buffer.pending = "";
    const tag = buffer.kind === "reasoning" ? "[thinking]" : "[saying]";
    this.emitPrototypeProcess("cot", `${buffer.speaker} ${tag}`, {
      detail: text,
      reasoning: `${buffer.role}${buffer.playerId ? `:${buffer.playerId}` : ""} ${buffer.kind} stream (${buffer.chars} chars, ${buffer.chunks} chunks)`,
      status: "running",
      devOnly: true
    });
  }

  private flushAllCotBuffers(): void {
    for (const timer of this.cotFlushTimers.values()) clearTimeout(timer);
    this.cotFlushTimers.clear();
    for (const key of [...this.cotBuffersByActor.keys()]) this.flushCotBuffer(key);
    this.cotBuffersByActor.clear();
  }

  private emitPrototypeError(error: unknown): void {
    const message = publicPrototypeError(error);
    const detail = String(error instanceof Error ? error.message : error);
    this.emitPrototypeSocketEvent({
      type: "prototype.error",
      message,
      at: new Date().toISOString(),
      campaignId: this.name
    });
    this.emitPrototypeProcess("error", message, { status: "error", detail, reasoning: detail, devOnly: true });
    this.emitPrototypeProcess("error", message, { status: "error", detail });
  }

  private sendTownForgeSocketEvent(connection: Connection, event: TownForgeSocketEvent): void {
    connection.send(JSON.stringify(event));
  }

  private emitTownForgeSocketEvent(event: TownForgeSocketEvent): void {
    const message = JSON.stringify(event);
    for (const connection of this.getConnections("town-forge-monitor")) connection.send(message);
  }

  private emitTownForgeRawChunk(runId: string, attempt: number, index: number, totalChars: number, chunk: string): void {
    if (index === 1 || index % 100 === 0) {
      this.townForgeTelemetry({
        action: "town_forge.raw_chunk.observed",
        level: "debug",
        runId,
        metadata: { attempt, index, totalChars, chunkChars: chunk.length }
      });
    }
    const message = JSON.stringify({
      type: "town_forge.raw_chunk",
      chunk,
      index,
      attempt,
      totalChars,
      at: new Date().toISOString(),
      campaignId: this.name
    } satisfies TownForgeSocketRawChunkEvent);
    for (const connection of this.getConnections("town-forge-monitor")) {
      const state = (connection.state ?? {}) as PrototypeSocketConnectionState;
      const tags = ((connection as unknown as { tags?: string[] }).tags ?? []);
      if (state.townForgeRaw || this.rawTownForgeConnectionIds.has(connection.id) || tags.includes("town-forge-raw-monitor")) connection.send(message);
    }
  }

  private sendTownForgeStateTo(connection: Connection, reason: string): void {
    this.sendTownForgeSocketEvent(connection, {
      type: "town_forge.state",
      state: townForgeMonitorState(this.getTownForge()),
      reason,
      at: new Date().toISOString(),
      campaignId: this.name
    });
  }

  private emitTownForgeState(state: TownForgeState, reason: string): void {
    this.townForgeTelemetry({
      action: "town_forge.state.emitted",
      runId: state.runId,
      metadata: { reason, mode: state.mode, events: state.events?.length ?? 0, receipts: state.receipts?.length ?? 0, hasTown: Boolean(state.town), hasPublicTown: Boolean(state.publicTown) }
    });
    this.emitTownForgeSocketEvent({
      type: "town_forge.state",
      state: townForgeMonitorState(state),
      reason,
      at: new Date().toISOString(),
      campaignId: this.name
    });
  }

  private appendTownForgeEvent(event: TownForgeSocketProcessEvent): void {
    const state = this.requireRefereeState();
    const current = state.prototypeTownForge ? TownForgeStateSchema.safeParse(state.prototypeTownForge) : null;
    if (!current?.success) return;
    if (event.runId && current.data.runId !== event.runId) return;
    const next = TownForgeStateSchema.parse({
      ...current.data,
      events: [event, ...(current.data.events ?? [])].slice(0, TOWN_FORGE_EVENT_HISTORY_LIMIT),
      updatedAt: event.at
    });
    this.setState({ ...state, prototypeTownForge: next });
  }

  private emitTownForgeProcess(lane: TownForgeProcessLane, message: string, options: {
    detail?: string;
    reasoning?: string;
    assetKind?: TownForgeSocketProcessEvent["assetKind"];
    asset?: unknown;
    status?: TownForgeSocketProcessEvent["status"];
    runId?: string;
  } = {}): void {
    const event: TownForgeSocketProcessEvent = {
      type: "town_forge.process",
      lane,
      message,
      at: new Date().toISOString(),
      campaignId: this.name
    };
    if (options.runId !== undefined && !this.isCurrentTownForgeRun(options.runId)) return;
    if (options.runId === undefined) {
      const current = this.state?.prototypeTownForge ? TownForgeStateSchema.safeParse(this.state.prototypeTownForge) : null;
      if (current?.success && current.data.mode !== "forging" && lane !== "state" && lane !== "error") return;
    }
    if (options.detail !== undefined) event.detail = options.detail;
    if (options.reasoning !== undefined) event.reasoning = options.reasoning;
    if (options.assetKind !== undefined) event.assetKind = options.assetKind;
    if (options.asset !== undefined) event.asset = options.asset;
    if (options.status !== undefined) event.status = options.status;
    if (options.runId !== undefined) event.runId = options.runId;
    this.townForgeTelemetry({
      action: "town_forge.process.emitted",
      level: options.status === "error" ? "error" : options.status === "warning" ? "warn" : "info",
      success: options.status !== "error",
      ...(options.runId ? { runId: options.runId } : {}),
      metadata: {
        lane,
        status: options.status ?? "none",
        message,
        detailChars: options.detail?.length ?? 0,
        reasoningChars: options.reasoning?.length ?? 0,
        assetKind: options.assetKind,
        assetId: options.asset && typeof options.asset === "object" && "id" in options.asset ? (options.asset as { id?: unknown }).id : undefined,
        assetName: options.asset && typeof options.asset === "object" && "name" in options.asset ? (options.asset as { name?: unknown }).name : undefined
      }
    });
    this.appendTownForgeEvent(event);
    this.emitTownForgeSocketEvent(event);
  }

  private emitTownForgeError(error: unknown): void {
    const message = "Town Forge failed. See Wrangler logs for the private error.";
    this.townForgeTelemetry({ action: "town_forge.error.emitted", level: "error", success: false, error });
    console.warn("[Referee] town forge failed", error);
    this.emitTownForgeSocketEvent({
      type: "town_forge.error",
      message,
      at: new Date().toISOString(),
      campaignId: this.name
    });
    this.emitTownForgeProcess("error", message, { status: "error" });
  }

  private townForgeTelemetry(input: TownForgeTelemetryInput): void {
    const current = this.state?.prototypeTownForge ? TownForgeStateSchema.safeParse(this.state.prototypeTownForge) : null;
    const state = current?.success ? current.data : undefined;
    const event = {
      schema: "TownForgeTelemetry.v1",
      at: new Date().toISOString(),
      source: "worker",
      component: "town-forge",
      action: input.action,
      level: input.level ?? (input.error ? "error" : "info"),
      success: input.success ?? !input.error,
      sequence: this.townForgeTelemetrySequence += 1,
      campaignId: this.name,
      runId: input.runId ?? state?.runId,
      durationMs: input.durationMs,
      state: state ? {
        mode: state.mode,
        runId: state.runId,
        startedAt: state.startedAt,
        updatedAt: state.updatedAt,
        events: state.events?.length ?? 0,
        receipts: state.receipts?.length ?? 0,
        hasTown: Boolean(state.town),
        hasPublicTown: Boolean(state.publicTown)
      } : undefined,
      metadata: input.metadata ?? {},
      error: input.error ? this.townForgeErrorInfo(input.error) : undefined
    };
    const line = JSON.stringify(event);
    if (event.level === "error") console.error(line);
    else if (event.level === "warn") console.warn(line);
    else console.log(line);
  }

  private townForgeErrorInfo(error: unknown): Record<string, unknown> {
    if (error instanceof z.ZodError) {
      return {
        name: "ZodError",
        message: error.message,
        issues: error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code, message: issue.message })).slice(0, 40)
      };
    }
    if (error instanceof Error) {
      return { name: error.name, message: error.message, stack: error.stack?.split("\n").slice(0, 12).join("\n") };
    }
    return { message: String(error) };
  }

  private townForgeCounts(value: unknown): Record<string, number | undefined> {
    if (!value || typeof value !== "object") return {};
    const record = value as Record<string, unknown>;
    const arrayLength = (key: string) => Array.isArray(record[key]) ? (record[key] as unknown[]).length : undefined;
    return {
      locations: arrayLength("locations"),
      npcs: arrayLength("npcs"),
      rumors: arrayLength("rumors"),
      clocks: arrayLength("clocks"),
      latentEncounters: arrayLength("latentEncounters"),
      refereeOpenQuestions: arrayLength("refereeOpenQuestions"),
      validationNotes: arrayLength("validationNotes")
    };
  }

  private townForgePartialTelemetry(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object") return { keys: [], counts: {} };
    const partial = value as Record<string, unknown>;
    return {
      keys: Object.keys(partial).filter((key) => partial[key] !== undefined).sort(),
      counts: this.townForgeCounts(partial),
      latestIds: {
        location: this.partialTownString(this.partialTownRecords(partial, "locations").at(-1) ?? {}, "id", 80),
        npc: this.partialTownString(this.partialTownRecords(partial, "npcs").at(-1) ?? {}, "id", 80),
        rumor: this.partialTownString(this.partialTownRecords(partial, "rumors").at(-1) ?? {}, "id", 80),
        encounter: this.partialTownString(this.partialTownRecords(partial, "latentEncounters").at(-1) ?? {}, "id", 80)
      }
    };
  }

  private createTownForgeRunId(): string {
    return `town-forge-${crypto.randomUUID()}`;
  }

  private isCurrentTownForgeRun(runId: string): boolean {
    const state = this.state?.prototypeTownForge;
    const parsed = state ? TownForgeStateSchema.safeParse(state) : null;
    return Boolean(parsed?.success && parsed.data.mode === "forging" && parsed.data.runId === runId);
  }

  private townForgeResumeContext(state: TownForgeState): unknown {
    const events = state.events ?? [];
    const eventCounts = events.reduce<Record<string, number>>((counts, event) => {
      counts[event.lane] = (counts[event.lane] ?? 0) + 1;
      return counts;
    }, {});
    const graphAssetCounts = events.reduce<Record<string, number>>((counts, event) => {
      if (event.lane !== "graph" || !event.assetKind) return counts;
      counts[event.assetKind] = (counts[event.assetKind] ?? 0) + 1;
      return counts;
    }, {});
    return {
      previousMode: state.mode,
      previousError: state.error,
      eventCounts,
      graphAssetCounts,
      resumePolicy: "Prior partial graph drafts are display receipts only. Do not continue them as source material; start a fresh complete TownGraph.v1 and use receipts only to avoid repeating the same failure mode.",
      receiptSummary: state.receipts.map((receipt) => ({ kind: receipt.kind, status: receipt.status, title: receipt.title, summary: receipt.summary })).slice(-12),
      recentFailures: events
        .filter((event) => event.status === "error" || event.status === "warning" || event.lane === "validation" || event.lane === "error")
        .slice(0, 12)
        .map((event) => ({ lane: event.lane, status: event.status, message: event.message }))
    };
  }

  private townForgeModel(): LanguageModel {
    const workersai = createWorkersAI({ binding: this.env.AI });
    return workersai("@cf/moonshotai/kimi-k2.6", {
      sessionAffinity: `town-forge-${this.name}`,
      reasoning_effort: null,
      chat_template_kwargs: { enable_thinking: false, thinking: false } as any
    }) as unknown as LanguageModel;
  }

  private summarizePartialTownGraph(value: unknown): { keys: string[]; counts: string[]; details: string[] } {
    if (!value || typeof value !== "object") return { keys: [], counts: [], details: [] };
    const partial = value as Record<string, unknown>;
    const keys = Object.keys(partial).filter((key) => partial[key] !== undefined).sort();
    const count = (key: string): number | undefined => Array.isArray(partial[key]) ? (partial[key] as unknown[]).length : undefined;
    const counts = [
      ["locations", count("locations"), "5-7"],
      ["npcs", count("npcs"), "6-10"],
      ["rumors", count("rumors"), "6"],
      ["clocks", count("clocks"), "2-3"],
      ["latent encounters", count("latentEncounters"), "4-6"]
    ]
      .filter((entry): entry is [string, number, string] => typeof entry[1] === "number")
      .map(([label, actual, target]) => `${label} ${actual}/${target}`);
    const details = this.partialTownGraphDetails(partial);
    return { keys, counts, details };
  }

  private partialTownString(record: Record<string, unknown>, key: string, max = 140): string | undefined {
    const value = record[key];
    if (typeof value !== "string") return undefined;
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) return undefined;
    return normalized.length > max ? `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…` : normalized;
  }

  private partialTownNumber(record: Record<string, unknown>, key: string): number | undefined {
    const value = record[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }

  private partialTownRecords(value: unknown, key: string): Record<string, unknown>[] {
    if (!value || typeof value !== "object") return [];
    const maybeArray = (value as Record<string, unknown>)[key];
    if (!Array.isArray(maybeArray)) return [];
    return maybeArray.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }

  private partialTownStringArray(record: Record<string, unknown>, key: string, max = 3): string[] | undefined {
    const value = record[key];
    if (!Array.isArray(value)) return undefined;
    const strings = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, max);
    return strings.length ? strings : undefined;
  }

  private partialTownGraphDetails(partial: Record<string, unknown>): string[] {
    const details: string[] = [];
    const townName = this.partialTownString(partial, "name", 90);
    if (townName) details.push(`town name: ${townName}`);
    const premise = this.partialTownString(partial, "premise", 120) ?? this.partialTownString(partial, "publicVibe", 120);
    if (premise) details.push(`public premise/vibe: ${premise}`);
    const latestLocation = this.partialTownRecords(partial, "locations").at(-1);
    if (latestLocation) {
      const name = this.partialTownString(latestLocation, "name", 70);
      const description = this.partialTownString(latestLocation, "publicDescription", 110);
      if (name || description) details.push(`latest location: ${[name, description].filter(Boolean).join(" — ")}`);
    }
    const latestNpc = this.partialTownRecords(partial, "npcs").at(-1);
    if (latestNpc) {
      const name = this.partialTownString(latestNpc, "name", 70);
      const role = this.partialTownString(latestNpc, "role", 80);
      const want = this.partialTownString(latestNpc, "want", 90);
      if (name || role || want) details.push(`latest NPC: ${[name, role, want ? `wants ${want}` : undefined].filter(Boolean).join(" — ")}`);
    }
    const latestRumor = this.partialTownRecords(partial, "rumors").at(-1);
    if (latestRumor) {
      const text = this.partialTownString(latestRumor, "text", 130) ?? this.partialTownString(latestRumor, "publicClue", 130);
      if (text) details.push(`latest rumor: ${text}`);
    }
    const latestClock = this.partialTownRecords(partial, "clocks").at(-1);
    if (latestClock) {
      const name = this.partialTownString(latestClock, "name", 70);
      const pressure = this.partialTownString(latestClock, "pressure", 100);
      const current = this.partialTownNumber(latestClock, "current");
      const max = this.partialTownNumber(latestClock, "max");
      if (name || pressure) details.push(`latest clock: ${[name, current !== undefined && max !== undefined ? `${current}/${max}` : undefined, pressure].filter(Boolean).join(" — ")}`);
    }
    const latestEncounter = this.partialTownRecords(partial, "latentEncounters").at(-1);
    if (latestEncounter) {
      const title = this.partialTownString(latestEncounter, "title", 80);
      const stakes = this.partialTownString(latestEncounter, "stakes", 110);
      if (title || stakes) details.push(`latest pressure node: ${[title, stakes].filter(Boolean).join(" — ")}`);
    }
    return details.slice(0, 4);
  }

  private partialTownGraphAssets(partial: Record<string, unknown>): TownForgeLiveAsset[] {
    const assets: TownForgeLiveAsset[] = [];
    for (const [index, location] of this.partialTownRecords(partial, "locations").entries()) {
      const id = this.partialTownString(location, "id", 80) ?? `partial-location-${index}`;
      const name = this.partialTownString(location, "name", 120);
      const description = this.partialTownString(location, "publicDescription", 260);
      if (!name || !description || description.length < 24) continue;
      assets.push({
        kind: "location",
        key: `location:${id}`,
        message: `Draft location: ${name}`,
        detail: description,
        reasoning: "Live public-safe location detail from the partial stream. Hidden notes remain withheld until final validation and artifact write.",
        asset: {
          id,
          name,
          kind: this.partialTownString(location, "kind", 80) ?? "other",
          publicDescription: description,
          visibleAffordances: this.partialTownStringArray(location, "visibleAffordances", 5) ?? []
        }
      });
    }
    for (const [index, npc] of this.partialTownRecords(partial, "npcs").entries()) {
      const id = this.partialTownString(npc, "id", 80) ?? `partial-npc-${index}`;
      const name = this.partialTownString(npc, "name", 120);
      const role = this.partialTownString(npc, "role", 120);
      const want = this.partialTownString(npc, "want", 160);
      if (!name || !role) continue;
      assets.push({
        kind: "npc",
        key: `npc:${id}`,
        message: `Draft NPC record: ${name}`,
        detail: [role, want ? `wants ${want}` : undefined].filter(Boolean).join("; "),
        reasoning: "Live public-safe NPC record from the partial stream. Memory seeds and hidden notes are not streamed.",
        asset: {
          id,
          name,
          role,
          publicTell: this.partialTownString(npc, "publicTell", 180) ?? "",
          want: want ?? "",
          publicDisposition: this.partialTownString(npc, "publicDisposition", 180) ?? ""
        }
      });
    }
    for (const [index, rumor] of this.partialTownRecords(partial, "rumors").entries()) {
      const id = this.partialTownString(rumor, "id", 80) ?? `partial-rumor-${index}`;
      const text = this.partialTownString(rumor, "text", 220);
      if (!text || text.length < 20) continue;
      assets.push({
        kind: "rumor",
        key: `rumor:${id}`,
        message: `Draft rumor: ${id}`,
        detail: text,
        reasoning: "Live rumor text from the partial stream. Truth state is deliberately withheld from the monitor.",
        asset: {
          id,
          text,
          truthState: "withheld",
          publicClue: this.partialTownString(rumor, "publicClue", 220) ?? ""
        }
      });
    }
    for (const [index, clock] of this.partialTownRecords(partial, "clocks").entries()) {
      const id = this.partialTownString(clock, "id", 80) ?? `partial-clock-${index}`;
      const name = this.partialTownString(clock, "name", 120);
      const pressure = this.partialTownString(clock, "pressure", 220);
      const current = this.partialTownNumber(clock, "current") ?? 0;
      const max = this.partialTownNumber(clock, "max") ?? 0;
      if (!name || !pressure || pressure.length < 18) continue;
      assets.push({
        kind: "clock",
        key: `clock:${id}`,
        message: `Draft clock: ${name}`,
        detail: `${current}/${max || "?"}: ${pressure}`,
        reasoning: "Live public pressure clock from the partial stream. Clock hidden notes are not streamed.",
        asset: {
          id,
          name,
          pressure,
          current,
          max,
          publicSigns: this.partialTownStringArray(clock, "publicSigns", 5) ?? []
        }
      });
    }
    for (const [index, encounter] of this.partialTownRecords(partial, "latentEncounters").entries()) {
      const id = this.partialTownString(encounter, "id", 80) ?? `partial-encounter-${index}`;
      const title = this.partialTownString(encounter, "title", 140);
      const stakes = this.partialTownString(encounter, "stakes", 220);
      if (!title || !stakes || stakes.length < 18) continue;
      assets.push({
        kind: "encounter",
        key: `encounter:${id}`,
        message: `Draft latent encounter: ${title}`,
        detail: stakes,
        reasoning: "Live pressure-node detail from the partial stream. It is still unvalidated and does not force a scripted encounter.",
        asset: {
          id,
          title,
          type: this.partialTownString(encounter, "type", 80) ?? "discovery",
          stakes,
          tableVisibleClues: this.partialTownStringArray(encounter, "tableVisibleClues", 5) ?? [],
          nonCombatOuts: this.partialTownStringArray(encounter, "nonCombatOuts", 5) ?? []
        }
      });
    }
    return assets;
  }

  private async townForgeGenerateStep<T>(runId: string, step: string, schema: z.ZodType<T>, prompt: string, metadata: Record<string, unknown> = {}, maxOutputTokens = 1200, maxAttempts = 2): Promise<T> {
    const overallStarted = Date.now();
    let previousError = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const attemptStarted = Date.now();
      const attemptMetadata = { step, attempt, maxAttempts, ...metadata };
      const attemptPrompt = [
        prompt,
        "Return only a single valid JSON object for this step. No markdown. No commentary. No trailing text.",
        previousError ? `Previous attempt failed: ${previousError}` : ""
      ].filter(Boolean).join("\n");

      this.townForgeTelemetry({ action: "town_forge.step.started", runId, metadata: attemptMetadata });
      this.emitTownForgeProcess("referee", `Town Forge step started: ${step} (${attempt}/${maxAttempts}).`, {
        status: "running",
        runId,
        detail: JSON.stringify(attemptMetadata),
        reasoning: "The town is now built as small durable graph patches. Each step sees the accepted graph digest and persists before the next step starts."
      });

      const abortController = new AbortController();
      this.activeTownForgeAbort = abortController;
      const heartbeat = setInterval(() => {
        if (!this.isCurrentTownForgeRun(runId)) {
          clearInterval(heartbeat);
          return;
        }
        this.townForgeTelemetry({
          action: "town_forge.step.heartbeat",
          level: "debug",
          runId,
          durationMs: Date.now() - attemptStarted,
          metadata: attemptMetadata
        });
        this.emitTownForgeProcess("referee", `Town Forge step still running: ${step} (${attempt}/${maxAttempts}).`, {
          status: "running",
          runId,
          detail: `${Math.round((Date.now() - attemptStarted) / 1000)}s elapsed`,
          reasoning: "No partial JSON is trusted here. This heartbeat means the small structured request has not returned or failed yet."
        });
      }, 10_000);
      const timeout = setTimeout(() => abortController.abort(`town-forge-step-timeout:${step}:attempt-${attempt}`), 45_000);

      try {
        let textChunks = 0;
        let textChars = 0;
        let partialObjects = 0;
        const result = streamObject({
          model: this.townForgeModel(),
          schema,
          maxOutputTokens,
          abortSignal: abortController.signal,
          prompt: attemptPrompt,
          onError: ({ error }) => {
            this.townForgeTelemetry({
              action: "town_forge.step.stream_error_callback",
              level: "error",
              success: false,
              runId,
              durationMs: Date.now() - attemptStarted,
              error,
              metadata: { ...attemptMetadata, textChunks, textChars, partialObjects }
            });
          }
        });
        for await (const part of result.fullStream) {
          if (!this.isCurrentTownForgeRun(runId)) throw new Error(`town-forge-step-cancelled:${step}`);
          if (part.type === "text-delta") {
            textChunks += 1;
            textChars += part.textDelta.length;
            if (textChunks === 1 || textChunks % 100 === 0) {
              this.townForgeTelemetry({
                action: "town_forge.step.text_progress",
                level: textChunks === 1 ? "info" : "debug",
                runId,
                durationMs: Date.now() - attemptStarted,
                metadata: { ...attemptMetadata, textChunks, textChars, chunkChars: part.textDelta.length }
              });
            }
          } else if (part.type === "object") {
            partialObjects += 1;
            if (partialObjects === 1 || partialObjects % 50 === 0) {
              this.townForgeTelemetry({
                action: "town_forge.step.partial_object",
                level: partialObjects === 1 ? "info" : "debug",
                runId,
                durationMs: Date.now() - attemptStarted,
                metadata: { ...attemptMetadata, textChunks, textChars, partialObjects, partial: this.townForgePartialTelemetry(part.object) }
              });
            }
          } else if (part.type === "finish") {
            this.townForgeTelemetry({
              action: "town_forge.step.stream_finished",
              runId,
              durationMs: Date.now() - attemptStarted,
              metadata: { ...attemptMetadata, finishReason: part.finishReason, usage: part.usage ?? null, textChunks, textChars, partialObjects }
            });
          } else if (part.type === "error") {
            this.townForgeTelemetry({
              action: "town_forge.step.stream_error_part",
              level: "error",
              success: false,
              runId,
              durationMs: Date.now() - attemptStarted,
              error: part.error,
              metadata: { ...attemptMetadata, textChunks, textChars, partialObjects }
            });
          }
        }
        this.townForgeTelemetry({
          action: "town_forge.step.object_await_started",
          runId,
          durationMs: Date.now() - attemptStarted,
          metadata: { ...attemptMetadata, textChunks, textChars, partialObjects }
        });
        const parsed = schema.parse(await result.object);
        this.townForgeTelemetry({
          action: "town_forge.step.validated",
          runId,
          durationMs: Date.now() - overallStarted,
          metadata: { ...attemptMetadata, counts: this.townForgeCounts(parsed), keys: parsed && typeof parsed === "object" ? Object.keys(parsed as Record<string, unknown>).sort() : [], textChunks, textChars, partialObjects }
        });
        this.emitTownForgeProcess("validation", `Town Forge step validated: ${step}.`, {
          status: "done",
          runId,
          detail: JSON.stringify({ durationMs: Date.now() - overallStarted, ...attemptMetadata }),
          reasoning: "A small schema-valid patch was accepted and can now be persisted into the durable draft graph."
        });
        return parsed;
      } catch (error) {
        previousError = String(error);
        const finalAttempt = attempt >= maxAttempts;
        this.townForgeTelemetry({
          action: finalAttempt ? "town_forge.step.failed" : "town_forge.step.repair_retry",
          level: finalAttempt ? "error" : "warn",
          success: false,
          runId,
          durationMs: Date.now() - attemptStarted,
          error,
          metadata: attemptMetadata
        });
        this.emitTownForgeProcess("validation", finalAttempt ? `Town Forge step failed: ${step}.` : `Town Forge step repair retry: ${step}.`, {
          status: finalAttempt ? "error" : "warning",
          runId,
          detail: previousError,
          reasoning: finalAttempt
            ? "The staged build failed on a small patch. No fixture content is substituted."
            : "The small patch failed parsing/validation. The Referee will make one repair attempt with the error as explicit feedback."
        });
        if (finalAttempt) throw error;
      } finally {
        clearInterval(heartbeat);
        clearTimeout(timeout);
        if (this.activeTownForgeAbort === abortController) this.activeTownForgeAbort = undefined;
      }
    }

    throw new Error(`Town Forge step failed without returning or throwing: ${step}`);
  }

  private persistTownForgeDraft(runId: string, stage: string, draft: TownForgeDraftGraph | { skeleton: TownForgeSkeleton }): void {
    const state = this.requireRefereeState();
    const current = state.prototypeTownForge ? TownForgeStateSchema.safeParse(state.prototypeTownForge) : null;
    if (!current?.success || current.data.mode !== "forging" || current.data.runId !== runId) return;
    const at = new Date().toISOString();
    const next = TownForgeStateSchema.parse({
      ...current.data,
      stage,
      draft,
      updatedAt: at
    });
    this.setState({ ...state, prototypeTownForge: next });
    this.townForgeTelemetry({
      action: "town_forge.step.persisted",
      runId,
      metadata: { stage, counts: this.townForgeDraftCounts(draft), draftKeys: Object.keys(draft as Record<string, unknown>).sort() }
    });
  }

  private townForgeDraftCounts(draft: unknown): Record<string, number | undefined> {
    if (!draft || typeof draft !== "object") return {};
    const record = draft as Partial<TownForgeDraftGraph> & { skeleton?: TownForgeSkeleton };
    return {
      skeletonLocations: record.skeleton?.locations?.length,
      skeletonNpcs: record.skeleton?.npcs?.length,
      skeletonRumors: record.skeleton?.rumors?.length,
      skeletonEncounters: record.skeleton?.latentEncounters?.length,
      skeletonClocks: record.skeleton?.clocks?.length,
      locations: record.locations?.length,
      npcs: record.npcs?.length,
      rumors: record.rumors?.length,
      latentEncounters: record.latentEncounters?.length,
      clocks: record.clocks?.length,
      publicProjection: record.publicProjection ? 1 : 0
    };
  }

  private townForgeSkeletonPrompt(context: unknown, generatedAt: string): string {
    return [
      "You are the Referee mind for Cloudflare Agent Dungeon.",
      "Create only a shallow TownForgeSkeleton.v1 graph. No rich prose. No markdown.",
      "This is a planning pass: IDs, names, kinds, one-line purpose/pressure, and links only.",
      "The skeleton must support open-world OSE village play, not a scripted quest path.",
      "Generate a fresh village. Do not use prior demo names or the Brindlehook/Hook and Hen/ferry-chain setup.",
      "No PlayerAgents. NPCs are graph records, not agents.",
      "Keep clocks small; they are pressure trackers, not the whole town.",
      `Machine time for later graph: ${generatedAt}`,
      `Context: ${JSON.stringify(context)}`
    ].join("\n");
  }

  private townForgeShallowPrompt(step: string, context: unknown, current: unknown, generatedAt: string): string {
    return [
      "You are the Referee mind for Cloudflare Agent Dungeon.",
      `Create only the shallow ${step} patch. No rich prose. No markdown.`,
      "Use IDs like lower-kebab-case. Keep text compact: one-line purposes, seeds, or pressure labels only.",
      "This is a planning pass for open-world OSE village play, not a scripted quest path.",
      "Generate a fresh village. Do not use prior demo names or the Brindlehook/Hook and Hen/ferry-chain setup.",
      "No PlayerAgents. NPCs are graph records, not agents. Clocks are small pressure trackers only.",
      `Machine time for later graph: ${generatedAt}`,
      `Context: ${JSON.stringify(context)}`,
      `Accepted shallow graph so far: ${JSON.stringify(current)}`
    ].join("\n");
  }

  private townForgeGraphDigest(draft: TownForgeDraftGraph | { skeleton: TownForgeSkeleton }): unknown {
    const skeleton = draft.skeleton;
    const record = draft as Partial<TownForgeDraftGraph>;
    return {
      town: { id: skeleton.id, name: skeleton.name, premise: skeleton.premise, publicVibe: skeleton.publicVibe, hiddenPressure: skeleton.hiddenPressure },
      locations: skeleton.locations.map((stub) => ({ id: stub.id, name: stub.name, kind: stub.kind, purpose: stub.purpose, done: Boolean(record.locations?.some((item) => item.id === stub.id)) })),
      npcs: skeleton.npcs.map((stub) => ({ id: stub.id, name: stub.name, role: stub.role, purpose: stub.purpose, links: stub.linkedLocationIds, done: Boolean(record.npcs?.some((item) => item.id === stub.id)) })),
      rumors: skeleton.rumors.map((stub) => ({ id: stub.id, seed: stub.seed, links: { locations: stub.linkedLocationIds, npcs: stub.linkedNpcIds }, done: Boolean(record.rumors?.some((item) => item.id === stub.id)) })),
      latentEncounters: skeleton.latentEncounters.map((stub) => ({ id: stub.id, title: stub.title, type: stub.type, pressure: stub.pressure, links: { locations: stub.linkedLocationIds, npcs: stub.linkedNpcIds }, done: Boolean(record.latentEncounters?.some((item) => item.id === stub.id)) })),
      clocks: skeleton.clocks.map((stub) => ({ id: stub.id, name: stub.name, pressure: stub.pressure, done: Boolean(record.clocks?.some((item) => item.id === stub.id)) })),
      acceptedDepth: {
        locations: record.locations?.map((item) => ({ id: item.id, name: item.name, kind: item.kind, linkedNpcIds: item.linkedNpcIds, linkedRumorIds: item.linkedRumorIds })) ?? [],
        npcs: record.npcs?.map((item) => ({ id: item.id, name: item.name, role: item.role, linkedLocationIds: item.linkedLocationIds })) ?? [],
        rumors: record.rumors?.map((item) => ({ id: item.id, linkedLocationIds: item.linkedLocationIds, linkedNpcIds: item.linkedNpcIds })) ?? [],
        latentEncounters: record.latentEncounters?.map((item) => ({ id: item.id, title: item.title, type: item.type, linkedLocationIds: item.linkedLocationIds, linkedNpcIds: item.linkedNpcIds })) ?? []
      }
    };
  }

  private townForgeDepthPrompt(kind: string, stub: unknown, draft: TownForgeDraftGraph | { skeleton: TownForgeSkeleton }, extra = ""): string {
    return [
      `Generate exactly one ${kind} patch for the TownGraph.v1 draft.`,
      "Return JSON only. No markdown. Preserve the requested id and existing link IDs unless the schema forbids them.",
      "Use the full accepted graph digest for context, but only output this one patch.",
      "Keep public fields table-safe. Hidden notes stay Referee-only.",
      extra,
      `Target stub: ${JSON.stringify(stub)}`,
      `Accepted graph digest: ${JSON.stringify(this.townForgeGraphDigest(draft))}`
    ].filter(Boolean).join("\n");
  }

  private townForgeProjectionPrompt(draft: TownForgeDraftGraph): string {
    return [
      "Generate the TownPublicProjection for this accepted TownGraph draft.",
      "Return JSON only. No markdown.",
      "Use only existing location, NPC, and rumor IDs. This is the player-safe starting projection, not hidden truth.",
      "Include 3-8 starting affordances that make immediate table choices possible.",
      `Accepted graph digest: ${JSON.stringify(this.townForgeGraphDigest(draft))}`
    ].join("\n");
  }

  private assertTownForgePatchId(kind: string, expected: string, actual: { id: string }): void {
    if (actual.id !== expected) throw new Error(`${kind} patch id mismatch: expected ${expected}, received ${actual.id}`);
  }

  private validateTownForgeReferences(town: TownGraph): void {
    const locationIds = new Set(town.locations.map((item) => item.id));
    const npcIds = new Set(town.npcs.map((item) => item.id));
    const rumorIds = new Set(town.rumors.map((item) => item.id));
    const check = (kind: string, owner: string, ids: string[], valid: Set<string>) => {
      for (const id of ids) if (!valid.has(id)) throw new Error(`${kind} ${owner} references missing id ${id}`);
    };
    for (const location of town.locations) {
      check("location.linkedNpcIds", location.id, location.linkedNpcIds, npcIds);
      check("location.linkedRumorIds", location.id, location.linkedRumorIds, rumorIds);
    }
    for (const npc of town.npcs) check("npc.linkedLocationIds", npc.id, npc.linkedLocationIds, locationIds);
    for (const rumor of town.rumors) {
      check("rumor.linkedLocationIds", rumor.id, rumor.linkedLocationIds, locationIds);
      check("rumor.linkedNpcIds", rumor.id, rumor.linkedNpcIds, npcIds);
    }
    for (const encounter of town.latentEncounters) {
      check("encounter.linkedLocationIds", encounter.id, encounter.linkedLocationIds, locationIds);
      check("encounter.linkedNpcIds", encounter.id, encounter.linkedNpcIds, npcIds);
    }
    check("publicProjection.visibleLocationIds", town.publicProjection.startingLocationId, [town.publicProjection.startingLocationId, ...town.publicProjection.visibleLocationIds], locationIds);
    check("publicProjection.visibleNpcIds", town.publicProjection.startingLocationId, town.publicProjection.visibleNpcIds, npcIds);
    check("publicProjection.visibleRumorIds", town.publicProjection.startingLocationId, town.publicProjection.visibleRumorIds, rumorIds);
  }

  private async generateTownForgeGraphStaged(context: unknown, runId: string, resumeState?: TownForgeState): Promise<TownGraph> {
    const generatedAt = new Date().toISOString();
    const resumeDraft = resumeState?.draft && typeof resumeState.draft === "object" ? resumeState.draft as Partial<TownForgeDraftGraph> & { skeleton?: Partial<TownForgeSkeleton> } : undefined;
    let shallow: Partial<TownForgeSkeleton> = resumeDraft?.skeleton ? { ...resumeDraft.skeleton } : {};
    const useAcceptedStep = (stage: string, detail: Record<string, unknown>) => {
      this.townForgeTelemetry({ action: "town_forge.step.resumed", runId, metadata: { stage, ...detail } });
      this.emitTownForgeProcess("state", `Resuming from persisted Town Forge step: ${stage}.`, {
        status: "done",
        runId,
        detail: JSON.stringify(detail),
        reasoning: "A previous run already persisted this patch, so the durable staged build continues from the accepted graph instead of starting over."
      });
    };
    const existingBrief = TownForgeBriefSchema.safeParse(shallow);
    const brief = existingBrief.success ? existingBrief.data : await this.townForgeGenerateStep(
      runId,
      "shallow_brief",
      TownForgeBriefSchema,
      this.townForgeShallowPrompt("town brief", context, {}, generatedAt),
      { pass: "shallow", kind: "brief" },
      900
    );
    shallow = { ...shallow, ...brief };
    if (existingBrief.success) useAcceptedStep("shallow_brief", { townId: brief.id, townName: brief.name });
    this.persistTownForgeDraft(runId, "shallow_brief", { skeleton: TownForgeSkeletonSchema.partial().parse(shallow) as TownForgeSkeleton });

    const existingLocations = TownForgeLocationStubSetSchema.safeParse({ locations: shallow.locations });
    const locationStubs = existingLocations.success ? existingLocations.data : await this.townForgeGenerateStep(runId, "shallow_locations", TownForgeLocationStubSetSchema, this.townForgeShallowPrompt("location stubs", context, shallow, generatedAt), { pass: "shallow", kind: "locations" }, 1200);
    shallow = { ...shallow, locations: locationStubs.locations };
    if (existingLocations.success) useAcceptedStep("shallow_locations", { count: locationStubs.locations.length });
    this.persistTownForgeDraft(runId, "shallow_locations", { skeleton: TownForgeSkeletonSchema.partial().parse(shallow) as TownForgeSkeleton });

    const existingNpcs = TownForgeNpcStubSetSchema.safeParse({ npcs: shallow.npcs });
    const npcStubs = existingNpcs.success ? existingNpcs.data : await this.townForgeGenerateStep(runId, "shallow_npcs", TownForgeNpcStubSetSchema, this.townForgeShallowPrompt("NPC stubs", context, shallow, generatedAt), { pass: "shallow", kind: "npcs" }, 1200);
    shallow = { ...shallow, npcs: npcStubs.npcs };
    if (existingNpcs.success) useAcceptedStep("shallow_npcs", { count: npcStubs.npcs.length });
    this.persistTownForgeDraft(runId, "shallow_npcs", { skeleton: TownForgeSkeletonSchema.partial().parse(shallow) as TownForgeSkeleton });

    const existingRumors = TownForgeRumorStubSetSchema.safeParse({ rumors: shallow.rumors });
    const rumorStubs = existingRumors.success ? existingRumors.data : await this.townForgeGenerateStep(runId, "shallow_rumors", TownForgeRumorStubSetSchema, this.townForgeShallowPrompt("rumor stubs", context, shallow, generatedAt), { pass: "shallow", kind: "rumors" }, 900);
    shallow = { ...shallow, rumors: rumorStubs.rumors };
    if (existingRumors.success) useAcceptedStep("shallow_rumors", { count: rumorStubs.rumors.length });
    this.persistTownForgeDraft(runId, "shallow_rumors", { skeleton: TownForgeSkeletonSchema.partial().parse(shallow) as TownForgeSkeleton });

    const existingEncounters = TownForgeEncounterStubSetSchema.safeParse({ latentEncounters: shallow.latentEncounters });
    const encounterStubs = existingEncounters.success ? existingEncounters.data : await this.townForgeGenerateStep(runId, "shallow_encounters", TownForgeEncounterStubSetSchema, this.townForgeShallowPrompt("latent encounter stubs", context, shallow, generatedAt), { pass: "shallow", kind: "encounters" }, 1100, 3);
    shallow = { ...shallow, latentEncounters: encounterStubs.latentEncounters };
    if (existingEncounters.success) useAcceptedStep("shallow_encounters", { count: encounterStubs.latentEncounters.length });
    this.persistTownForgeDraft(runId, "shallow_encounters", { skeleton: TownForgeSkeletonSchema.partial().parse(shallow) as TownForgeSkeleton });

    const existingClocks = TownForgeClockStubSetSchema.safeParse({ clocks: shallow.clocks });
    const clockStubs = existingClocks.success ? existingClocks.data : await this.townForgeGenerateStep(runId, "shallow_clocks", TownForgeClockStubSetSchema, this.townForgeShallowPrompt("clock stubs", context, shallow, generatedAt), { pass: "shallow", kind: "clocks" }, 700);
    shallow = { ...shallow, clocks: clockStubs.clocks };
    if (existingClocks.success) useAcceptedStep("shallow_clocks", { count: clockStubs.clocks.length });

    const existingProjection = TownForgeProjectionStubSchema.safeParse({ publicProjection: shallow.publicProjection });
    const projectionStub = existingProjection.success ? existingProjection.data : await this.townForgeGenerateStep(runId, "shallow_projection", TownForgeProjectionStubSchema, this.townForgeShallowPrompt("public projection stub", context, shallow, generatedAt), { pass: "shallow", kind: "projection" }, 700);
    shallow = { ...shallow, publicProjection: projectionStub.publicProjection };
    if (existingProjection.success) useAcceptedStep("shallow_projection", { startingLocationId: projectionStub.publicProjection.startingLocationId });

    const skeleton = TownForgeSkeletonSchema.parse(shallow);
    this.persistTownForgeDraft(runId, "shallow_skeleton", { skeleton });

    const draft: TownForgeDraftGraph = {
      skeleton,
      generatedAt,
      locations: resumeDraft?.locations ?? [],
      npcs: resumeDraft?.npcs ?? [],
      rumors: resumeDraft?.rumors ?? [],
      latentEncounters: resumeDraft?.latentEncounters ?? [],
      clocks: resumeDraft?.clocks ?? [],
      ...(resumeDraft?.publicProjection ? { publicProjection: resumeDraft.publicProjection } : {})
    };

    for (const stub of skeleton.locations) {
      const location = await this.townForgeGenerateStep(runId, `location:${stub.id}`, TownLocationSchema, this.townForgeDepthPrompt("location", stub, draft), { pass: "depth", kind: "location", id: stub.id }, 1000);
      this.assertTownForgePatchId("location", stub.id, location);
      draft.locations.push(location);
      this.persistTownForgeDraft(runId, `location:${stub.id}`, draft);
      const { hiddenNotes: _hiddenNotes, ...publicLocation } = location;
      void _hiddenNotes;
      this.emitTownForgeProcess("graph", `Location depth complete: ${location.name}`, { status: "done", runId, detail: location.publicDescription, reasoning: "A single location patch was accepted into the durable graph draft.", assetKind: "location", asset: publicLocation });
    }

    for (const stub of skeleton.npcs) {
      const npc = await this.townForgeGenerateStep(runId, `npc:${stub.id}`, TownNpcSchema, this.townForgeDepthPrompt("NPC record", stub, draft), { pass: "depth", kind: "npc", id: stub.id }, 900);
      this.assertTownForgePatchId("npc", stub.id, npc);
      draft.npcs.push(npc);
      this.persistTownForgeDraft(runId, `npc:${stub.id}`, draft);
      const { hiddenNotes: _hiddenNotes, memorySeed: _memorySeed, ...publicNpc } = npc;
      void _hiddenNotes; void _memorySeed;
      this.emitTownForgeProcess("graph", `NPC depth complete: ${npc.name}`, { status: "done", runId, detail: `${npc.role}; wants ${npc.want}`, reasoning: "A single NPC graph record was accepted. NPCs are not agents in this slice.", assetKind: "npc", asset: publicNpc });
    }

    for (const stub of skeleton.rumors) {
      const rumor = await this.townForgeGenerateStep(runId, `rumor:${stub.id}`, TownRumorSchema, this.townForgeDepthPrompt("rumor", stub, draft), { pass: "depth", kind: "rumor", id: stub.id }, 800);
      this.assertTownForgePatchId("rumor", stub.id, rumor);
      draft.rumors.push(rumor);
      this.persistTownForgeDraft(runId, `rumor:${stub.id}`, draft);
      const { hiddenNotes: _hiddenNotes, truthState: _truthState, ...publicRumor } = rumor;
      void _hiddenNotes; void _truthState;
      this.emitTownForgeProcess("graph", `Rumor depth complete: ${rumor.id}`, { status: "done", runId, detail: rumor.text, reasoning: "A single rumor patch was accepted. Truth state stays withheld from the monitor.", assetKind: "rumor", asset: { ...publicRumor, truthState: "withheld" } });
    }

    for (const stub of skeleton.latentEncounters) {
      const encounter = await this.townForgeGenerateStep(runId, `encounter:${stub.id}`, LatentEncounterSchema, this.townForgeDepthPrompt("latent encounter", stub, draft), { pass: "depth", kind: "encounter", id: stub.id }, 1100);
      this.assertTownForgePatchId("encounter", stub.id, encounter);
      draft.latentEncounters.push(encounter);
      this.persistTownForgeDraft(runId, `encounter:${stub.id}`, draft);
      const { hiddenNotes: _hiddenNotes, ...publicEncounter } = encounter;
      void _hiddenNotes;
      this.emitTownForgeProcess("graph", `Encounter depth complete: ${encounter.title}`, { status: "done", runId, detail: `${encounter.type}; ${encounter.stakes}`, reasoning: "A single latent encounter patch was accepted with non-combat outs and aftermath mutation.", assetKind: "encounter", asset: publicEncounter });
    }

    draft.publicProjection = await this.townForgeGenerateStep(runId, "public_projection", TownPublicProjectionSchema, this.townForgeProjectionPrompt(draft), { pass: "projection" }, 1000);
    this.persistTownForgeDraft(runId, "public_projection", draft);

    for (const stub of skeleton.clocks) {
      const clock = await this.townForgeGenerateStep(runId, `clock:${stub.id}`, TownClockSchema, this.townForgeDepthPrompt("clock", stub, draft, "Clock pressure must stay concise and attach to the existing graph; do not invent the whole village around the clock."), { pass: "depth", kind: "clock", id: stub.id }, 800);
      this.assertTownForgePatchId("clock", stub.id, clock);
      draft.clocks.push(clock);
      this.persistTownForgeDraft(runId, `clock:${stub.id}`, draft);
      const { hiddenNotes: _hiddenNotes, ...publicClock } = clock;
      void _hiddenNotes;
      this.emitTownForgeProcess("graph", `Clock depth complete: ${clock.name}`, { status: "done", runId, detail: `${clock.current}/${clock.max}: ${clock.pressure}`, reasoning: "A concise pressure clock was accepted after the town surface existed.", assetKind: "clock", asset: publicClock });
    }

    if (!draft.publicProjection) throw new Error("Town Forge staged draft missing public projection");
    const town = TownGraphSchema.parse({
      schema: "TownGraph.v1",
      id: skeleton.id,
      name: skeleton.name,
      premise: skeleton.premise,
      publicVibe: skeleton.publicVibe,
      hiddenPressure: skeleton.hiddenPressure,
      sourceSkill: TOWN_FORGE_SKILL_KEY,
      generatedAt,
      locations: draft.locations,
      npcs: draft.npcs,
      rumors: draft.rumors,
      latentEncounters: draft.latentEncounters,
      publicProjection: draft.publicProjection,
      clocks: draft.clocks,
      refereeOpenQuestions: skeleton.refereeOpenQuestions,
      validationNotes: skeleton.validationNotes
    });
    this.validateTownForgeReferences(town);
    this.townForgeTelemetry({ action: "town_forge.staged_graph.validated", runId, metadata: { townId: town.id, townName: town.name, counts: this.townForgeCounts(town) } });
    this.emitTownForgeProcess("validation", "Staged TownGraph.v1 validation passed.", {
      status: "done",
      runId,
      detail: `${town.locations.length} locations · ${town.npcs.length} NPC records · ${town.rumors.length} rumors · ${town.clocks.length} clocks · ${town.latentEncounters.length} latent encounters`,
      reasoning: "The final graph was stitched from persisted shallow/depth patches and passed schema plus reference validation."
    });
    return town;
  }

  private townForgeGenerationPrompt(context: unknown, generatedAt: string, validationError = ""): string {
    return [
      "You are the Referee mind for Cloudflare Agent Dungeon.",
      "Use Think skills as on-demand rails, not as a substitute for judgment.",
      "Prepare situations, not scripted outcomes. Build skeletons; players and dice add flesh.",
      "Referee owns hidden truth and public projection boundaries.",
      "Do not reveal hidden notes, raw rules/source corpus, or player-private data in public output.",
      "For Town Forge, create Referee-owned graph records. NPCs are not separate agents in this slice.",
      "Reporting law: if you cannot produce the requested schema or validate the graph, say exactly which step failed in sanitized process language.",
      "Generate a genuinely fresh TownGraph.v1 for Cloudflare Agent Dungeon.",
      "Use the operational card below as rails. It is a runtime skill-card body, not public-facing content.",
      "This pass generates the town surface only. Do not output a clocks key in this pass; clocks are generated after the places, people, rumors, encounters, and projection exist.",
      "Generation order matters. Emit the JSON object in this key order: schema, id, name, premise, publicVibe, hiddenPressure, sourceSkill, generatedAt, locations, npcs, rumors, latentEncounters, publicProjection, refereeOpenQuestions, validationNotes.",
      createVillageSkeletonSkillCard(),
      "Hard no-fixture rule: do not use Brindlehook, The Hook and Hen, Marda Hook, Reeve Caldrin, Sister Owel, Jory Pike, Pell Stitch, Talla Reed, ferry-chain/bell/debtor setup, or any prior deterministic demo content.",
      "This is Referee-only worldbuilding. No PlayerAgents. No character creation. No factions as first-class machinery.",
      "Create a bounded town/village situation graph that supports open-world OSE play without a predetermined quest path.",
      "NPCs are graph records in this slice, not separate agents.",
      "Public fields must be safe. HiddenPressure and hiddenNotes are Referee-only.",
      "Do not quote OSE, Game Angry, or any source corpus. Use no markdown.",
      `Machine fields: schema must be TownGraph.v1, sourceSkill must be ${TOWN_FORGE_SKILL_KEY}, generatedAt must be ${generatedAt}.`,
      validationError ? `Previous attempt rejected: ${validationError}` : "",
      `Context: ${JSON.stringify(context)}`
    ].filter(Boolean).join("\n");
  }

  private townForgeClockPrompt(surface: z.infer<typeof TownGraphSurfaceSchema>, validationError = ""): string {
    return [
      "Generate only the clocks field for this already-created TownGraph surface.",
      "Return JSON matching { clocks: TownClock[] } only. No markdown. No prose.",
      "Create 2-3 concise pressure trackers. Do not create new locations, NPCs, rumors, latent encounters, or projection data.",
      "Each clock should connect to existing places, people, rumors, or latent encounters from the surface instead of becoming the whole village.",
      validationError ? `Previous attempt rejected: ${validationError}` : "",
      `Town surface: ${JSON.stringify(surface)}`
    ].filter(Boolean).join("\n");
  }

  private async generateTownForgeGraphWithTelemetry(context: unknown, runId: string): Promise<TownGraph> {
    let validationError = "";
    const generatedAt = new Date().toISOString();

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const started = Date.now();
      let textChunks = 0;
      let textChars = 0;
      let partialObjects = 0;
      let lastProgressKey = "";
      let firstChunkSeen = false;
      let lastObserved = "request submitted; no stream chunks received yet";
      let lastPartialEventAt = 0;
      let lastTextEventAt = 0;
      const streamedAssetFingerprints = new Map<string, { fingerprint: string; at: number }>();

      this.townForgeTelemetry({
        action: "town_forge.generation.attempt_started",
        runId,
        metadata: { attempt, maxAttempts: 2, generatedAt, hasValidationError: Boolean(validationError), validationErrorChars: validationError.length }
      });
      this.emitTownForgeProcess("referee", `Workers AI structured stream request submitted (attempt ${attempt}/2).`, {
        status: "running",
        detail: "No stream chunk has been received yet.",
        reasoning: "This is the honest pre-first-byte state: the request is with Workers AI / the provider path, but the runtime has no internal model progress to report until streaming events arrive."
      });

      const heartbeat = setInterval(() => {
        if (!this.isCurrentTownForgeRun(runId)) {
          clearInterval(heartbeat);
          return;
        }
        const elapsedSeconds = Math.round((Date.now() - started) / 1000);
        this.townForgeTelemetry({
          action: "town_forge.generation.heartbeat",
          level: firstChunkSeen ? "debug" : "info",
          runId,
          durationMs: Date.now() - started,
          metadata: { attempt, elapsedSeconds, firstChunkSeen, textChunks, textChars, partialObjects, lastObserved }
        });
        this.emitTownForgeProcess("referee", `Workers AI stream still active (${elapsedSeconds}s).`, {
          status: "running",
          detail: lastObserved,
          reasoning: firstChunkSeen
            ? `Observed ${textChunks} JSON text chunk(s), ${textChars} streamed character(s), and ${partialObjects} partial object snapshot(s). ${lastObserved}`
            : "No chunk has arrived yet. Workers AI does not expose queue/model internals here, so the monitor will not invent fake progress."
        });
      }, 8_000);
      const abortController = new AbortController();
      this.activeTownForgeAbort = abortController;
      const abortTimeout = setTimeout(() => {
        lastObserved = "stream aborted after 90s town-forge attempt timeout";
        this.townForgeTelemetry({
          action: "town_forge.generation.attempt_timeout",
          level: "warn",
          success: false,
          runId,
          durationMs: Date.now() - started,
          metadata: { attempt, textChunks, textChars, partialObjects, lastObserved }
        });
        abortController.abort("town-forge-generation-timeout");
      }, 90_000);

      try {
        const result = streamObject({
          model: this.townForgeModel(),
          schema: TownGraphSurfaceSchema,
          maxOutputTokens: 5000,
          abortSignal: abortController.signal,
          prompt: this.townForgeGenerationPrompt(context, generatedAt, validationError),
          onError: ({ error }) => {
            this.townForgeTelemetry({
              action: "town_forge.generation.stream_error_callback",
              level: "error",
              success: false,
              runId,
              durationMs: Date.now() - started,
              error,
              metadata: { attempt, textChunks, textChars, partialObjects, lastObserved }
            });
            this.emitTownForgeProcess("referee", "Workers AI structured stream emitted an error event.", {
              status: "error",
              detail: String(error),
              reasoning: "The stream reported an error before a schema-valid TownGraph was available. No fallback town will be substituted."
            });
          }
        });

        this.emitTownForgeProcess("referee", "AI SDK stream opened; consuming JSON/object events.", {
          status: "running",
          reasoning: "From here, updates reflect observed stream events: text deltas, partial object snapshots, finish, then final schema validation."
        });

        for await (const part of result.fullStream) {
          if (!this.isCurrentTownForgeRun(runId)) throw new Error("Town Forge run was cancelled or superseded before completion");
          if (part.type === "text-delta") {
            textChunks += 1;
            textChars += part.textDelta.length;
            this.emitTownForgeRawChunk(runId, attempt, textChunks, textChars, part.textDelta);
            lastObserved = `text chunks ${textChunks}; streamed JSON characters ${textChars}`;
            if (!firstChunkSeen) {
              this.townForgeTelemetry({
                action: "town_forge.generation.first_chunk",
                runId,
                durationMs: Date.now() - started,
                metadata: { attempt, textChunks, textChars, chunkChars: part.textDelta.length }
              });
              firstChunkSeen = true;
              this.emitTownForgeProcess("referee", "First Workers AI JSON chunk received.", {
                status: "running",
                detail: `${part.textDelta.length} character(s) in first chunk.`,
                reasoning: "The provider is now streaming response text. This is not raw chain-of-thought; it is the JSON object stream being assembled by the AI SDK."
              });
            } else if (textChunks % 100 === 0 && Date.now() - lastTextEventAt > 4_000) {
              lastTextEventAt = Date.now();
              this.townForgeTelemetry({
                action: "town_forge.generation.text_progress",
                level: "debug",
                runId,
                durationMs: Date.now() - started,
                metadata: { attempt, textChunks, textChars, partialObjects, lastObserved }
              });
              this.emitTownForgeProcess("referee", "Workers AI is streaming TownGraph JSON.", {
                status: "running",
                detail: lastObserved,
                reasoning: "Still receiving structured-output text from the provider. Partial object snapshots will appear when the AI SDK parser can assemble them."
              });
            }
          } else if (part.type === "object") {
            partialObjects += 1;
            const progress = this.summarizePartialTownGraph(part.object);
            const progressKey = [...progress.counts, ...progress.details].join("|") || progress.keys.join("|");
            const countText = progress.counts.length ? progress.counts.join(" · ") : `keys ${progress.keys.join(", ") || "none yet"}`;
            const detailText = progress.details.length ? `; ${progress.details.join("; ")}` : "";
            lastObserved = `partial object ${partialObjects}; ${countText}${detailText}`;

            for (const asset of this.partialTownGraphAssets(part.object as Record<string, unknown>)) {
              const fingerprint = JSON.stringify(asset.asset);
              const previous = streamedAssetFingerprints.get(asset.key);
              const now = Date.now();
              const changedEnough = previous === undefined || (now - previous.at > 15_000 && fingerprint !== previous.fingerprint && fingerprint.length - previous.fingerprint.length > 80);
              if (!changedEnough) continue;
              streamedAssetFingerprints.set(asset.key, { fingerprint, at: now });
              this.emitTownForgeProcess("graph", asset.message, {
                status: "running",
                detail: asset.detail,
                reasoning: asset.reasoning,
                assetKind: asset.kind,
                asset: asset.asset
              });
            }

            

            const now = Date.now();
            const meaningfulChange = progressKey !== lastProgressKey;
            const dueForUpdate = now - lastPartialEventAt > (meaningfulChange ? 4_000 : 12_000);
            if (dueForUpdate) {
              lastProgressKey = progressKey;
              lastPartialEventAt = now;
              this.townForgeTelemetry({
                action: "town_forge.generation.partial_object",
                level: meaningfulChange ? "info" : "debug",
                runId,
                durationMs: Date.now() - started,
                metadata: { attempt, partialObjects, textChunks, textChars, progressKey, keys: progress.keys, counts: this.townForgeCounts(part.object), details: progress.details, partial: this.townForgePartialTelemetry(part.object) }
              });
              this.emitTownForgeProcess("referee", "AI SDK parsed a partial TownGraph snapshot.", {
                status: "running",
                detail: lastObserved,
                reasoning: progress.details.length
                  ? "Observed public-safe town details in the streaming JSON. Hidden notes, memory seeds, and rumor truth state are still withheld until validation."
                  : "This is observed parser progress from the streaming JSON. It is still unvalidated, so hidden graph content is not shown or added to the live graph panel yet."
              });
            }
          } else if (part.type === "finish") {
            const usage = part.usage ? `input ${part.usage.inputTokens ?? "?"}, output ${part.usage.outputTokens ?? "?"}, total ${part.usage.totalTokens ?? "?"}` : "usage unavailable";
            lastObserved = `finish reason ${part.finishReason}; ${usage}`;
            this.townForgeTelemetry({
              action: "town_forge.generation.stream_finished",
              runId,
              durationMs: Date.now() - started,
              metadata: { attempt, finishReason: part.finishReason, usage: part.usage ?? null, textChunks, textChars, partialObjects, lastObserved }
            });
            this.emitTownForgeProcess("validation", "Workers AI stream finished; validating final TownGraph schema.", {
              status: "running",
              detail: lastObserved,
              reasoning: "The provider stream is complete. The next real step is AI SDK/Zod validation of the final object."
            });
          } else if (part.type === "error") {
            lastObserved = `stream error: ${String(part.error)}`;
            this.townForgeTelemetry({
              action: "town_forge.generation.stream_error_part",
              level: "error",
              success: false,
              runId,
              durationMs: Date.now() - started,
              error: part.error,
              metadata: { attempt, textChunks, textChars, partialObjects, lastObserved }
            });
            this.emitTownForgeProcess("referee", "Workers AI stream returned an error part.", {
              status: "error",
              detail: lastObserved,
              reasoning: "The stream produced an error part before a validated graph existed. The run may still throw through the AI SDK result promise."
            });
          }
        }

        if (!this.isCurrentTownForgeRun(runId)) throw new Error("Town Forge run was cancelled or superseded before completion");
        this.emitTownForgeProcess("validation", "Final surface stream consumed; awaiting structured object.", {
          status: "running",
          detail: lastObserved,
          reasoning: "The text stream has ended. Now the runtime awaits the AI SDK's final surface object before adding the small clocks layer."
        });

        const surfaceObjectStarted = Date.now();
        const surfaceObject = await result.object;
        this.townForgeTelemetry({
          action: "town_forge.generation.surface_object_received",
          runId,
          durationMs: Date.now() - surfaceObjectStarted,
          metadata: { attempt, counts: this.townForgeCounts(surfaceObject), keys: surfaceObject && typeof surfaceObject === "object" ? Object.keys(surfaceObject as Record<string, unknown>).sort() : [] }
        });
        const surface = TownGraphSurfaceSchema.parse({
          ...surfaceObject,
          schema: "TownGraph.v1",
          sourceSkill: TOWN_FORGE_SKILL_KEY,
          generatedAt
        });
        this.townForgeTelemetry({
          action: "town_forge.generation.surface_validated",
          runId,
          durationMs: Date.now() - started,
          metadata: { attempt, townId: surface.id, townName: surface.name, counts: this.townForgeCounts(surface) }
        });
        if (!this.isCurrentTownForgeRun(runId)) throw new Error("Town Forge run was cancelled or superseded before completion");
        this.emitTownForgeProcess("validation", "Town surface validation passed; generating concise clocks.", {
          status: "running",
          detail: `${surface.locations.length} locations · ${surface.npcs.length} NPC records · ${surface.rumors.length} rumors · ${surface.latentEncounters.length} latent encounters`,
          reasoning: "Clocks are now a small second-stage pressure layer, not the surface that dominates the town build."
        });
        const clockStarted = Date.now();
        this.townForgeTelemetry({
          action: "town_forge.generation.clock_request_started",
          runId,
          metadata: { attempt, townId: surface.id, townName: surface.name }
        });
        const clockResult = await generateObject({
          model: this.townForgeModel(),
          schema: TownGraphClockSetSchema,
          maxOutputTokens: 1200,
          prompt: this.townForgeClockPrompt(surface, validationError)
        });
        this.townForgeTelemetry({
          action: "town_forge.generation.clock_object_received",
          runId,
          durationMs: Date.now() - clockStarted,
          metadata: { attempt, counts: this.townForgeCounts(clockResult.object), clocks: clockResult.object.clocks.map((clock) => ({ id: clock.id, name: clock.name, current: clock.current, max: clock.max })) }
        });
        if (!this.isCurrentTownForgeRun(runId)) throw new Error("Town Forge run was cancelled or superseded before completion");
        const parsed = TownGraphSchema.parse({
          ...surface,
          clocks: clockResult.object.clocks,
          schema: "TownGraph.v1",
          sourceSkill: TOWN_FORGE_SKILL_KEY,
          generatedAt
        });
        this.townForgeTelemetry({
          action: "town_forge.generation.town_graph_validated",
          runId,
          durationMs: Date.now() - started,
          metadata: { attempt, townId: parsed.id, townName: parsed.name, counts: this.townForgeCounts(parsed) }
        });
        this.emitTownForgeProcess("validation", "TownGraph.v1 validation passed.", {
          status: "done",
          detail: `${parsed.locations.length} locations · ${parsed.npcs.length} NPC records · ${parsed.rumors.length} rumors · ${parsed.clocks.length} clocks · ${parsed.latentEncounters.length} latent encounters`,
          reasoning: "The final object passed the same Zod schema that protects artifact writes and public projection. Live graph asset events can now be emitted safely."
        });
        return parsed;
      } catch (error) {
        validationError = String(error);
        if (!this.isCurrentTownForgeRun(runId)) throw error;
        this.townForgeTelemetry({
          action: "town_forge.generation.attempt_failed",
          level: attempt < 2 ? "warn" : "error",
          success: false,
          runId,
          durationMs: Date.now() - started,
          error,
          metadata: { attempt, textChunks, textChars, partialObjects, lastObserved }
        });
        this.emitTownForgeProcess("validation", `TownGraph generation attempt ${attempt} failed validation or streaming.`, {
          status: attempt < 2 ? "warning" : "error",
          detail: validationError,
          reasoning: attempt < 2
            ? "The first attempt did not produce a valid TownGraph. The Referee will make one repair attempt using the validation error as feedback."
            : "The repair attempt also failed. The run will fail honestly with receipts and no generated town."
        });
      } finally {
        clearInterval(heartbeat);
        clearTimeout(abortTimeout);
        if (this.activeTownForgeAbort === abortController) this.activeTownForgeAbort = undefined;
        if (!this.isCurrentTownForgeRun(runId)) throw new Error("Town Forge run was cancelled or superseded before completion");
      }
    }

    throw new Error(`Town Forge stream failed schema validation after retries: ${validationError}`);
  }

  getTownForge(): TownForgeState {
    const state = this.requireRefereeState();
    const parsed = state.prototypeTownForge ? TownForgeStateSchema.safeParse(state.prototypeTownForge) : null;
    if (!parsed?.success) {
      if (state.prototypeTownForge) console.warn("[Referee] clearing invalid legacy Town Forge state", parsed?.error);
      const prototypeTownForge = initialTownForgeState(this.name);
      this.setState({ ...state, prototypeTownForge });
      return prototypeTownForge;
    }
    const current = parsed.data;
    if (current.mode === "forging") {
      const updatedAt = Date.parse(current.updatedAt);
      const isStale = Number.isFinite(updatedAt) && Date.now() - updatedAt > TOWN_FORGE_STALE_RUN_TIMEOUT_MS;
      if (isStale) {
        const at = new Date().toISOString();
        const staleEvent: TownForgeSocketProcessEvent = {
          type: "town_forge.process",
          lane: "state",
          message: "Recovered stale Town Forge run after reconnect.",
          status: "warning",
          detail: "The prior run stopped without a final ready/failed state. Marking it failed instead of leaving the UI wedged.",
          reasoning: "Durable state survived, but no active generator was updating it. This is a resumability guard: keep the receipts, expose the failure, and let the operator start a new run.",
          at,
          campaignId: this.name
        };
        const failed = TownForgeStateSchema.parse({
          ...current,
          mode: "failed",
          receipts: [
            ...current.receipts,
            townForgeReceipt({
              kind: "generation",
              status: "error",
              title: "Town Forge run went stale",
              summary: "The previous forge run stopped without a final state. No fixture content was substituted.",
              at,
              source: { staleAfterMs: TOWN_FORGE_STALE_RUN_TIMEOUT_MS, previousUpdatedAt: current.updatedAt }
            })
          ],
          events: [staleEvent, ...(current.events ?? [])].slice(0, TOWN_FORGE_EVENT_HISTORY_LIMIT),
          error: "Town Forge run went stale; start a new run.",
          updatedAt: at
        });
        this.setState({ ...state, prototypeTownForge: failed });
        return failed;
      }
    }
    return current;
  }

  async resetTownForge(): Promise<TownForgeState> {
    this.activeTownForgeAbort?.abort("town-forge-reset");
    this.activeTownForgeAbort = undefined;
    this.activeTownForgeRunId = undefined;
    const cleanup = await Promise.allSettled([this.deleteSubAgent(RefereeAgent, "town-forge-referee")]);
    const failedCleanup = cleanup.filter((result) => result.status === "rejected");
    if (failedCleanup.length) {
      console.warn("[Referee] town forge reset could not clear child referee", failedCleanup);
      this.emitTownForgeProcess("state", "Reset continued, but the Town Forge child Referee cleanup failed; see dev logs.", { status: "warning" });
    }
    const prototypeTownForge = initialTownForgeState(this.name);
    this.setState({ ...this.requireRefereeState(), prototypeTownForge });
    this.emitTownForgeState(prototypeTownForge, "reset");
    return prototypeTownForge;
  }

  async runTownForge(): Promise<TownForgeState> {
    const current = this.getTownForge();
    if (current.mode === "ready") {
      this.emitTownForgeProcess("state", "Town Forge already has a completed town; reset before forging a new one.", { status: "warning" });
      this.emitTownForgeState(current, "already-ready");
      return current;
    }
    if (current.mode === "forging") {
      this.emitTownForgeProcess("state", "Town Forge durable worker is already running; monitor the existing run instead of starting another.", { status: "running" });
      this.emitTownForgeState(current, "already-forging");
      return current;
    }

    const isResume = current.mode === "failed";

    await this.deleteSubAgent(RefereeAgent, "town-forge-referee").catch((error) => {
      console.warn("[Referee] town forge could not clear prior child Referee before run", error);
      this.emitTownForgeProcess("state", "Continuing after child Referee cleanup warning; fresh run will fail honestly if state is dirty.", { status: "warning" });
    });

    const runId = this.createTownForgeRunId();
    const startedAt = new Date().toISOString();
    const forging: TownForgeState = TownForgeStateSchema.parse({
      ...current,
      runId,
      mode: "forging",
      error: undefined,
      receipts: isResume ? current.receipts : [],
      events: isResume ? (current.events ?? []).filter((event) => event.lane === "state" || event.lane === "validation" || event.lane === "error").slice(0, 20) : [],
      startedAt,
      updatedAt: startedAt
    });
    this.activeTownForgeRunId = runId;
    this.setState({ ...this.requireRefereeState(), prototypeTownForge: forging });
    this.townForgeTelemetry({
      action: "town_forge.run.registered",
      runId,
      metadata: { isResume, startedAt, carriedEvents: forging.events.length, carriedReceipts: forging.receipts.length }
    });
    this.emitTownForgeState(forging, isResume ? "forge-resumed" : "forge-started");
    this.emitTownForgeProcess("state", isResume ? "Resuming Town Forge from persisted failed state." : "Town Forge started as a durable worker.", {
      status: "running",
      runId,
      ...(isResume ? { detail: `${forging.events.length} persisted event(s), ${forging.receipts.length} receipt(s) carried forward.` } : {}),
      reasoning: isResume
        ? "The previous failed run is recoverable, but partial draft graph assets are not reused as generation input. Receipts stay for debugging; this run starts a clean TownGraph.v1 attempt unless reset clears everything."
        : "The Referee body registered a managed Agents fiber before spending model calls. Browser refreshes should only reconnect the monitor, not restart or kill the build."
    });

    const fiberStart = Date.now();
    const fiber = await this.startFiber("town-forge-build", async (fiberCtx) => {
      fiberCtx.stash({ runId, phase: "started", startedAt, isResume });
      await this.executeTownForgeRun(runId, current, forging, isResume);
    }, {
      fiberId: runId,
      idempotencyKey: runId,
      metadata: { runId, startedAt, isResume },
      waitForCompletion: false
    });
    this.townForgeTelemetry({
      action: "town_forge.fiber.accepted",
      runId,
      durationMs: Date.now() - fiberStart,
      metadata: { fiberId: fiber.fiberId, fiberStatus: fiber.status, accepted: fiber.accepted, idempotencyKey: fiber.idempotencyKey, createdAt: fiber.createdAt, startedAt: fiber.startedAt }
    });
    this.emitTownForgeProcess("state", "Durable Town Forge worker accepted.", {
      status: "running",
      runId,
      detail: `fiber=${fiber.fiberId}; status=${fiber.status}; accepted=${fiber.accepted}`,
      reasoning: "The town build now runs through Agents managed fibers. The page is a monitor; refreshing it should replay persisted state instead of becoming the work owner."
    });
    return this.getTownForge();
  }

  override async onFiberRecovered(ctx: FiberRecoveryContext): Promise<void | FiberRecoveryResult> {
    if (ctx.name === "prototype-playtest-run") {
      this.pausePrototypePlaytestRun("Recovered interrupted playtest fiber; paused instead of blindly spending more AI.");
      return { status: "interrupted", reason: "Prototype playtest fiber recovery pauses for operator safety." };
    }
    if (ctx.name !== "town-forge-build") return;
    this.townForgeTelemetry({
      action: "town_forge.fiber.recovered",
      level: "warn",
      runId: ctx.id,
      metadata: { fiberId: ctx.id, name: ctx.name, status: ctx.status, idempotencyKey: ctx.idempotencyKey, createdAt: ctx.createdAt, snapshot: ctx.snapshot }
    });
    const metadata = (ctx.metadata ?? {}) as Record<string, unknown>;
    const runId = typeof metadata.runId === "string" ? metadata.runId : ctx.id;
    const current = this.getTownForge();
    if (current.mode !== "forging" || current.runId !== runId) {
      return { status: "interrupted", reason: "Town Forge state no longer matches recovered fiber." };
    }
    this.emitTownForgeProcess("state", "Durable Town Forge worker recovered after interruption; restarting build worker.", {
      status: "warning",
      runId,
      detail: `recovered fiber=${ctx.id}`,
      reasoning: "Agents detected an interrupted managed fiber. The monitor state is still forging, so the Referee starts a replacement durable worker for the same run id."
    });
    const replacementFiberId = `${runId}-recovered-${Date.now().toString(36)}`;
    const replacement = await this.startFiber("town-forge-build", async (fiberCtx) => {
      fiberCtx.stash({ runId, phase: "recovered", recoveredFrom: ctx.id, snapshot: ctx.snapshot ?? null });
      await this.executeTownForgeRun(runId, current, current, true);
    }, {
      fiberId: replacementFiberId,
      idempotencyKey: replacementFiberId,
      metadata: { runId, recoveredFrom: ctx.id, recoveredAt: new Date().toISOString() },
      waitForCompletion: false
    });
    this.townForgeTelemetry({
      action: "town_forge.fiber.replacement_started",
      level: "warn",
      runId,
      metadata: { recoveredFrom: ctx.id, replacementFiberId: replacement.fiberId, replacementStatus: replacement.status, accepted: replacement.accepted }
    });
    return { status: "completed", snapshot: ctx.snapshot ?? undefined };
  }

  private async executeTownForgeRun(runId: string, current: TownForgeState, forging: TownForgeState, isResume: boolean): Promise<TownForgeState> {
    try {
      this.emitTownForgeProcess("skill", "Publishing create-village-skeleton compiled card to Artifacts and R2.", {
        status: "running",
        reasoning: "Artifacts remains the reviewable source of truth for runtime skill cards; R2 is only the deployed cache that Think can load."
      });
      const { skillArtifact, r2Receipt } = await this.publishTownForgeSkillCard();
      this.emitTownForgeProcess("skill", "Runtime skill card is available in R2 for Think load_context.", {
        status: "done",
        detail: TOWN_FORGE_R2_KEY,
        reasoning: "This proves the Brain/manual → compiled card → Artifacts → R2 path before any town graph is accepted."
      });

      const referee = await this.subAgent(RefereeAgent, "town-forge-referee");
      this.emitTownForgeProcess("skill", "RefereeAgent is loading create-village-skeleton through Think.", {
        status: "running",
        reasoning: "The Referee mind gets the design rail on demand instead of carrying campaign-design instructions in baseline context."
      });
      const loadResult = await referee.loadTownForgeSkill();
      const skillLoadReport = loadResult.loaded
        ? `Loaded ${TOWN_FORGE_SKILL_LABEL}:${TOWN_FORGE_SKILL_KEY}. Loaded keys: ${loadResult.loadedKeys.join(" | ")}.`
        : `Expected ${TOWN_FORGE_SKILL_LABEL}:${TOWN_FORGE_SKILL_KEY} was not loaded. Result status: ${loadResult.resultStatus}. Loaded keys: ${loadResult.loadedKeys.join(" | ") || "none"}.`;
      this.emitTownForgeProcess("skill", loadResult.loaded ? "Think loaded the Town Forge card." : "Think skill load did not confirm; reporting the missing context load.", {
        status: loadResult.loaded ? "done" : "warning",
        detail: skillLoadReport,
        reasoning: loadResult.loaded
          ? "The Referee mind confirmed the runtime card is present in its loaded Think context."
          : "The Referee mind did not confirm the required context key. The run continues through direct generated-object validation, but the missing context load is reported as a warning receipt."
      });

      const skillLoadReceipt = townForgeReceipt({
        kind: "skill-load",
        status: loadResult.loaded ? "ok" : "warning",
        title: "Think load_context attempted",
        summary: loadResult.loaded ? "RefereeAgent loaded create-village-skeleton from R2 via Think." : skillLoadReport,
        source: { label: TOWN_FORGE_SKILL_LABEL, key: TOWN_FORGE_SKILL_KEY, loadedKeys: loadResult.loadedKeys, resultStatus: loadResult.resultStatus }
      });

      this.emitTownForgeProcess("referee", "Referee is drafting the town skeleton from the compiled campaign-design rails.", {
        status: "running",
        reasoning: "The requested output is a situation graph: places, NPC records, rumors, clocks, latent encounters, and a player-safe public projection. This box shows sanitized process notes, not raw chain-of-thought."
      });
      let town: TownGraph;
      let generationReceipt: TownForgeReceipt;
      try {
        town = await this.generateTownForgeGraphStaged({
          campaignId: this.name,
          route: "/prototype/town-forge",
          sourceSkill: TOWN_FORGE_SKILL_KEY,
          ...(isResume ? { resume: this.townForgeResumeContext(current) } : {}),
          constraints: [
            "Referee-only worldbuilding; no PlayerAgents and no character creation.",
            "Build shallow skeleton first, then depth patches per graph node using the accepted graph digest.",
            "Use real town graph shape: locations, NPC records, rumors, clocks, latent encounters, public projection.",
            "No factions first-class in this slice.",
            "NPCs are graph records, not separate agents.",
            "Public projection must omit hidden notes and rumor truth states.",
            "No fixtures, canned demo data, or deterministic fake town fallback. Fail honestly if generation fails.",
            "If resuming, use receipts only to avoid repeating the previous failure mode. Do not continue partial graph drafts from prior attempts."
          ]
        }, runId, current);
        generationReceipt = townForgeReceipt({
          kind: "generation",
          status: "ok",
          title: "Referee generated TownGraph.v1 from staged shallow/depth passes",
          summary: `${town.name}: ${town.locations.length} locations, ${town.npcs.length} NPCs, ${town.rumors.length} rumors, ${town.clocks.length} clocks, ${town.latentEncounters.length} latent encounters.`,
          source: { loadedSkillConfirmed: loadResult.loaded, loadedKeys: loadResult.loadedKeys }
        });
      } catch (error) {
        if (!this.isCurrentTownForgeRun(runId)) return this.getTownForge();
        const receipts = [
          ...(forging.receipts ?? []),
          r2Receipt,
          skillLoadReceipt,
          townForgeReceipt({
            kind: "generation",
            status: "error",
            title: "Referee streamed generation failed",
            summary: "No town was produced. Runtime prototypes must fail honestly instead of substituting fixture content.",
            source: { error: String(error) }
          })
        ];
        const failedCurrent = this.getTownForge();
        const failed: TownForgeState = TownForgeStateSchema.parse({
          schema: "TownForgeState.v1",
          mode: "failed",
          runId,
          receipts,
          artifacts: { skill: skillArtifact, r2Key: TOWN_FORGE_R2_KEY },
          events: failedCurrent.events ?? [],
          ...(failedCurrent.stage ? { stage: failedCurrent.stage } : {}),
          ...(failedCurrent.draft ? { draft: failedCurrent.draft } : {}),
          ...(forging.startedAt ? { startedAt: forging.startedAt } : {}),
          error: "Town Forge generation failed; no fixture fallback is allowed.",
          updatedAt: new Date().toISOString()
        });
        this.setState({ ...this.requireRefereeState(), prototypeTownForge: failed });
        this.activeTownForgeRunId = undefined;
        this.emitTownForgeProcess("referee", "Generation failed honestly. No town fixture was substituted.", {
          status: "error",
          detail: String(error),
          reasoning: "The no-runtime-fixtures rule wins over visual polish. If Workers AI or schema validation fails, the monitor stays empty and the receipt explains why."
        });
        this.emitTownForgeState(failed, "forge-generation-failed");
        return failed;
      }

      if (!this.isCurrentTownForgeRun(runId)) return this.getTownForge();

      for (const location of town.locations) {
        const { hiddenNotes: _hiddenNotes, ...publicLocation } = location;
        void _hiddenNotes;
        this.emitTownForgeProcess("graph", `Location: ${location.name}`, {
          status: "done",
          detail: location.publicDescription,
          reasoning: "Location assets define where player choices can attach. Hidden notes stay in the Referee artifact, not the live public monitor.",
          assetKind: "location",
          asset: publicLocation
        });
      }
      for (const npc of town.npcs) {
        const { hiddenNotes: _hiddenNotes, memorySeed: _memorySeed, ...publicNpc } = npc;
        void _hiddenNotes;
        void _memorySeed;
        this.emitTownForgeProcess("graph", `NPC record: ${npc.name}`, {
          status: "done",
          detail: `${npc.role}; wants ${npc.want}`,
          reasoning: "NPCs are still graph records in this slice. They get wants and dispositions, but not their own agent minds yet.",
          assetKind: "npc",
          asset: publicNpc
        });
      }
      for (const rumor of town.rumors) {
        const { hiddenNotes: _hiddenNotes, truthState: _truthState, ...publicRumor } = rumor;
        void _hiddenNotes;
        void _truthState;
        this.emitTownForgeProcess("graph", `Rumor: ${rumor.id}`, {
          status: "done",
          detail: rumor.text,
          reasoning: "Rumors are player-facing handles into hidden truth. The live monitor withholds truth state until play reveals it.",
          assetKind: "rumor",
          asset: { ...publicRumor, truthState: "withheld" }
        });
      }
      for (const clock of town.clocks) {
        const { hiddenNotes: _hiddenNotes, ...publicClock } = clock;
        void _hiddenNotes;
        this.emitTownForgeProcess("graph", `Clock: ${clock.name}`, {
          status: "done",
          detail: `${clock.current}/${clock.max}: ${clock.pressure}`,
          reasoning: "Clocks make the village move without scripting scenes. They are pressure meters, not plot rails.",
          assetKind: "clock",
          asset: publicClock
        });
      }
      for (const encounter of town.latentEncounters) {
        const { hiddenNotes: _hiddenNotes, ...publicEncounter } = encounter;
        void _hiddenNotes;
        this.emitTownForgeProcess("graph", `Latent encounter: ${encounter.title}`, {
          status: "done",
          detail: `${encounter.type}; ${encounter.stakes}`,
          reasoning: "Latent encounters are pressure nodes that can surface from player choices. They include outs so danger does not collapse into forced combat.",
          assetKind: "encounter",
          asset: publicEncounter
        });
      }

      const validationReceipt = townForgeReceipt({
        kind: "validation",
        status: "ok",
        title: "Town graph validated with Zod",
        summary: "TownGraphSchema and public projection boundaries validated before writing Artifacts.",
        source: { schema: "TownGraph.v1", validator: "zod" }
      });
      const receipts = [
        ...(forging.receipts ?? []),
        r2Receipt,
        skillLoadReceipt,
        generationReceipt,
        validationReceipt
      ];

      this.emitTownForgeProcess("validation", "Rendering data-backed SVX components and graph artifacts.", {
        status: "running",
        reasoning: "After graph validation, the same typed data feeds the live monitor and the reviewable Brain/SVX dossier. No prose dump drift."
      });
      const files = renderTownForgeArtifacts(town, receipts);
      this.emitTownForgeProcess("artifacts", "Syncing Town Forge SVX dossier to Artifacts.", {
        status: "running",
        reasoning: "The generated town is only durable once graph.json, receipts.jsonl, and component-backed SVX pages land in Artifacts."
      });
      const townArtifact = await syncArtifactFiles({
        artifacts: (this.env as Env & { ARTIFACTS?: Artifacts }).ARTIFACTS,
        ...((this.env as Env & { ARTIFACTS_ACCOUNT_ID?: string }).ARTIFACTS_ACCOUNT_ID ? { accountId: (this.env as Env & { ARTIFACTS_ACCOUNT_ID?: string }).ARTIFACTS_ACCOUNT_ID } : {}),
        repoName: TOWN_FORGE_ARTIFACT_REPO,
        description: "Cloudflare Agent Dungeon generated town forge SVX artifacts",
        files,
        message: `town forge: ${town.name} (${town.id})`
      });
      const artifactReceipt = townForgeReceipt({
        kind: "artifact-sync",
        status: townArtifact.status === "synced" ? "ok" : "warning",
        title: "Town Forge artifacts synced",
        summary: `${Object.keys(files).length} files written for ${town.name}.`,
        source: { repoName: townArtifact.repoName, commit: townArtifact.lastCommit, status: townArtifact.status }
      });
      const finalReceipts = [...receipts, artifactReceipt];
      const ready: TownForgeState = TownForgeStateSchema.parse({
        schema: "TownForgeState.v1",
        mode: "ready",
        runId,
        town,
        publicTown: sanitizeTownGraphForMonitor(town),
        receipts: finalReceipts,
        artifacts: {
          skill: skillArtifact,
          town: townArtifact,
          r2Key: TOWN_FORGE_R2_KEY
        },
        events: this.getTownForge().events ?? [],
        ...(forging.startedAt ? { startedAt: forging.startedAt } : {}),
        updatedAt: new Date().toISOString()
      });
      if (!this.isCurrentTownForgeRun(runId)) return this.getTownForge();
      this.setState({ ...this.requireRefereeState(), prototypeTownForge: ready });
      this.activeTownForgeRunId = undefined;
      this.emitTownForgeState(ready, "forge-complete");
      this.emitTownForgeProcess("state", `Town Forge complete: ${town.name}.`, {
        status: "done",
        detail: `${town.locations.length} locations · ${town.npcs.length} NPC records · ${town.latentEncounters.length} latent encounters`,
        reasoning: "The Referee now has a validated town skeleton plus a public projection. Players can enter later without receiving hidden graph truth."
      });
      return ready;
    } catch (error) {
      if (!this.isCurrentTownForgeRun(runId)) return this.getTownForge();
      const failedCurrent = this.getTownForge();
      const failed: TownForgeState = TownForgeStateSchema.parse({
        ...forging,
        mode: "failed",
        events: failedCurrent.events ?? [],
        ...(failedCurrent.stage ? { stage: failedCurrent.stage } : {}),
        ...(failedCurrent.draft ? { draft: failedCurrent.draft } : {}),
        ...(forging.startedAt ? { startedAt: forging.startedAt } : {}),
        error: "Town Forge failed. See Wrangler logs for private details.",
        updatedAt: new Date().toISOString()
      });
      this.setState({ ...this.requireRefereeState(), prototypeTownForge: failed });
      this.activeTownForgeRunId = undefined;
      this.emitTownForgeState(failed, "forge-failed");
      this.emitTownForgeError(error);
      throw error;
    }
  }

  private async publishTownForgeSkillCard(): Promise<{ skillArtifact: ArtifactSyncStatus; r2Receipt: TownForgeReceipt }> {
    const card = createVillageSkeletonSkillCard();
    const manifest = JSON.stringify({
      schema: "RuntimeSkillCardManifest.v1",
      id: TOWN_FORGE_SKILL_KEY,
      label: TOWN_FORGE_SKILL_LABEL,
      r2Key: TOWN_FORGE_R2_KEY,
      artifactPath: `referee/design/${TOWN_FORGE_SKILL_KEY}.md`,
      sourceNote: ".brain/resources/agent-skill-manifest.svx",
      updatedAt: new Date().toISOString()
    }, null, 2);
    const skillArtifact = await syncArtifactFiles({
      artifacts: (this.env as Env & { ARTIFACTS?: Artifacts }).ARTIFACTS,
      ...((this.env as Env & { ARTIFACTS_ACCOUNT_ID?: string }).ARTIFACTS_ACCOUNT_ID ? { accountId: (this.env as Env & { ARTIFACTS_ACCOUNT_ID?: string }).ARTIFACTS_ACCOUNT_ID } : {}),
      repoName: TOWN_FORGE_SKILL_ARTIFACT_REPO,
      description: "Cloudflare Agent Dungeon authoritative compiled runtime skill cards",
      files: {
        [`referee/design/${TOWN_FORGE_SKILL_KEY}.md`]: card,
        "manifest.json": manifest
      },
      message: `runtime skill: ${TOWN_FORGE_SKILL_KEY}`
    });
    await this.env.RUNTIME_SKILLS.put(TOWN_FORGE_R2_KEY, card, {
      customMetadata: {
        description: "Build a bounded OSE-style village/town situation graph for the Referee without scripting outcomes."
      }
    });
    return {
      skillArtifact,
      r2Receipt: townForgeReceipt({
        kind: "r2-cache",
        status: "ok",
        title: "Runtime skill card published to R2",
        summary: `R2 cache updated at ${TOWN_FORGE_R2_KEY}; Artifacts remains authoritative.`,
        source: { r2Key: TOWN_FORGE_R2_KEY, artifactCommit: skillArtifact.lastCommit, artifactStatus: skillArtifact.status }
      })
    };
  }

  async createGame(campaignId = this.name): Promise<Campaign> {
    const campaign = this.commitCampaign(seedTavernCampaign(campaignId));

    // Spawn stable long-lived minds. We do not use per-run facets as identity.
    await this.subAgent(RefereeAgent, "referee");
    await this.subAgent(PlayerAgent, "player-a");
    await this.subAgent(PlayerAgent, "player-b");

    return campaign;
  }

  getCampaign(): Campaign {
    return this.requireCampaign();
  }

  getPublicCampaign() {
    return projectForMonitor(this.requireCampaign());
  }

  getDevCampaign() {
    return projectForDevMonitor(this.requireCampaign());
  }

  async runSessionZero(): Promise<Campaign> {
    this.requireCampaign();

    const playerA = await this.subAgent(PlayerAgent, "player-a");
    const playerB = await this.subAgent(PlayerAgent, "player-b");
    const players = [
      ["player-a", playerA],
      ["player-b", playerB]
    ] as const;

    for (const [playerId, player] of players) {
      if (Object.values(this.requireCampaign().characters).some((character) => character.playerId === playerId)) continue;
      const rolled = rollCharacterCreationDraft(this.requireCampaign(), playerId, secureRandomInt);
      this.commitCampaign(rolled.campaign);
      const plan = await player.createCharacterPlan(rolled.draft, this.requireCampaign().stores);
      try {
        this.commitCampaign(commitCharacterCreation(this.requireCampaign(), rolled.draft, plan, secureRandomInt));
      } catch (error) {
        console.warn("[Referee] player character plan needed purchase repair", error);
        try {
          this.commitCampaign(commitCharacterCreation(this.requireCampaign(), rolled.draft, trimPlanToBudget(plan, this.requireCampaign().stores, rolled.draft.startingGoldGp), secureRandomInt));
        } catch (repairError) {
          console.warn("[Referee] repaired player character plan rejected; no canned fallback", repairError);
          throw new Error(`Player ${playerId} character plan rejected after repair: ${String(repairError)}`);
        }
      }
    }

    return this.requireCampaign();
  }

  advanceWorldTurn(): Campaign {
    return this.commitCampaign(advanceCampaignTurn(this.requireCampaign()));
  }

  async travelToAdventure(): Promise<Campaign> {
    this.requireCampaign();
    if (!this.requireCampaign().party.chosenHookId) await this.chooseAdventure();
    const before = this.requireCampaign();
    const travelled = travelToChosenHook(before, secureRandomInt);
    const referee = await this.subAgent(RefereeAgent, "referee");
    const outcome = await referee.generateOutcome(this.refereeOutcomeContext("travel", before, travelled));
    return this.commitCampaign(commitRefereeOutcome(travelled, outcome));
  }

  async chooseAdventure(): Promise<Campaign> {
    this.requireCampaign();
    if (Object.keys(this.requireCampaign().characters).length === 0) await this.runSessionZero();

    const playerA = await this.subAgent(PlayerAgent, "player-a");
    const playerB = await this.subAgent(PlayerAgent, "player-b");
    const choices = await Promise.all([
      playerA.chooseAdventureHook(this.adventureChoiceContext("player-a")),
      playerB.chooseAdventureHook(this.adventureChoiceContext("player-b"))
    ]);

    const before = this.requireCampaign();
    const chosen = commitAdventureChoice(before, choices);
    const referee = await this.subAgent(RefereeAgent, "referee");
    const outcome = await referee.generateOutcome(this.refereeOutcomeContext("adventure_choice", before, chosen));
    return this.commitCampaign(commitRefereeOutcome(chosen, outcome));
  }

  override async onBeforeSubAgent(_request: Request, child: { className: string; name: string }): Promise<Response | void> {
    const allowed =
      (child.className === "RefereeAgent" && child.name === "referee") ||
      (child.className === "PlayerAgent" && (child.name === "player-a" || child.name === "player-b"));

    if (!allowed || !this.hasSubAgent(child.className, child.name)) {
      return new Response("Not found", { status: 404 });
    }
  }

  private adventureChoiceContext(playerId: PlayerId) {
    const campaign = this.requireCampaign();
    const character = Object.values(campaign.characters).find((candidate) => candidate.playerId === playerId);
    return {
      playerId,
      character: character
        ? {
            name: character.name,
            className: character.className,
            hp: character.stats.hp,
            armorClass: character.stats.armorClass,
            inventory: character.inventory,
            goldGp: character.goldGp,
            rationDays: character.supplies?.rationDays ?? 0,
            reasonExceptional: character.reasonExceptional
          }
        : undefined,
      time: campaign.time,
      currentLocation: campaign.world.locations[campaign.party.currentLocationId],
      hooks: Object.values(campaign.hooks)
        .filter((hook) => hook.status === "available")
        .map((hook) => ({
          id: hook.id,
          title: hook.title,
          publicSummary: hook.publicSummary,
          rumoredReward: hook.rumoredReward,
          danger: hook.danger,
          location: campaign.world.locations[hook.locationId]?.name
        })),
      recentEvents: campaign.publicEvents.slice(-8)
    };
  }

  private refereeOutcomeContext(trigger: "adventure_choice" | "travel", before: Campaign, after: Campaign) {
    return {
      trigger,
      publicState: projectForMonitor(after),
      previousPublicEvents: before.publicEvents.slice(-8),
      newPublicEvents: after.publicEvents.slice(before.publicEvents.length),
      newDice: after.diceLedger.slice(before.diceLedger.length),
      refereeAudit: after.refereeAuditEvents.slice(before.refereeAuditEvents.length)
    };
  }

  private async freezeReadyTownModule(sourceForge?: TownForgeState): Promise<FrozenTownModuleRef> {
    const state = this.requireRefereeState();
    const existing = state.prototypeFrozenTownModule ? FrozenTownModuleRefSchema.safeParse(state.prototypeFrozenTownModule) : null;
    if (existing?.success) return existing.data;

    const defaultRef = FrozenTownModuleRefSchema.parse({
      schema: "FrozenTownModuleRef.v1",
      townId: "fenwater-drainage",
      townName: "Fenwater Drainage",
      version: "v1",
      sourceArtifactRepo: "agent-dungeon-town-forges",
      sourceArtifactCommit: "59ec68209d85ebd7ab6c7fc2441587d672454de6",
      frozenAt: new Date().toISOString(),
      r2: {
        graph: "towns/fenwater-drainage/v1/graph.json",
        publicProjection: "towns/fenwater-drainage/v1/public-projection.json",
        refereePrivate: "towns/fenwater-drainage/v1/referee-private.json",
        receipts: "towns/fenwater-drainage/v1/receipts.jsonl"
      }
    });
    if (!sourceForge) {
      const existingGraph = await this.env.RUNTIME_SKILLS.get(defaultRef.r2.graph);
      if (existingGraph) {
        this.setState({ ...this.requireRefereeState(), prototypeFrozenTownModule: defaultRef });
        this.emitPrototypeProcess("artifacts", `Using frozen town module from R2: ${defaultRef.townName}.`, { beat: 0, status: "done", detail: `${defaultRef.r2.graph} @ ${defaultRef.sourceArtifactCommit}` });
        return defaultRef;
      }
    }

    const forge = sourceForge ?? this.getTownForge();
    if (forge.mode !== "ready" || !forge.town) throw new Error("No ready Town Forge town is available to freeze, and the default Fenwater module was not found in R2");
    const town = TownGraphSchema.parse(forge.town);
    const version = "v1";
    const base = `towns/${town.id}/${version}`;
    const publicProjection = sanitizeTownGraphForMonitor(town);
    const refereePrivate = {
      schema: "FrozenTownRefereePrivate.v1",
      townId: town.id,
      hiddenPressure: town.hiddenPressure,
      locations: town.locations.map(({ id, hiddenNotes }) => ({ id, hiddenNotes })),
      npcs: town.npcs.map(({ id, hiddenNotes, memorySeed }) => ({ id, hiddenNotes, memorySeed })),
      rumors: town.rumors.map(({ id, truthState, hiddenNotes }) => ({ id, truthState, hiddenNotes })),
      clocks: town.clocks.map(({ id, hiddenNotes }) => ({ id, hiddenNotes })),
      latentEncounters: town.latentEncounters.map(({ id, hiddenNotes }) => ({ id, hiddenNotes })),
      refereeOpenQuestions: town.refereeOpenQuestions
    };
    const receiptsJsonl = forge.receipts.map((receipt) => JSON.stringify(receipt)).join("\n") + "\n";
    await Promise.all([
      this.env.RUNTIME_SKILLS.put(`${base}/graph.json`, JSON.stringify(town, null, 2), { httpMetadata: { contentType: "application/json" } }),
      this.env.RUNTIME_SKILLS.put(`${base}/public-projection.json`, JSON.stringify(publicProjection, null, 2), { httpMetadata: { contentType: "application/json" } }),
      this.env.RUNTIME_SKILLS.put(`${base}/referee-private.json`, JSON.stringify(refereePrivate, null, 2), { httpMetadata: { contentType: "application/json" } }),
      this.env.RUNTIME_SKILLS.put(`${base}/receipts.jsonl`, receiptsJsonl, { httpMetadata: { contentType: "application/jsonl" } })
    ]);
    const ref = FrozenTownModuleRefSchema.parse({
      schema: "FrozenTownModuleRef.v1",
      townId: town.id,
      townName: town.name,
      version,
      ...(forge.artifacts?.town?.repoName ? { sourceArtifactRepo: forge.artifacts.town.repoName } : {}),
      ...(forge.artifacts?.town?.lastCommit ? { sourceArtifactCommit: forge.artifacts.town.lastCommit } : {}),
      frozenAt: new Date().toISOString(),
      r2: {
        graph: `${base}/graph.json`,
        publicProjection: `${base}/public-projection.json`,
        refereePrivate: `${base}/referee-private.json`,
        receipts: `${base}/receipts.jsonl`
      }
    });
    this.setState({ ...this.requireRefereeState(), prototypeFrozenTownModule: ref });
    this.emitPrototypeProcess("artifacts", `Frozen town module written to R2: ${town.name}.`, { beat: 0, status: "done", detail: `${ref.r2.graph} @ ${ref.sourceArtifactCommit ?? "no-artifact-commit"}` });
    return ref;
  }

  private emptyTownModuleTableState(): TownModuleTableState {
    return TownModuleTableStateSchema.parse({
      schema: "TownModuleTableState.v1",
      mode: "idle",
      townId: "fenwater-drainage",
      townName: "Fenwater Drainage",
      artifactRepo: TOWN_FORGE_ARTIFACT_REPO,
      artifactCommit: "59ec68209d85ebd7ab6c7fc2441587d672454de6",
      beat: 0,
      moment: 0,
      location: "Loading Fenwater Drainage",
      visitedLocationIds: [],
      mentionedLocationIds: [],
      activeFrontIds: [],
      tablePhase: "exploration",
      activeQuestion: "The Referee is loading the town module from Artifacts.",
      affordances: [],
      visibleThreads: [],
      activeLeads: [],
      clocks: [],
      party: [],
      events: [],
      modelCallsUsed: 0,
      updatedAt: new Date().toISOString()
    });
  }

  async getTownModuleTableStateRpc(): Promise<TownModuleTableState> {
    return this.getTownModuleTableState();
  }

  getTownModuleTableState(): TownModuleTableState {
    const state = this.requireRefereeState();
    if (state.prototypeTownModuleTable) return TownModuleTableStateSchema.parse(state.prototypeTownModuleTable);
    const table = this.emptyTownModuleTableState();
    this.setState({ ...state, prototypeTownModuleTable: table });
    return table;
  }

  async resetTownModuleTable(options: { difficulty?: number; maxBeats?: number; sampleSeconds?: number } = {}): Promise<TownModuleTableState> {
    const state = this.requireRefereeState();
    const runCount = (state.prototypeTownModuleTableRunCount ?? 0) + 1;
    const normalizedOptions = normalizeTableRunStartOptions(options);
    const difficulty = normalizedOptions.difficulty ?? Math.min(8, runCount);
    const { maxBeats, sampleSeconds } = normalizedOptions;
    const table = { ...this.emptyTownModuleTableState(), difficulty, ...(maxBeats || sampleSeconds ? { runLimits: { ...(maxBeats ? { maxBeats } : {}), ...(sampleSeconds ? { sampleSeconds } : {}) } } : {}) };
    this.setState({ ...state, prototypeTownModuleTable: table, prototypeTownModuleTableRunCount: runCount });
    this.emitTownTableState("reset");
    return table;
  }

  private async loadFenwaterTownModuleFromArtifacts(): Promise<{ town: TownGraph; receipts: string; artifactCommit: string }> {
    const artifactCommit = FENWATER_DRAINAGE_ARTIFACT_COMMIT;
    const artifact = await readArtifactFiles({
      artifacts: (this.env as Env & { ARTIFACTS?: Artifacts }).ARTIFACTS,
      ...((this.env as Env & { ARTIFACTS_ACCOUNT_ID?: string }).ARTIFACTS_ACCOUNT_ID ? { accountId: (this.env as Env & { ARTIFACTS_ACCOUNT_ID?: string }).ARTIFACTS_ACCOUNT_ID } : {}),
      repoName: TOWN_FORGE_ARTIFACT_REPO,
      commit: artifactCommit,
      paths: FENWATER_DRAINAGE_ARTIFACT_PATHS
    });
    return { town: TownGraphSchema.parse(JSON.parse(artifact.files["towns/fenwater-drainage/graph.json"] ?? "{}")), receipts: artifact.files["towns/fenwater-drainage/receipts.jsonl"] ?? "", artifactCommit: artifact.commit ?? artifactCommit };
  }

  private async initializeTownModuleTableFromArtifacts(): Promise<TownModuleTableState> {
    const current = this.getTownModuleTableState();
    if (current.mode !== "idle") return current;
    this.appendTownTableEvent({ beat: 0, visibility: "public", lane: "artifacts", speaker: "Referee", kind: "frame_moment", text: "Loading Fenwater Drainage from the Town Forge Artifacts repo." });
    const { town, artifactCommit } = await this.loadFenwaterTownModuleFromArtifacts();
    const adventureModule = adventureModuleFromFenwaterTownGraph({ town, artifactRepo: TOWN_FORGE_ARTIFACT_REPO, artifactCommit });
    const projection = town.publicProjection;
    const startingLocation = town.locations.find((location) => location.id === projection.startingLocationId) ?? town.locations[0];
    if (!startingLocation) throw new Error("Fenwater artifact has no starting location");
    let campaign = seedTavernCampaign(this.name);
    campaign = {
      ...campaign,
      players: {
        ...campaign.players,
        "player-c": { id: "player-c", name: "Ibb", personality: "Curious, literal, and unable to leave an odd detail alone." },
        "player-d": { id: "player-d", name: "Kett", personality: "Practical, hungry, and always counting exits, prices, and torches." }
      }
    };
    const players: Array<{ playerId: (typeof TOWN_MODULE_TABLE_PLAYER_IDS)[number]; player: string; character: Character; soulMd: string; identityMd: string }> = [];
    for (const playerId of TOWN_MODULE_TABLE_PLAYER_IDS) {
      const rolled = rollCharacterCreationDraft(campaign, playerId, secureRandomInt);
      campaign = rolled.campaign;
      const playerName = campaign.players[playerId]?.name ?? playerId;
      this.appendTownTableEvent({ beat: 0, visibility: "public", lane: "player", agentId: playerId, speaker: playerName, kind: "thought_bubble", text: `${playerName} studies the rolled sheet before entering Fenwater.` });
      const abilities = rolled.draft.rawAbilities;
      const best = Object.entries(abilities).sort(([, a], [, b]) => b - a)[0]?.[0] ?? "strength";
      const className = best === "dexterity" ? "thief" : best === "wisdom" ? "cleric" : best === "intelligence" ? "magic-user" : best === "constitution" ? "dwarf" : best === "charisma" ? "halfling" : "fighter";
      let plan = assertDistinctCharacterName(toCharacterCreationPlan(playerId, CharacterCreationPlanSchema.parse({
        name: generatedTownTableCharacterName(playerId, className),
        className,
        alignment: "neutral",
        reasonExceptional: `${playerName} follows the Fenwater rumors because staying still near bad water feels worse than moving.`,
        innerMonologue: `${playerName} is watching for the first small lie at the table.`,
        goal: "find leverage before accepting danger",
        fear: "being trapped underground without a clean exit",
        purchases: []
      })), playerName);
      try {
        campaign = commitCharacterCreation(campaign, rolled.draft, plan, secureRandomInt);
      } catch (error) {
        console.warn("[Referee] town table character plan needed purchase repair", error);
        plan = assertDistinctCharacterName(trimPlanToBudget(plan, campaign.stores, rolled.draft.startingGoldGp), playerName);
        campaign = commitCharacterCreation(campaign, rolled.draft, plan, secureRandomInt);
      }
      const character = Object.values(campaign.characters).find((candidate) => candidate.playerId === playerId);
      if (!character) throw new Error(`No character committed for ${playerId}`);
      const artifact = generatedTownTablePlayerArtifact({ playerId, playerName, characterName: character.name, className: character.className ?? className, hp: character.stats.hp, armorClass: character.stats.armorClass, reasonExceptional: plan.reasonExceptional ?? `${playerName} follows Fenwater rumors because bad water makes honest folk lie.`, goal: plan.goal ?? "find leverage before accepting danger", fear: plan.fear ?? "being trapped without a clean exit" });
      const playerAgent = await this.subAgent(PlayerAgent, playerId);
      playerAgent.syncTownTablePersona({ playerId, ...artifact });
      players.push({ playerId, player: playerName, character, ...artifact });
    }
    const visibleNpcIds = new Set(projection.visibleNpcIds);
    const visibleRumorIds = new Set(projection.visibleRumorIds);
    const table = TownModuleTableStateSchema.parse({
      ...current,
      mode: "running",
      runId: current.runId ?? crypto.randomUUID(),
      townId: adventureModule.manifest.moduleId,
      townName: adventureModule.manifest.title,
      artifactRepo: TOWN_FORGE_ARTIFACT_REPO,
      artifactCommit,
      location: startingLocation.name,
      locationId: projection.startingLocationId,
      sceneId: "fenwater-opening-bar",
      visitedLocationIds: [projection.startingLocationId],
      mentionedLocationIds: [projection.startingLocationId],
      tablePhase: "exploration",
      activeQuestion: `You are at ${startingLocation.name}. Start exhausting this town: pick a concrete lead, person, object, or exit to press first.`,
      affordances: [...fenwaterOpeningAffordances(), ...startingLocation.visibleAffordances, ...town.locations.filter((location) => projection.visibleLocationIds.includes(location.id)).flatMap((location) => location.visibleAffordances.map((affordance) => `${location.name}: ${affordance}`))].slice(0, 18),
      visibleThreads: town.rumors.filter((rumor) => visibleRumorIds.has(rumor.id)).map((rumor) => rumor.text).slice(0, 8),
      activeLeads: fenwaterInitialLeads(),
      clocks: fenwaterInitialClocks(current.difficulty),
      party: players.map(({ playerId, player, character }) => ({ playerId, player, character: character.name, className: character.className, hp: character.stats.hp, armorClass: character.stats.armorClass, inventory: character.inventory.length ? character.inventory : domainStarterGearForClass(character.className), position: startingLocation.name, intent: "arriving", status: "active" as const })),
      playerArtifacts: Object.fromEntries(players.map(({ playerId, soulMd, identityMd }) => [playerId, { soulMd, identityMd }])),
      partyMemory: Object.fromEntries(players.map(({ playerId, soulMd, identityMd }) => [playerId, { knows: [identityMd.split("\n").slice(2, 6).join("; ")], suspects: [], goals: [soulMd.split("Private drive: ")[1]?.split("\n")[0] ?? "find leverage before accepting danger"], losses: [], tactics: ["Coordinate before danger resolves."], relationships: [] }])), 
      events: current.events,
      startedAt: current.startedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    this.setState({ ...this.requireRefereeState(), prototypeTownModuleTable: table });
    this.appendTownTableEvent({ beat: 0, visibility: "public", lane: "world", speaker: "Referee", kind: "frame_moment", text: `${town.name}: ${town.publicProjection.tableSummary} The party starts at ${startingLocation.name}. ${startingLocation.publicDescription}` });
    for (const member of table.party) {
      this.appendTownTableEvent({ beat: 0, visibility: "public", lane: "player", agentId: member.playerId, speaker: member.character, kind: "table_talk", text: `${member.character} arrives at ${startingLocation.name}: ${member.className ?? "adventurer"}, ${member.hp ?? "?"} hp, AC ${member.armorClass ?? "?"}.` });
      const artifact = table.playerArtifacts[member.playerId];
      if (artifact) this.appendTownTableEvent({ beat: 0, visibility: "dev", lane: "artifacts", agentId: member.playerId, speaker: member.character, kind: "frame_moment", text: `${member.character} PlayerAgent identity artifact loaded.`, devText: `${artifact.soulMd}\n\n${artifact.identityMd}` });
    }
    this.appendTownTableEvent({ beat: 0, visibility: "public", lane: "referee", speaker: "Referee", kind: "frame_moment", text: table.activeQuestion });
    return this.getTownModuleTableState();
  }

  async startTownModuleTableRun(): Promise<TownModuleTableState> {
    const current = this.getTownModuleTableState();
    if (current.mode === "running" || current.runningFiberId) return current;
    const fiberId = `town-module-table-run-${current.runId ?? crypto.randomUUID()}`;
    this.setState({ ...this.requireRefereeState(), prototypeTownModuleTable: { ...current, runningFiberId: fiberId, updatedAt: new Date().toISOString() } });
    await this.startFiber("town-module-table-run", async () => {
      await this.executeTownModuleTableRun();
    }, { fiberId, idempotencyKey: fiberId, waitForCompletion: false });
    return this.getTownModuleTableState();
  }

  private async executeTownModuleTableRun(): Promise<void> {
    try {
      const initialized = await this.initializeTownModuleTableFromArtifacts();
      const runId = initialized.runId;
      const runLimits = { ...initialized.runLimits, startedAtMs: Date.now() };
      this.setState({ ...this.requireRefereeState(), prototypeTownModuleTable: { ...initialized, runLimits } });
      const shouldStopForSample = () => tableRunSampleStopReason(townModuleTableToDomainRunState(this.getTownModuleTableState()), Date.now());
      const maxMoments = Math.max(TOWN_MODULE_TABLE_MAX_MOMENTS, runLimits.maxBeats ?? 0);
      for (let i = 0; i < maxMoments; i++) {
        const state = this.getTownModuleTableState();
        if (state.mode !== "running" || state.runId !== runId) return;
        const sampleStop = shouldStopForSample();
        if (sampleStop) break;
        if (state.tablePhase === "combat" && state.combat && state.combat.round >= TOWN_MODULE_TABLE_MAX_COMBAT_ROUNDS) {
          const foe = state.combat.foe;
          this.appendTownTableEvent({ beat: state.beat + 1, visibility: "public", lane: "world", speaker: "Referee", kind: "world_update", text: `${foe} survives the exchange and breaks contact before the table can grind forever. The fight leaves a cost, a trail, and an aftermath choice.`, statePatch: { beat: state.beat + 1, moment: state.moment + 1, tablePhase: "aftermath", activeQuestion: `${foe} is not safely dead. Do you chase, bind wounds and secure evidence, or retreat before the clocks bite again?`, combat: undefined, lastEncounter: { foe, outcome: "escaped", beat: state.beat + 1 } } });
          continue;
        }
        await this.runTownModuleTableMoment();
      }
      if (this.getTownModuleTableState().runId !== runId) return;
      const state = this.getTownModuleTableState();
      const sampleStop = shouldStopForSample();
      const stoppedReason = sampleStop ?? tableRunHardStopReason({ phase: state.tablePhase, maxMoments: TOWN_MODULE_TABLE_MAX_MOMENTS, maxCombatRounds: TOWN_MODULE_TABLE_MAX_COMBAT_ROUNDS, maxAfterCombatMoments: TOWN_MODULE_TABLE_MAX_AFTER_COMBAT_MOMENTS });
      this.setState({ ...this.requireRefereeState(), prototypeTownModuleTable: { ...state, mode: "stopped", runningFiberId: undefined, stoppedReason, updatedAt: new Date().toISOString() } });
      this.appendTownTableEvent({ beat: state.beat, visibility: "public", lane: "commit", speaker: "Referee", kind: "commit", text: `${stoppedReason}. Restart the Worker or clear state to run another slice.`, statePatch: { mode: "stopped", runningFiberId: undefined, stoppedReason } });
    } catch (error) {
      this.emitTownTableError(error);
    }
  }

  private inferTownTablePosition(text: string, fallback: string): string {
    const lower = text.toLowerCase();
    const expandedLocation = fenwaterLocationTitle(inferFenwaterLocationId(text));
    if (expandedLocation) return expandedLocation;
    if (/north ditch|ditch door|shell-token|shell token/.test(lower)) return "North Ditch door";
    if (/sluice|black water|water|ladder/.test(lower)) return "sluice mouth";
    if (/bar|mort|ledger|drink|tap/.test(lower)) return "Mort's bar";
    if (/beam|hearth|knife-nick|nicks|harp/.test(lower)) return "hearth beam";
    if (/south-cut|south cut|drainage|corvin/.test(lower)) return "south-cut lead";
    return fallback;
  }

  private validateTownTableLocality(state: TownModuleTableState): TownModuleTableState {
    const recentLocks = state.events.filter((event) => event.lane === "player" && event.kind === "lock_action").slice(0, state.party.length);
    if (!recentLocks.length) return state;
    let party = state.party;
    for (const event of recentLocks) {
      const member = party.find((candidate) => candidate.playerId === event.agentId || candidate.character === event.speaker);
      if (!member) continue;
      const text = event.text.toLowerCase();
      const position = member.position ?? state.location;
      const needs = requiredDomainLocalityForAction(text);
      if (!needs || position === needs) continue;
      const revisedIntent = `move/setup toward ${needs}; original action needs position first`;
      party = party.map((candidate) => candidate.playerId === member.playerId ? { ...candidate, position: needs, intent: revisedIntent } : candidate);
      this.appendTownTableEvent({ beat: state.beat, visibility: "public", lane: "rules", speaker: "Referee", kind: "procedure_check", text: `Position matters: ${member.character} cannot fully resolve that action from ${position}. This beat moves/setup toward ${needs}; the effect is not instant.` });
    }
    if (party === state.party) return state;
    const current = this.getTownModuleTableState();
    const next = TownModuleTableStateSchema.parse({ ...current, party, updatedAt: new Date().toISOString() });
    this.setState({ ...this.requireRefereeState(), prototypeTownModuleTable: next });
    return next;
  }

  private updateTownTablePartyIntent(event: TownModuleTableEvent): void {
    if (event.lane !== "player" || !event.agentId) return;
    const current = this.getTownModuleTableState();
    const inferredLocationId = inferFenwaterLocationId(event.text);
    const inferredLocation = fenwaterLocationTitle(inferredLocationId);
    const isMovementLock = event.kind === "lock_action" && /\b(go|head|move|travel|follow|chase|enter|leave|exit|withdraw|sprint|run|cross|descend|climb|crawl|push on|press on)\b/i.test(event.text);
    const party = current.party.map((member) => member.playerId === event.agentId ? {
      ...member,
      position: isMovementLock && inferredLocation ? inferredLocation : this.inferTownTablePosition(event.text, member.position ?? current.location),
      intent: event.kind === "lock_action" ? compactText(event.text, 140) : member.intent === "arriving" ? compactText(event.text, 100) : member.intent
    } : member);
    const mentionedLocationIds = inferredLocationId ? takeUniqueStrings([inferredLocationId, ...current.mentionedLocationIds], 48) : current.mentionedLocationIds;
    const visitedLocationIds = inferredLocationId && isMovementLock ? takeUniqueStrings([inferredLocationId, ...current.visitedLocationIds], 32) : current.visitedLocationIds;
    this.setState({ ...this.requireRefereeState(), prototypeTownModuleTable: { ...current, party, mentionedLocationIds, ...(inferredLocationId && isMovementLock && inferredLocation ? { locationId: inferredLocationId, location: inferredLocation, visitedLocationIds, transitionIntentLocationId: inferredLocationId } : { visitedLocationIds }), updatedAt: new Date().toISOString() } });
  }

  private townTableProcedureFor(state: TownModuleTableState): { procedure: string; check: string } | undefined {
    const recent = state.events.slice(0, 10).map((event) => `${event.kind}:${event.text}`).join(" | ").toLowerCase();
    if (/track|trail|prints|follow/.test(recent)) return { procedure: "Following a trail costs time before water or witnesses erase it.", check: "Secret trail/detail check rolled for what remains readable." };
    if (/door|gate|latch|force|block|shoulder/.test(recent)) return { procedure: "Forcing or blocking an exit creates noise and advances local pressure.", check: "Secret stuck-door/reaction check rolled behind the screen." };
    if (/mort|cutter|press|question|demand|bribe|threat/.test(recent)) return { procedure: "Questioning a local risks a reaction shift; pressure can open clues or close mouths.", check: "Secret reaction/morale check rolled for the NPC's nerve." };
    if (/examine|search|count|inspect|trace|read|study|beam|ledger|token|harp/.test(recent)) return { procedure: "Careful examination costs table time. The Referee resolves visible detail now.", check: "Secret search/detail check rolled for hidden marks." };
    return undefined;
  }

  private emitTownTableClockConsequence(clock: { name: string; value: number; max: number; note?: string | undefined }, previousValue: number, beat: number): void {
    const crossedHalf = previousValue < 3 && clock.value >= 3;
    const crossedMax = previousValue < clock.max && clock.value >= clock.max;
    const text = clock.name === "Mort panic" && crossedMax
      ? "Mort breaks now: he must bolt, faint, call for help, or blurt one dangerous truth before he can recover. The Referee also checks whether this becomes an encounter."
      : clock.name === "Mort panic" && crossedHalf
        ? "Mort is visibly cracking: stammers, sweating hands, eyes measuring the nearest exit."
        : clock.name === "North Ditch water" && crossedMax
          ? "North Ditch floods this route; following the trail now costs a hard choice or another turn. The Referee also checks whether something in the water forces an encounter."
          : clock.name === "North Ditch water" && crossedHalf
            ? "North Ditch water reaches the prints; the next delay will start washing the trail out."
            : clock.name === "Grain-buyer warned" && crossedMax
              ? "The grain-buyer is fully warned: a lead relocates, a price changes, or a trap gets set."
              : clock.name === "Grain-buyer warned" && crossedHalf
                ? "Word is moving: someone slips out or a useful witness starts getting nervous."
                : undefined;
    if (text) this.appendTownTableEvent({ beat, visibility: "public", lane: "world", speaker: "Referee", kind: "world_update", text });
  }

  private maybeStartTownTableEncounter(clock: { name: string; value: number; max: number }, previousValue: number, beat: number): void {
    if (previousValue >= clock.max || clock.value < clock.max) return;
    const current = this.getTownModuleTableState();
    const encounterThreshold = Math.min(5, 2 + Math.floor((current.difficulty - 1) / 3));
    const roll = secureRandomInt(6);
    this.appendTownTableEvent({ beat, visibility: "public", lane: "dice", speaker: "Referee", kind: "dice_roll", text: `Encounter escalation check: ${roll} on d6. On 1-${encounterThreshold}, the table enters encounter/combat procedure.`, devText: "OSE source anchors: old-school-essentials-classic-fantasy-rules-tome-3751c5149a24:s1298:n0; old-school-essentials-basic-rules-v1-4-a4d9608ea98b:s259:n0." });
    if (roll > encounterThreshold) return;
    const water = clock.name === "North Ditch water";
    const foe = water ? "waterlogged debt-thing" : "cornered Fenwater cutter";
    const foeMaxHp = (water ? 12 : 8) + Math.max(0, current.difficulty - 1);
    const trigger = water ? "North Ditch flood hit 6/6 while the party handled keys, tokens, and black water." : "Mort panic hit 6/6 while pressure and witnesses crowded the bar.";
    const objective = water
      ? { kind: "hold_door" as const, text: "Hold the door/flood line for 2 rounds or extract the wounded before the water owns the route.", progress: 0, target: 2 }
      : current.clocks.some((clock) => clock.name === "Grain-buyer warned" && clock.value >= 3)
        ? { kind: "stop_messenger" as const, text: "Stop the messenger/cutter escaping with the warning before round 2 ends.", progress: 0, target: 1 }
        : { kind: "grab_object" as const, text: "Grab the ledger/token before the next water or panic tick destroys the lead.", progress: 0, target: 1 };
    const next = TownModuleTableStateSchema.parse({ ...current, tablePhase: "combat", combat: { round: 0, foe, foeHp: foeMaxHp, foeMaxHp, foeArmorClass: water ? 13 : 12, trigger, objective }, activeQuestion: `Encounter! ${foe} is in reach. Objective: ${objective.text} Coordinate tactics: who attacks, who holds position, who protects the weak, who grabs the crucial object, and who withdraws?` });
    this.setState({ ...this.requireRefereeState(), prototypeTownModuleTable: next });
    this.appendTownTableEvent({ beat, visibility: "public", lane: "world", speaker: "Referee", kind: "encounter_start", text: `Oh shit: ${foe} forces the table into encounter procedure. ${trigger} Objective: ${objective.text}` });
    this.appendTownTableEvent({ beat, visibility: "public", lane: "rules", speaker: "OSE", kind: "procedure_check", text: "Encounter procedure starts: check surprise/position, then side initiative and actions. Public stream shows safe summaries only." });
  }

  private async runTownModuleTableCombatRound(): Promise<void> {
    const state = this.getTownModuleTableState();
    const combat = state.combat;
    if (!combat) return;
    const round = combat.round + 1;
    this.appendTownTableEvent({ beat: state.beat, visibility: "public", lane: "referee", speaker: "Referee", kind: "ask_referee", text: `Combat round ${round}: ${combat.objective ? `objective: ${combat.objective.text} ` : ""}Who attacks ${combat.foe}, who blocks escape or flood, who protects wounded allies, and who grabs the crucial object?` });
    const tacticResults = await Promise.all(state.party.filter((candidate) => (candidate.status ?? "active") === "active" && (candidate.hp ?? 1) > 0).map(async (member) => {
      const memory = state.partyMemory[member.playerId];
      let text: string;
      try {
        text = await runPrototypeModelText(this.env, [
        "Write this PlayerAgent's combat tactic as one short line. Do not return JSON.",
        "Start with one label exactly: ATTACK:, DEFEND:, GRAB:, AID:, WITHDRAW:, or CAST:.",
        "Use the identity artifact and compact memory as this agent's SOUL/IDENTITY/brain. Coordinate with the party. Be concrete and dangerous. Do not invent hidden facts.",
        `Identity artifact: ${state.playerArtifacts[member.playerId] ? `${state.playerArtifacts[member.playerId]?.soulMd}\n${state.playerArtifacts[member.playerId]?.identityMd}` : "none"}.`,
        `Character: ${member.character}; class: ${member.className ?? "adventurer"}; hp: ${member.hp ?? "?"}; AC: ${member.armorClass ?? 10}; position: ${member.position ?? state.location}.`,
        `Foe: ${combat.foe}; foe HP ${combat.foeHp}/${combat.foeMaxHp ?? combat.foeHp}; foe AC ${combat.foeArmorClass}; trigger: ${combat.trigger}.`,
        `Combat objective: ${combat.objective ? `${combat.objective.text} Progress ${combat.objective.progress}/${combat.objective.target}.` : "survive and secure the lead"}.`,
        `Party: ${state.party.map((p) => `${p.character} hp ${p.hp ?? "?"} @ ${p.position ?? state.location}`).join(" | ")}.`,
        `Own memory: ${memory ? [...memory.knows, ...memory.losses, ...memory.tactics].slice(0, 8).join(" | ") : "none yet"}.`,
        `Recent combat/table: ${state.events.slice(0, 10).map((event) => `${event.speaker}:${event.kind}:${event.text}`).join(" || ")}.`
        ].join("\n"), 260);
      } catch (error) {
        this.appendTownTableEvent({ beat: state.beat, visibility: "public", lane: "error", speaker: member.character, kind: "error", text: `${member.character}'s combat tactic failed honestly; they defend in place this round.`, devText: String(error instanceof Error ? error.message : error) });
        text = `DEFEND: ${member.character} freezes and defends in place.`;
      }
      return { member, text };
    }));
    for (const { member, text } of tacticResults) {
      const parsed = parseLabeledActionProposal(text, ["ATTACK", "DEFEND", "GRAB", "AID", "WITHDRAW", "CAST", "LOCK"]);
      const tactic = compactText(parsed.body, 360);
      this.appendTownTableEvent({ beat: state.beat, visibility: "public", lane: "player", agentId: member.playerId as PlayerId, speaker: member.character, kind: "lock_action", text: `${parsed.label ? `${parsed.label.toLowerCase()}: ` : ""}${tactic}` });
    }
    const tacticalState = this.getTownModuleTableState();
    const objectiveResult = advanceDomainCombatObjective(combat.objective, tacticalState.events.slice(0, Math.max(8, tacticalState.party.length + 4)).map((event) => event.text).join(" "));
    const objectiveProgress = objectiveResult.objective?.progress ?? combat.objective?.progress ?? 0;
    const objectiveComplete = objectiveResult.completed;
    if (objectiveResult.progressText) this.appendTownTableEvent({ beat: state.beat, visibility: "public", lane: "world", speaker: "Referee", kind: "combat_round", text: `Objective progress: ${objectiveResult.progressText}.` });
    const partyInit = secureRandomInt(6);
    const foeInit = secureRandomInt(6);
    this.appendTownTableEvent({ beat: state.beat, visibility: "public", lane: "dice", speaker: "Referee", kind: "dice_roll", text: `Combat round ${round} initiative: party ${partyInit}, ${combat.foe} ${foeInit}.` });
    let foeHp = combat.foeHp;
    const party = tacticalState.party.map((member) => ({ ...member }));
    const recentTactics = tacticalState.events.slice(0, Math.max(8, party.length + 4));
    const attackers = party.filter((member) => (member.status ?? "active") === "active" && (member.hp ?? 1) > 0 && recentTactics.some((event) => event.speaker === member.character && /attack|stab|strike|shoot|hit|rush|cut|knife|club|sling/i.test(event.text))).slice(0, 3);
    const activeAttackers = attackers.length ? attackers : party.filter((member) => (member.status ?? "active") === "active" && (member.hp ?? 1) > 0).slice(0, 2);
    for (const member of activeAttackers) {
      const attack = secureRandomInt(20);
      const hit = attack >= combat.foeArmorClass;
      const damage = hit ? secureRandomInt(6) : 0;
      foeHp = Math.max(0, foeHp - damage);
      this.appendTownTableEvent({ beat: state.beat, visibility: "public", lane: "dice", speaker: member.character, kind: "combat_round", text: `${member.character} attacks ${combat.foe}: ${attack} vs AC ${combat.foeArmorClass}${hit ? `, hit for ${damage}` : ", miss"}.` });
      if (foeHp <= 0) break;
    }
    if (foeHp > 0) {
      const vulnerable = party.filter((member) => (member.status ?? "active") === "active" && (member.hp ?? 1) > 0 && !recentTactics.some((event) => event.speaker === member.character && /defend|shield|hold|guard|protect|block|withdraw/i.test(event.text)));
      const targetPool = vulnerable.length ? vulnerable : party.filter((member) => (member.status ?? "active") === "active" && (member.hp ?? 1) > 0);
      const targetMember = targetPool[secureRandomInt(Math.max(targetPool.length, 1)) - 1];
      const targetIndex = party.findIndex((member) => member.playerId === targetMember?.playerId);
      const target = party[targetIndex];
      if (target) {
        const attack = secureRandomInt(20);
        const ac = target.armorClass ?? 10;
        const hit = attack >= ac;
        const damage = hit ? secureRandomInt(4) : 0;
        party[targetIndex] = { ...target, hp: Math.max(0, (target.hp ?? 1) - damage) };
        this.appendTownTableEvent({ beat: state.beat, visibility: "public", lane: "dice", speaker: "Referee", kind: "combat_round", text: `${combat.foe} attacks ${target.character}: ${attack} vs AC ${ac}${hit ? `, ${damage} damage` : ", miss"}.` });
      }
    }
    const maxedClock = tacticalState.clocks.find((clock) => clock.value >= clock.max);
    if (foeHp > 0 && maxedClock) {
      const exposed = party.find((member) => (member.status ?? "active") === "active" && (member.hp ?? 1) > 0 && !recentTactics.some((event) => event.speaker === member.character && /hold|brace|door|water|flood|withdraw/i.test(event.text)));
      if (exposed) {
        const idx = party.findIndex((member) => member.playerId === exposed.playerId);
        party[idx] = { ...exposed, hp: Math.max(0, (exposed.hp ?? 1) - 1) };
        this.appendTownTableEvent({ beat: state.beat, visibility: "public", lane: "clock", speaker: "Referee", kind: "combat_round", text: `${maxedClock.name} acts during combat: ${exposed.character} loses 1 hp or position to the pressure because nobody fully contained it.` });
      }
    }
    const ended = foeHp <= 0 || objectiveComplete;
    const outcome = foeHp <= 0 ? "defeated" as const : objectiveComplete ? "avoided" as const : undefined;
    const nextPatch = { beat: state.beat + 1, moment: state.moment + 1, tablePhase: ended ? "aftermath" : "combat", activeQuestion: ended ? (foeHp <= 0 ? `${combat.foe} is down. What do you secure first? Bind, search, flee, recover gear, or chase the lead?` : `Objective secured: ${combat.objective?.text} What do you secure next: evidence, wounded ally, or exit?`) : `Combat round ${round + 1}: coordinate again—attack, defend, grab the object, aid the wounded, cast, or withdraw?`, party, combat: ended ? undefined : { ...combat, round, foeHp, ...(combat.objective ? { objective: { ...combat.objective, progress: objectiveProgress } } : {}) }, ...(ended && outcome ? { lastEncounter: { foe: combat.foe, outcome, beat: state.beat + 1 } } : {}), modelCallsUsed: tacticalState.modelCallsUsed + party.length };
    this.appendTownTableEvent({ beat: state.beat + 1, visibility: "public", lane: "commit", speaker: "Referee", kind: "commit", text: ended ? (foeHp <= 0 ? `${combat.foe} drops. Aftermath begins.` : `Combat objective complete. Aftermath begins.`) : `Combat round ${round} committed. ${combat.foe} has ${foeHp} hp left.`, statePatch: nextPatch });
  }

  private townTableQuestionKey(text: string): string {
    return compactText(text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\b(a|b|c|d|or|the|your|you|now|first|commit|lock|choose|finish)\b/g, " ").replace(/\s+/g, " ").trim(), 80);
  }

  private repeatedTownTableStall(state: TownModuleTableState, nextQuestion: string): { questionKey: string; count: number; stalled: boolean } {
    const questionKey = this.townTableQuestionKey(nextQuestion);
    const recent = state.events.slice(0, Math.max(10, state.party.length * 3));
    const passive = recent.filter((event) => event.lane === "player" && /hold|wait|watch|signal|stay|flat|pass|shadow|ready|eyes|feet|not yet/i.test(event.text)).length;
    const locked = recent.filter((event) => event.kind === "lock_action" && !/hold|wait|watch|signal|stay|flat|pass|ready|not yet/i.test(event.text)).length;
    const count = state.stall?.questionKey === questionKey ? state.stall.count + 1 : 1;
    const dangerOnline = state.beat >= 3 || state.clocks.some((clock) => clock.value >= 3) || state.tablePhase !== "exploration";
    return { questionKey, count, stalled: dangerOnline && (count >= 3 || (passive >= state.party.length && locked === 0)) };
  }

  private townTableNamedClockMove(state: TownModuleTableState, reason: string): { text: string; nextQuestion: string } {
    const maxed = state.clocks.filter((clock) => clock.value >= clock.max).map((clock) => clock.name);
    if (maxed.includes("Grain-buyer warned")) return {
      text: "The grain-buyer's runner slips out with the room's description and the shell-token tally. Prices shift, a witness relocates, and the party must choose whether to chase word or secure what remains.",
      nextQuestion: "A runner is moving now: chase them, secure Mort and the ledger, or cut losses and retreat?"
    };
    if (maxed.includes("North Ditch water")) return {
      text: "North Ditch water takes the first move: black water crawls over the prints and starts lifting loose paper, ash, and dropped tokens toward the drain.",
      nextQuestion: "Water is taking the evidence: hold the door, retreat to high ground, or dive for one clue?"
    };
    if (maxed.includes("Mort panic")) return {
      text: "Mort acts first: he breaks from the bar toward the nearest exit, one hand dragging the ledger cup and one truth spilling loose before he can swallow it.",
      nextQuestion: "Mort is moving now: block him, let him run and track him, or force the truth before he reaches the door?"
    };
    return {
      text: `The table stalls on ${compactText(reason, 120)}; the Referee treats holding position as the committed action and the room moves first.`,
      nextQuestion: "The room moves first: secure the clue, block the exit, or fall back?"
    };
  }

  private emitTownTableStallConsequence(state: TownModuleTableState, reason: string): TownModuleTableState {
    const exposed = state.party.find((member) => /hold|wait|watch|signal|stay|flat|pass|ready|not yet/i.test(member.intent ?? "")) ?? state.party[0];
    const party = state.party.map((member) => exposed && member.playerId === exposed.playerId ? { ...member, intent: "hesitation cost position" } : member);
    const move = this.townTableNamedClockMove(state, reason);
    const text = `${move.text} ${exposed?.character ?? "Someone"} loses the clean first move.`;
    this.appendTownTableEvent({ beat: state.beat, visibility: "public", lane: "world", speaker: "Referee", kind: "world_update", text });
    const nextQuestion = move.nextQuestion;
    const nextPatch = { beat: state.beat + 1, moment: state.moment + 1, activeQuestion: nextQuestion, party, stall: { questionKey: this.townTableQuestionKey(nextQuestion), count: 0 } };
    this.appendTownTableEvent({ beat: state.beat + 1, visibility: "public", lane: "commit", speaker: "Referee", kind: "commit", text: `Beat ${state.beat + 1} committed. ${nextQuestion}`, statePatch: nextPatch });
    return this.getTownModuleTableState();
  }

  private emitTownTableProcedureEvents(state: TownModuleTableState): void {
    const procedure = this.townTableProcedureFor(state);
    if (procedure) {
      this.appendTownTableEvent({ beat: state.beat, visibility: "public", lane: "rules", speaker: "OSE", kind: "procedure_check", text: procedure.procedure });
      this.appendTownTableEvent({ beat: state.beat, visibility: "public", lane: "dice", speaker: "Referee", kind: "dice_roll", text: procedure.check });
    }
    const recent = state.events.slice(0, 10).map((event) => event.text).join(" ").toLowerCase();
    const tickableClocks = state.clocks.filter((clock) => clock.value < clock.max);
    const preferredClock = tickableClocks.find((clock) => recent.includes("mort") && clock.name === "Mort panic")
      ?? tickableClocks.find((clock) => /water|sluice|ditch|trail|prints/.test(recent) && clock.name === "North Ditch water")
      ?? tickableClocks.find((clock) => /split|noise|warn|door|bolt|run|watcher/.test(recent) && clock.name === "Grain-buyer warned")
      ?? tickableClocks[secureRandomInt(Math.max(tickableClocks.length, 1)) - 1]
      ?? tickableClocks[0];
    if (preferredClock) {
      const nextClock = { ...preferredClock, value: Math.min(preferredClock.max, preferredClock.value + 1) };
      const clocks = state.clocks.map((candidate) => candidate.name === preferredClock.name ? nextClock : candidate);
      const current = this.getTownModuleTableState();
      this.setState({ ...this.requireRefereeState(), prototypeTownModuleTable: { ...current, clocks, updatedAt: new Date().toISOString() } });
      this.appendTownTableEvent({ beat: state.beat, visibility: "public", lane: "clock", speaker: "Referee", kind: "clock_tick", text: `${nextClock.name}: ${nextClock.value}/${nextClock.max}${nextClock.note ? ` — ${nextClock.note}` : ""}` });
      this.emitTownTableClockConsequence(nextClock, preferredClock.value, state.beat);
      this.maybeStartTownTableEncounter(nextClock, preferredClock.value, state.beat);
    }
  }

  private townTableRefereeImprovMoves(state: TownModuleTableState): string[] {
    const moves = [
      "reveal cost: show what a clue will cost before they take it",
      "soft move to hard move: repeat a warning once, then make the actor/object/route move",
      "position squeeze: make one character choose door, ally, or clue",
      "NPC interrupt: Mort, a cutter, or a runner acts in public",
      "clue degrades: water, ash, panic, or witnesses erase one readable detail",
      "split pressure: one path stays safe only if someone abandons another goal"
    ];
    if (state.difficulty >= 3) moves.push("clock jump: advance the most relevant visible clock by 2 when the party ignores it");
    if (state.difficulty >= 5) moves.push("resource tax: light, footing, dropped gear, or 1 hp is at risk before more information");
    if (state.difficulty >= 7) moves.push("cut off escape: a safe exit becomes costly unless a player holds it now");
    return moves;
  }

  private townTablePartyTacticSummary(state: TownModuleTableState): string | undefined {
    const recentPlayers = state.events.filter((event) => event.lane === "player").slice(0, Math.max(8, state.party.length * 2));
    if (recentPlayers.length < 2) return undefined;
    const parts = state.party.map((member) => {
      const event = recentPlayers.find((candidate) => candidate.agentId === member.playerId || candidate.speaker === member.character);
      if (!event) return undefined;
      const verb = /attack|strike|stab|shoot|hit/i.test(event.text) ? "attacks"
        : /grab|take|snatch|ledger|token|object/i.test(event.text) ? "grabs evidence"
          : /guard|hold|block|brace|defend|door/i.test(event.text) ? "holds position"
            : /withdraw|retreat|fall back|exit/i.test(event.text) ? "keeps exit"
              : /aid|help|cover|protect/i.test(event.text) ? "covers ally"
                : /read|count|inspect|examine|search|trace/i.test(event.text) ? "reads clues"
                  : "presses the lead";
      return `${member.character} ${verb}`;
    }).filter(Boolean).slice(0, 4);
    if (parts.length < 2) return undefined;
    const riskClock = state.clocks.find((clock) => clock.value >= 3) ?? state.clocks[0];
    return `Party tactic: ${parts.join("; ")}. Risk: ${riskClock ? `${riskClock.name} ${riskClock.value}/${riskClock.max}` : "the room moves if they wait"}.`;
  }

  private async runTownModuleTableMoment(): Promise<void> {
    const before = this.getTownModuleTableState();
    if (before.tablePhase === "combat" && before.combat) {
      await this.runTownModuleTableCombatRound();
      return;
    }
    const positions = before.party.map((member) => `${member.character}: ${member.position ?? before.location}${member.intent ? ` (${member.intent})` : ""}${member.status && member.status !== "active" ? ` [${member.status}]` : ""}`).join(" | ");
    this.appendTownTableEvent({ beat: before.beat, visibility: "public", lane: "referee", speaker: "Referee", kind: "referee_thought", text: `Watching: ${before.activeQuestion} Positions: ${positions}` });
    const activeParty = before.party.filter((member) => (member.status ?? "active") === "active" && (member.hp ?? 1) > 0);
    if (activeParty.length === 0) {
      this.appendTownTableEvent({ beat: before.beat + 1, visibility: "public", lane: "commit", speaker: "Referee", kind: "commit", text: "No active party members can act. The Referee shifts to capture, rescue, retreat, or TPK aftermath instead of asking downed characters for normal actions.", statePatch: { beat: before.beat + 1, moment: before.moment + 1, mode: "stopped", tablePhase: "aftermath", stoppedReason: "no active party members remain" } });
      return;
    }
    const microResults = await Promise.all(activeParty.map(async (member) => {
      const playerId = TOWN_MODULE_TABLE_PLAYER_IDS.find((id) => id === member.playerId) ?? "player-a";
      let text: string;
      try {
        text = await runPrototypeModelText(this.env, [
        "Write this PlayerAgent's next micro-event as one short line of table play.",
        "Do not return JSON. Start with one of these labels exactly: THOUGHT:, TALK:, FLOAT:, ASK:, or LOCK:.",
        "Use the identity artifact and compact memory as this agent's SOUL/IDENTITY/brain. Thoughts/feelings are audience-visible. Use LOCK when committing to concrete action. Do not reveal hidden facts.",
        "Gameplay bias: prefer a concrete role move over more analysis. Fighters block/protect/force; thieves grab/scout/test; clerics steady/turn/drag wounded; magic-users spend weird leverage carefully. If danger is active, choose a costly action instead of asking another soft question.",
        `Identity artifact: ${before.playerArtifacts[playerId] ? `${before.playerArtifacts[playerId]?.soulMd}\n${before.playerArtifacts[playerId]?.identityMd}` : "none"}.`,
        `Player: ${member.player}; character: ${member.character}; class: ${member.className ?? "adventurer"}.`,
        `Current location: ${before.location}. Active question: ${before.activeQuestion}.`,
        `Affordances: ${before.affordances.join(" | ")}.`,
        `Active leads: ${before.activeLeads.join(" | ")}.`,
        `Difficulty: ${before.difficulty}/8. Higher difficulty means less safe dithering, harder encounters, and faster clock consequences.`,
        `Clocks: ${before.clocks.map((clock) => `${clock.name} ${clock.value}/${clock.max}`).join(" | ")}.`,
        `Party positions: ${before.party.map((p) => `${p.character}:${p.position ?? before.location}`).join(" | ")}.`,
        `Own memory: ${before.partyMemory[playerId] ? [...before.partyMemory[playerId].knows, ...before.partyMemory[playerId].goals, ...before.partyMemory[playerId].losses, ...before.partyMemory[playerId].tactics].slice(0, 8).join(" | ") : "none yet"}.`,
        `Party tactical memory: ${before.party.map((p) => `${p.character}: ${(before.partyMemory[p.playerId]?.tactics ?? []).slice(0, 2).join("; ")}`).join(" | ")}.`,
        `Recent events: ${before.events.slice(0, 8).map((event) => `${event.speaker}:${event.kind}:${event.text}`).join(" || ")}.`
        ].join("\n"), 260);
      } catch (error) {
        this.appendTownTableEvent({ beat: before.beat, visibility: "public", lane: "error", speaker: member.character, kind: "error", text: `${member.character}'s thought/action generation failed honestly; they hesitate and hold position.`, devText: String(error instanceof Error ? error.message : error) });
        text = `THOUGHT: ${member.character} hesitates, holds position, and watches for the next clear opening.`;
      }
      return { member, playerId, text };
    }));
    for (const { member, playerId, text } of microResults) {
      const parsed = parseLabeledActionProposal(text, ["THOUGHT", "TALK", "FLOAT", "ASK", "LOCK"]);
      const kind = parsed.label === "TALK" ? "table_talk" : parsed.label === "FLOAT" ? "float_action" : parsed.label === "ASK" ? "ask_referee" : parsed.label === "LOCK" ? "lock_action" : "thought_bubble";
      const playerEvent = this.appendTownTableEvent({ beat: before.beat, lane: "player", agentId: playerId, speaker: member.character, visibility: "public", kind, text: compactText(parsed.body, 520) });
      this.updateTownTablePartyIntent(playerEvent);
    }
    const afterMicro = this.getTownModuleTableState();
    this.setState({ ...this.requireRefereeState(), prototypeTownModuleTable: { ...afterMicro, modelCallsUsed: afterMicro.modelCallsUsed + microResults.length } });
    const afterPlayers = this.validateTownTableLocality(this.getTownModuleTableState());
    const hasLockedAction = afterPlayers.events.slice(0, Math.max(8, afterPlayers.party.length + 2)).some((event) => event.kind === "lock_action");
    const readiness = hasLockedAction ? { status: "ready_to_resolve", reason: "At least one player locked a concrete action." } : await runPrototypeModelJson(this.env, [
      "Return JSON for TableMomentReadiness: {status, reason, prompt?, targetAgentId?, lockedActions?, procedure?}.",
      "status must be keep_accumulating, needs_commitment, or ready_to_resolve.",
      "You are the Referee deciding whether this town table moment is ready to resolve. Prefer needs_commitment if nobody has locked a concrete action. Keep prompt/reason public-safe and very short: one question plus at most 3 options. Do not mention hidden facts, secrets, private graph, or unverified model mistakes.",
      `Active question: ${afterPlayers.activeQuestion}.`,
      `Recent events: ${afterPlayers.events.slice(0, 12).map((event) => `${event.speaker}:${event.kind}:${event.text}`).join(" || ")}.`
    ].join("\n"), 500) as { status?: string; reason?: string; prompt?: string; lockedActions?: string[]; procedure?: string };
    if (readiness.status !== "ready_to_resolve") {
      const prompt = sanitizeTownTablePublicText(readiness.prompt ?? readiness.reason, "Who leads? Press Mort, inspect the beam, or follow the sluice?", 180);
      this.appendTownTableEvent({ beat: afterPlayers.beat, visibility: "public", lane: "referee", speaker: "Referee", kind: readiness.status === "needs_commitment" ? "ask_referee" : "referee_thought", text: prompt });
      this.emitTownTableProcedureEvents(afterPlayers);
      const latestState = this.getTownModuleTableState();
      const stall = this.repeatedTownTableStall(latestState, prompt);
      if (stall.stalled) {
        this.emitTownTableStallConsequence(latestState, prompt);
        return;
      }
      this.appendTownTableEvent({ beat: afterPlayers.beat + 1, visibility: "public", lane: "commit", speaker: "Referee", kind: "commit", text: `Beat ${afterPlayers.beat + 1} committed. ${prompt}`, statePatch: { beat: afterPlayers.beat + 1, moment: afterPlayers.moment + 1, activeQuestion: prompt, clocks: latestState.clocks, party: latestState.party, stall: { questionKey: stall.questionKey, count: stall.count }, modelCallsUsed: latestState.modelCallsUsed + 1 } });
      return;
    }
    const beforeRuling = this.getTownModuleTableState();
    const tacticSummary = this.townTablePartyTacticSummary(beforeRuling);
    if (tacticSummary) this.appendTownTableEvent({ beat: beforeRuling.beat, visibility: "public", lane: "referee", speaker: "Referee", kind: "referee_thought", text: tacticSummary });
    let rulingText: string;
    try {
      rulingText = await runPrototypeModelText(this.env, [
      "Resolve the accumulated table moment as exactly three short lines with these labels:",
      "THOUGHT: audience-safe Referee thought",
      "RULING: table-facing consequence with clear intent, risk, and changed state",
      "NEXT: one short hard choice with 2-3 mutually exclusive options",
      "Gameplay doctrine: run a dangerous OSE-ish table. Name the actor/object/route that moves. Make position matter. If they hesitate, clocks bite. Do not repeat the same soft A/B/C. Offer hard choices like save ledger OR stop Mort, hold door OR help an ally, chase lead OR keep exit open.",
      "Use refereeMemory and partyMemory as the RefereeAgent's compact brain. Public-safe only; do not reveal hidden graph facts or private player memory unless surfaced by play. Do not invent symbolic escalation unless justified by clock threshold, room/location entry, trap, or encounter check.",
      `Location: ${beforeRuling.location}. Active question: ${beforeRuling.activeQuestion}.`,
      `Party tactic summary: ${tacticSummary ?? "none"}.`,
      `Recent events: ${beforeRuling.events.slice(0, 14).map((event) => `${event.speaker}:${event.kind}:${event.text}`).join(" || ")}.`,
      `Current affordances: ${beforeRuling.affordances.join(" | ")}.`,
      `Active leads: ${beforeRuling.activeLeads.join(" | ")}.`,
      `Difficulty: ${beforeRuling.difficulty}/8. Increase danger with named Referee moves, not hidden cheating.`,
      `Allowed Referee improv moves: ${this.townTableRefereeImprovMoves(beforeRuling).join(" | ")}. Pick at most one per ruling and name its visible effect in the RULING line.`,
      `Clocks: ${beforeRuling.clocks.map((clock) => `${clock.name} ${clock.value}/${clock.max}`).join(" | ")}.`,
      `Party positions: ${beforeRuling.party.map((p) => `${p.character}:${p.position ?? beforeRuling.location}`).join(" | ")}.`,
      `Referee memory: revealed=${beforeRuling.refereeMemory.revealedFacts.slice(0, 6).join(" | ")}; unresolved=${beforeRuling.refereeMemory.unresolvedThreads.slice(0, 6).join(" | ")}; npc=${beforeRuling.refereeMemory.npcState.slice(0, 4).join(" | ")}.`,
      `Player memories: ${beforeRuling.party.map((p) => `${p.character}: ${(beforeRuling.partyMemory[p.playerId]?.knows ?? []).slice(0, 2).join("; ")} ${(beforeRuling.partyMemory[p.playerId]?.losses ?? []).slice(0, 1).join("; ")}`).join(" | ")}.`,
      `Visible threads: ${beforeRuling.visibleThreads.join(" | ")}.`
      ].join("\n"), 650);
    } catch (error) {
      this.appendTownTableEvent({ beat: beforeRuling.beat, visibility: "public", lane: "error", speaker: "Referee", kind: "error", text: "Referee ruling generation failed honestly; using a bounded fallback prompt instead of faking a full ruling.", devText: String(error instanceof Error ? error.message : error) });
      rulingText = "THOUGHT: The table holds while the Referee recovers from a model failure.\nRULING: No new fictional fact is introduced; positions and clocks remain visible.\nNEXT: Who commits first—press Mort, secure the exit, inspect the object, or fall back?";
    }
    const parsedRuling = parseRefereeRulingText(rulingText);
    this.appendTownTableEvent({ beat: beforeRuling.beat, visibility: "public", lane: "referee", speaker: "Referee", kind: "referee_thought", text: sanitizeTownTablePublicText(parsedRuling.thought, "The Referee weighs the declared actions and keeps the pressure at the table.", 260) });
    this.appendTownTableEvent({ beat: beforeRuling.beat, visibility: "public", lane: "world", speaker: "Referee", kind: "ruling", text: sanitizeTownTablePublicText(parsedRuling.ruling, "The moment holds until someone acts clearly.", 520) });
    this.emitTownTableProcedureEvents(beforeRuling);
    const latestState = this.getTownModuleTableState();
    const sanitizedNextQuestion = sanitizeTownTablePublicText(parsedRuling.next, "Who leads? Press Mort, inspect the beam, or follow the sluice?", 180);
    const stall = this.repeatedTownTableStall(latestState, sanitizedNextQuestion);
    if (stall.stalled) {
      this.emitTownTableStallConsequence(latestState, sanitizedNextQuestion);
      return;
    }
    const nextPatch = {
      beat: beforeRuling.beat + 1,
      moment: beforeRuling.moment + 1,
      activeQuestion: sanitizedNextQuestion,
      affordances: latestState.affordances,
      visibleThreads: latestState.visibleThreads,
      activeLeads: latestState.activeLeads,
      clocks: latestState.clocks,
      party: latestState.party,
      stall: { questionKey: stall.questionKey, count: stall.count },
      modelCallsUsed: beforeRuling.modelCallsUsed + 2
    };
    this.appendTownTableEvent({ beat: beforeRuling.beat + 1, visibility: "public", lane: "commit", speaker: "Referee", kind: "commit", text: `Beat ${beforeRuling.beat + 1} committed. ${nextPatch.activeQuestion}`, statePatch: nextPatch });
  }

  private async readFrozenTownModule(ref = this.requireRefereeState().prototypeFrozenTownModule): Promise<TownGraph> {
    if (!ref) throw new Error("No frozen town module ref is active");
    const object = await this.env.RUNTIME_SKILLS.get(ref.r2.graph);
    if (!object) throw new Error(`Frozen town graph missing from R2: ${ref.r2.graph}`);
    return TownGraphSchema.parse(JSON.parse(await object.text()));
  }

  private prototypeStateFromFrozenTown(town: TownGraph, ref: FrozenTownModuleRef, creations: Array<{ playerName: string; draft: CharacterCreationDraft; plan: CharacterCreationPlan; character: Character }>, campaign: Campaign): PrototypeTavernTownState {
    const projection = town.publicProjection;
    const visibleLocationIds = new Set(projection.visibleLocationIds);
    const visibleNpcIds = new Set(projection.visibleNpcIds);
    const visibleRumorIds = new Set(projection.visibleRumorIds);
    const startingLocation = town.locations.find((location) => location.id === projection.startingLocationId) ?? town.locations[0];
    if (!startingLocation) throw new Error("Frozen town has no starting location");
    const now = new Date().toISOString();
    const visibleNpcs = town.npcs
      .filter((npc) => visibleNpcIds.has(npc.id) || npc.linkedLocationIds.includes(startingLocation.id))
      .slice(0, 6)
      .map((npc) => ({ name: npc.name, role: npc.role, want: npc.want, memory: npc.publicTell, disposition: npc.publicDisposition }));
    const visibleRumors = town.rumors.filter((rumor) => visibleRumorIds.has(rumor.id)).map((rumor) => rumor.text);
    const locationAffordances = town.locations
      .filter((location) => visibleLocationIds.has(location.id))
      .flatMap((location) => location.visibleAffordances.map((affordance) => `${location.name}: ${affordance}`));
    return {
      mode: "running",
      beat: 0,
      location: startingLocation.name,
      premise: projection.tableSummary,
      npcs: visibleNpcs,
      party: creations.map(({ playerName, plan, character }) => ({
        player: playerName,
        character: `${character.name}, level ${character.level ?? 1} ${character.className ?? "adventurer"}`,
        goal: character.reasonExceptional ?? plan.goal ?? "find a table-visible reason to take the first risk",
        fear: "private fear withheld from the table until revealed in play",
        inventory: character.inventory,
        abilities: character.abilities,
        hp: character.stats.hp,
        armorClass: character.stats.armorClass,
        className: character.className,
        goldGp: character.goldGp
      })),
      affordances: [...projection.startingAffordances, ...locationAffordances].slice(0, 7),
      visibleThreads: visibleRumors.slice(0, 7),
      ruleReceipts: PROTOTYPE_SESSION_ZERO_RULE_RECEIPTS,
      updatedAt: now,
      log: [
        {
          beat: 0,
          lane: "setup",
          actor: "Referee",
          title: `Frozen town module — ${town.name}`,
          tableText: `${projection.tableSummary}\n\nThe party starts at ${startingLocation.name}. ${startingLocation.publicDescription}`,
          processReasoning: `Cloudflare R2 module ${ref.r2.graph}; Artifacts commit ${ref.sourceArtifactCommit ?? "unknown"}. PlayerAgents receive public projection only.`,
          devReasoning: "Full graph and hidden notes stay in Referee-only module context."
        },
        ...creations.map(({ playerName, draft, plan, character }) => ({
          beat: 0,
          lane: "player",
          actor: playerName,
          title: `${character.name} enters ${startingLocation.name}`,
          tableText: `${character.name} is a level ${character.level ?? 1} ${character.className ?? "adventurer"} with ${character.stats.hp} hp, AC ${character.stats.armorClass}, ${character.goldGp ?? 0} gp left, and gear: ${character.inventory.join(", ") || "none"}.`,
          processReasoning: `Rolled ${formatAbilityScores(character.abilities)} and ${draft.startingGoldGp} gp starting money. PlayerAgent chose ${plan.className}${plan.abilitySwap ? ` with one swap (${plan.abilitySwap.first}<->${plan.abilitySwap.second})` : ""}.`,
          devReasoning: "Player-private inner monologue, goal, and fear stayed inside that PlayerAgent's private memory."
        })),
        {
          beat: 0,
          lane: "rules",
          actor: "OSE",
          title: "Session 0 dice receipts",
          tableText: `Character setup used source-backed character creation and equipment procedures. Public dice ledger has ${campaign.diceLedger.length} rolls.`,
          processReasoning: campaign.diceLedger.map((roll) => `${roll.playerId ?? "table"}: ${roll.reason} = ${roll.terms.join("+")} (${roll.result})`).join(" | "),
          devReasoning: "Receipts are chunk IDs only; public monitor must not quote raw rulebook text."
        }
      ]
    };
  }

  async getFrozenTownModule(): Promise<FrozenTownModuleRef | null> {
    const parsed = this.requireRefereeState().prototypeFrozenTownModule ? FrozenTownModuleRefSchema.safeParse(this.requireRefereeState().prototypeFrozenTownModule) : null;
    return parsed?.success ? parsed.data : null;
  }

  async setupFrozenTownPlaytest(sourceForge?: TownForgeState): Promise<{ module: FrozenTownModuleRef; state: PrototypeTavernTownState }> {
    this.installCotForwarder();
    this.emitPrototypeProcess("setup", "Frozen town playtest setup started: freezing module and rolling players into the tavern.", { beat: 0, status: "running" });
    const ref = await this.freezeReadyTownModule(sourceForge);
    const town = await this.readFrozenTownModule(ref);
    let campaign = seedTavernCampaign(this.name);
    const playerA = await this.subAgent(PlayerAgent, "player-a");
    const playerB = await this.subAgent(PlayerAgent, "player-b");
    await this.subAgent(RefereeAgent, "referee");
    const playerEntries = [["player-a", playerA], ["player-b", playerB]] as const;
    const creations: Array<{ playerId: PlayerId; playerName: string; draft: CharacterCreationDraft; plan: CharacterCreationPlan; character: Character }> = [];
    for (const [playerId, player] of playerEntries) {
      this.emitPrototypeProcess("player", `${campaign.players[playerId]?.name ?? playerId} is rolling a level 1 character for ${town.name}.`, { beat: 0, status: "running" });
      const rolled = rollCharacterCreationDraft(campaign, playerId, secureRandomInt);
      campaign = rolled.campaign;
      let plan = assertDistinctCharacterName(await player.createCharacterPlan(rolled.draft, campaign.stores), campaign.players[playerId]?.name ?? playerId);
      try {
        campaign = commitCharacterCreation(campaign, rolled.draft, plan, secureRandomInt);
      } catch (error) {
        console.warn("[Referee] frozen town character plan needed purchase repair", error);
        plan = assertDistinctCharacterName(trimPlanToBudget(plan, campaign.stores, rolled.draft.startingGoldGp), campaign.players[playerId]?.name ?? playerId);
        campaign = commitCharacterCreation(campaign, rolled.draft, plan, secureRandomInt);
      }
      const character = Object.values(campaign.characters).find((candidate) => candidate.playerId === playerId);
      if (!character) throw new Error(`No character committed for ${playerId}`);
      creations.push({ playerId, playerName: campaign.players[playerId]?.name ?? playerId, draft: rolled.draft, plan, character });
      this.emitPrototypeProcess("player", `${character.name} entered ${town.publicProjection.startingLocationId}.`, { beat: 0, status: "done", detail: `${character.stats.hp} hp, AC ${character.stats.armorClass}.` });
    }
    const prototypeTavernTown = this.prototypeStateFromFrozenTown(town, ref, creations, campaign);
    this.setState({ ...this.requireRefereeState(), prototypeTavernTown, prototypeFrozenTownModule: ref });
    this.emitPrototypeState(prototypeTavernTown, "frozen-town-setup");
    this.emitPrototypeProcess("state", `Frozen town playtest ready: ${town.name}.`, { beat: 0, status: "done", detail: `Starts at ${prototypeTavernTown.location}` });
    const { playerABrain, playerBBrain, refereeBrain } = await this.readPrototypeBrainDebugs();
    await this.syncPrototypeBrainArtifacts(prototypeTavernTown, { playerA: playerABrain.state, playerB: playerBBrain.state, referee: refereeBrain.state }).catch((error) => {
      console.warn("[Referee] frozen town setup brain sync failed", error);
    });
    return { module: ref, state: prototypeTavernTown };
  }

  async setupPrototypeTavernTown(): Promise<PrototypeTavernTownState> {
    this.installCotForwarder();
    this.emitPrototypeProcess("setup", "Session 0 setup started: seeding a fresh campaign table.", { beat: 0, status: "running" });
    let campaign = seedTavernCampaign(this.name);
    const playerA = await this.subAgent(PlayerAgent, "player-a");
    const playerB = await this.subAgent(PlayerAgent, "player-b");
    const referee = await this.subAgent(RefereeAgent, "referee");
    const playerEntries = [
      ["player-a", playerA],
      ["player-b", playerB]
    ] as const;
    const creations: Array<{ playerId: PlayerId; playerName: string; draft: CharacterCreationDraft; plan: CharacterCreationPlan; character: Character }> = [];

    for (const [playerId, player] of playerEntries) {
      this.emitPrototypeProcess("player", `${campaign.players[playerId]?.name ?? playerId} is rolling a level 1 character.`, { beat: 0, status: "running" });
      const rolled = rollCharacterCreationDraft(campaign, playerId, secureRandomInt);
      campaign = rolled.campaign;
      let plan: CharacterCreationPlan;
      try {
        this.emitPrototypeProcess("player", `${campaign.players[playerId]?.name ?? playerId} is choosing class and gear from the rolled sheet.`, { beat: 0, detail: `Rolls: ${formatAbilityScores(rolled.draft.rawAbilities)}; starting gold ${rolled.draft.startingGoldGp} gp.`, status: "running" });
        plan = await player.createCharacterPlan(rolled.draft, campaign.stores);
      } catch (error) {
        console.warn("[Referee] PlayerAgent character plan generation failed; no fixture fallback is allowed", error);
        this.emitPrototypeProcess("player", "Character generation failed honestly; no fixture character was substituted.", { beat: 0, detail: publicPrototypeError(error), status: "error" });
        throw error;
      }
      plan = assertDistinctCharacterName(plan, campaign.players[playerId]?.name ?? playerId);
      try {
        campaign = commitCharacterCreation(campaign, rolled.draft, plan, secureRandomInt);
      } catch (error) {
        console.warn("[Referee] prototype setup character plan needed purchase repair", error);
        plan = assertDistinctCharacterName(trimPlanToBudget(plan, campaign.stores, rolled.draft.startingGoldGp), campaign.players[playerId]?.name ?? playerId);
        campaign = commitCharacterCreation(campaign, rolled.draft, plan, secureRandomInt);
      }
      const character = Object.values(campaign.characters).find((candidate) => candidate.playerId === playerId);
      if (!character) throw new Error(`No character committed for ${playerId}`);
      creations.push({ playerId, playerName: campaign.players[playerId]?.name ?? playerId, draft: rolled.draft, plan, character });
      this.emitPrototypeProcess("player", `${character.name} entered play as a level ${character.level ?? 1} ${character.className}.`, { beat: 0, detail: `${character.stats.hp} hp, AC ${character.stats.armorClass}, ${character.goldGp ?? 0} gp left.`, status: "done" });
    }

    const setupContext = {
      campaignId: this.name,
      characters: creations.map(({ playerId, playerName, draft, plan, character }) => ({
        playerId,
        playerName,
        rawAbilities: draft.rawAbilities,
        startingGoldGp: draft.startingGoldGp,
        name: character.name,
        className: character.className,
        hp: character.stats.hp,
        armorClass: character.stats.armorClass,
        inventory: character.inventory,
        remainingGoldGp: character.goldGp,
        publicHook: character.reasonExceptional,
        reasonExceptional: character.reasonExceptional
      })),
      diceLedger: campaign.diceLedger.map((roll) => ({ formula: roll.formula, terms: roll.terms, result: roll.result, reason: roll.reason, playerId: roll.playerId })),
      ruleReceipts: PROTOTYPE_SESSION_ZERO_RULE_RECEIPTS,
      constraints: [
        "Fresh setup each reset; do not reuse the old fixed Golden Eel seed.",
        "Show the setup as table-visible process: world first, dice/characters second, open play after.",
        "No predetermined quest path; setup creates pressure and available actions."
      ]
    };
    let setup: TavernSetup;
    try {
      this.emitPrototypeProcess("referee", "Referee is building the town-module opening from rolled table facts.", { beat: 0, status: "running" });
      setup = await referee.generateTavernSetup(setupContext);
      this.emitPrototypeProcess("referee", `Referee built ${setup.location}.`, { beat: 0, detail: setup.premise, status: "done" });
    } catch (error) {
      console.warn("[Referee] prototype setup generation failed; no fixture fallback is allowed", error);
      this.emitPrototypeProcess("referee", "Setup generation failed honestly; no tavern fixture was substituted.", { beat: 0, detail: publicPrototypeError(error), status: "error" });
      throw error;
    }

    const now = new Date().toISOString();
    const prototypeTavernTown: PrototypeTavernTownState = {
      mode: "running",
      beat: 0,
      location: setup.location,
      premise: setup.premise,
      npcs: setup.npcs,
      party: creations.map(({ playerName, plan, character }) => ({
        player: playerName,
        character: `${character.name}, level ${character.level ?? 1} ${character.className ?? "adventurer"}`,
        goal: character.reasonExceptional ?? "find a table-visible reason to take the first risk",
        fear: "private fear withheld from the table until revealed in play",
        inventory: character.inventory,
        abilities: character.abilities,
        hp: character.stats.hp,
        armorClass: character.stats.armorClass,
        className: character.className,
        goldGp: character.goldGp
      })),
      affordances: setup.startingAffordances,
      visibleThreads: setup.visibleThreads,
      ruleReceipts: PROTOTYPE_SESSION_ZERO_RULE_RECEIPTS,
      updatedAt: now,
      log: [
        {
          beat: 0,
          lane: "setup",
          actor: "Referee",
          title: `World setup — ${setup.location}`,
          tableText: setup.openingScene,
          processReasoning: setup.refereeProcess,
          devReasoning: "Referee private setup notes withheld from the public monitor."
        },
        ...creations.map(({ playerName, draft, plan, character }) => ({
          beat: 0,
          lane: "player",
          actor: playerName,
          title: `${character.name} rolled into play`,
          tableText: `${character.name} is a level ${character.level ?? 1} ${character.className ?? "adventurer"} with ${character.stats.hp} hp, AC ${character.stats.armorClass}, ${character.goldGp ?? 0} gp left, and gear: ${character.inventory.join(", ") || "none"}.`,
          processReasoning: `Rolled ${formatAbilityScores(character.abilities)} and ${draft.startingGoldGp} gp starting money. PlayerAgent chose ${plan.className}${plan.abilitySwap ? ` with one swap (${plan.abilitySwap.first}<->${plan.abilitySwap.second})` : ""}.`,
          devReasoning: "Player-private inner monologue, goal, and fear stayed inside that PlayerAgent's private memory."
        })),
        {
          beat: 0,
          lane: "rules",
          actor: "OSE",
          title: "Session 0 dice receipts",
          tableText: `Character setup used 3d6 ability rolls, 3d6 × 10 gp starting money, class hit dice, and source-backed equipment costs. Public dice ledger has ${campaign.diceLedger.length} rolls.`,
          processReasoning: campaign.diceLedger.map((roll) => `${roll.playerId ?? "table"}: ${roll.reason} = ${roll.terms.join("+")} (${roll.result})`).join(" | "),
          devReasoning: "Receipts are chunk IDs only; public monitor must not quote raw rulebook text."
        }
      ]
    };

    this.setState({ ...this.requireRefereeState(), prototypeTavernTown });
    this.emitPrototypeState(prototypeTavernTown, "setup-committed");
    this.emitPrototypeProcess("artifacts", "Syncing setup brains to Artifacts markdown repos.", { beat: prototypeTavernTown.beat, status: "running" });
    const [playerABrain, playerBBrain, refereeBrain] = await Promise.all([playerA.getBrainDebug(), playerB.getBrainDebug(), referee.getBrainDebug()]);
    await this.syncPrototypeBrainArtifacts(prototypeTavernTown, { playerA: playerABrain.state, playerB: playerBBrain.state, referee: refereeBrain.state }).then((results) => {
      this.emitPrototypeProcess("artifacts", "Setup brain sync finished.", { beat: prototypeTavernTown.beat, detail: results.map((result) => `${result.role}:${result.status}`).join(" | "), status: "done" });
    }).catch((error) => {
      console.warn("[Referee] setup artifact brain sync failed", error);
      this.emitPrototypeProcess("artifacts", "Setup brain sync failed; table state is still committed.", { beat: prototypeTavernTown.beat, detail: "Artifact sync error withheld from public monitor; see dev logs.", status: "error" });
    });
    return prototypeTavernTown;
  }

  getPrototypeTavernTown(): PrototypeTavernTownState {
    const state = this.requireRefereeState();
    if (!state.prototypeTavernTown) {
      const prototypeTavernTown = initialPrototypeState();
      this.setState({ ...state, prototypeTavernTown });
      return prototypeTavernTown;
    }
    return state.prototypeTavernTown;
  }

  async resetPrototypeTavernTown(): Promise<PrototypeTavernTownState> {
    const cleanup = await Promise.allSettled([
      this.deleteSubAgent(PlayerAgent, "player-a"),
      this.deleteSubAgent(PlayerAgent, "player-b"),
      this.deleteSubAgent(RefereeAgent, "referee")
    ]);
    const failedCleanup = cleanup.filter((result) => result.status === "rejected");
    if (failedCleanup.length) {
      console.warn("[Referee] prototype reset could not clear every child-agent brain", failedCleanup);
      this.emitPrototypeProcess("state", "Reset continued, but one child-agent brain cleanup failed; see dev logs.", { status: "error" });
    }
    const prototypeTavernTown = initialPrototypeState();
    const { prototypeFrozenTownModule: _frozen, ...base } = this.requireRefereeState();
    void _frozen;
    this.setState({ ...base, prototypeTavernTown, prototypeBrainArtifacts: {}, prototypePlaytestRun: { mode: "stopped", currentBeat: 0, currentPhase: "reset", updatedAt: new Date().toISOString() } });
    this.emitPrototypeState(prototypeTavernTown, "reset");
    return prototypeTavernTown;
  }

  private prototypeRunState(mode: PrototypePlaytestRun["mode"], patch: Partial<PrototypePlaytestRun> = {}): PrototypePlaytestRun {
    const current = this.requireRefereeState().prototypePlaytestRun;
    return {
      mode,
      runId: current?.runId,
      startedAt: current?.startedAt,
      currentBeat: this.getPrototypeTavernTown().beat,
      allowContinuous: current?.allowContinuous,
      ...patch,
      updatedAt: new Date().toISOString()
    };
  }

  private setPrototypePlaytestRun(run: PrototypePlaytestRun, reason: string): void {
    const state = this.requireRefereeState();
    const currentTable = state.prototypeTavernTown ?? initialPrototypeState();
    const { error: _currentError, ...tableWithoutError } = currentTable;
    void _currentError;
    const tableMode = run.mode === "paused" ? "paused" : run.mode === "failed" ? "failed" : currentTable.mode;
    const table: PrototypeTavernTownState = {
      ...tableWithoutError,
      mode: tableMode,
      ...(run.mode === "failed" && run.error ? { error: run.error } : {}),
      updatedAt: run.updatedAt
    };
    this.setState({ ...state, prototypePlaytestRun: run, prototypeTavernTown: table });
    this.emitPrototypeProcess("state", `Run supervisor: ${run.mode}${run.currentPhase ? ` / ${run.currentPhase}` : ""}.`, {
      beat: run.currentBeat,
      status: run.mode === "failed" ? "error" : run.mode === "paused" || run.mode === "stopped" ? "done" : "running",
      ...(run.error ? { detail: run.error } : {}),
      reasoning: `durable run state updated: ${reason}; runId=${run.runId ?? "none"}`
    });
    this.emitPrototypeState(table, `run-${reason}`);
  }

  async startPrototypePlaytestRun(options: { allowContinuous?: boolean } = {}): Promise<PrototypePlaytestRun> {
    const state = this.requireRefereeState();
    const existing = state.prototypePlaytestRun;
    if (existing?.mode === "running" || existing?.mode === "generating") {
      this.emitPrototypeProcess("state", "Run supervisor is already active; refusing duplicate RUN.", { beat: this.getPrototypeTavernTown().beat, status: "warning" });
      return existing;
    }
    const runId = `prototype-run-${crypto.randomUUID()}`;
    const startedAt = new Date().toISOString();
    const run: PrototypePlaytestRun = {
      mode: "running",
      runId,
      startedAt,
      updatedAt: startedAt,
      currentBeat: this.getPrototypeTavernTown().beat,
      currentPhase: "starting",
      allowContinuous: options.allowContinuous === true
    };
    this.setPrototypePlaytestRun(run, "started");
    const fiber = await this.startFiber("prototype-playtest-run", async (fiberCtx) => {
      fiberCtx.stash({ runId, startedAt });
      await this.executePrototypePlaytestRun(runId);
    }, {
      fiberId: runId,
      idempotencyKey: runId,
      metadata: { runId, startedAt },
      waitForCompletion: false
    });
    this.setPrototypePlaytestRun({ ...run, fiberId: fiber.fiberId, currentPhase: "accepted", updatedAt: new Date().toISOString() }, "accepted");
    return this.requireRefereeState().prototypePlaytestRun ?? run;
  }

  pausePrototypePlaytestRun(reason = "Paused."): PrototypePlaytestRun {
    const run = this.prototypeRunState("paused", { currentPhase: "paused", error: reason });
    this.setPrototypePlaytestRun(run, "paused");
    return run;
  }

  private async executePrototypePlaytestRun(runId: string): Promise<void> {
    while (true) {
      const run = this.requireRefereeState().prototypePlaytestRun;
      if (!run || run.runId !== runId || run.mode !== "running") return;
      const beat = this.getPrototypeTavernTown().beat;
      this.setPrototypePlaytestRun(this.prototypeRunState("generating", { runId, startedAt: run.startedAt, allowContinuous: run.allowContinuous, currentBeat: beat, currentPhase: `beat-${beat + 1}` }), "beat-started");
      try {
        await Promise.race([
          this.stepPrototypeTavernTown(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Prototype beat timed out after ${Math.round(PROTOTYPE_PLAYTEST_BEAT_TIMEOUT_MS / 1000)}s`)), PROTOTYPE_PLAYTEST_BEAT_TIMEOUT_MS))
        ]);
      } catch (error) {
        const failed = this.prototypeRunState("failed", { runId, startedAt: run.startedAt, allowContinuous: run.allowContinuous, currentPhase: `failed-beat-${beat + 1}`, error: publicPrototypeError(error) });
        this.setPrototypePlaytestRun(failed, "failed");
        this.emitPrototypeError(error);
        return;
      }
      const after = this.requireRefereeState().prototypePlaytestRun;
      if (!after || after.runId !== runId) return;
      if (after.mode === "paused" || after.mode === "stopped" || after.mode === "failed") return;
      this.setPrototypePlaytestRun(this.prototypeRunState("running", { runId, startedAt: run.startedAt, allowContinuous: run.allowContinuous, currentPhase: "waiting-next-beat" }), "beat-complete");
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }

  async getPrototypeTavernTownBrains() {
    const { playerABrain, playerBBrain, refereeBrain } = await this.readPrototypeBrainDebugs();
    const state = this.requireRefereeState();
    return {
      devMode: true,
      campaignId: this.name,
      beat: this.getPrototypeTavernTown().beat,
      agents: {
        "player-a": playerABrain,
        "player-b": playerBBrain,
        referee: refereeBrain
      },
      artifacts: state.prototypeBrainArtifacts ?? {},
      table: {
        repoName: this.brainRepoName("table"),
        summary: this.formatTableBrainMarkdown(this.getPrototypeTavernTown())
      }
    };
  }

  async syncPrototypeTavernTownBrains() {
    const state = this.getPrototypeTavernTown();
    const { playerABrain, playerBBrain, refereeBrain } = await this.readPrototypeBrainDebugs();
    const results = await this.syncPrototypeBrainArtifacts(state, {
      playerA: playerABrain.state,
      playerB: playerBBrain.state,
      referee: refereeBrain.state
    });
    return {
      devMode: true,
      campaignId: this.name,
      beat: state.beat,
      results,
      artifacts: this.requireRefereeState().prototypeBrainArtifacts ?? {}
    };
  }

  private async readPrototypeBrainDebugs() {
    const playerA = await this.subAgent(PlayerAgent, "player-a");
    const playerB = await this.subAgent(PlayerAgent, "player-b");
    const referee = await this.subAgent(RefereeAgent, "referee");
    const [playerABrain, playerBBrain, refereeBrain] = await Promise.all([
      playerA.getBrainDebug(),
      playerB.getBrainDebug(),
      referee.getBrainDebug()
    ]);
    return { playerABrain, playerBBrain, refereeBrain };
  }

  async stepPrototypeTavernTown(): Promise<PrototypeTavernTownState> {
    this.installCotForwarder();
    const state = this.requireRefereeState();
    let current = state.prototypeTavernTown ?? initialPrototypeState();
    if (current.mode === "generating") {
      if (hasFreshPrototypeGenerationLock(current)) {
        this.emitPrototypeProcess("state", "Server is already generating; refusing overlapping beat request.", { beat: current.beat, status: "running" });
        this.emitPrototypeState(current, "already-generating");
        return current;
      }
      current = {
        ...current,
        mode: "running",
        error: `Recovered stale generation lock from ${current.updatedAt ?? "unknown time"}`,
        updatedAt: new Date().toISOString()
      };
    }

    const { error: _staleError, ...currentWithoutError } = current;
    void _staleError;
    const generating: PrototypeTavernTownState = {
      ...currentWithoutError,
      mode: "generating",
      updatedAt: new Date().toISOString()
    };
    this.setState({ ...state, prototypeTavernTown: generating });
    this.emitPrototypeState(generating, "generation-started");
    this.emitPrototypeProcess("state", generating.beat === 0 && (generating.log?.length ?? 0) === 0 ? "First step: setup generation and character rolling started." : `Beat ${generating.beat + 1} generation started.`, { beat: generating.beat, status: "running" });

    try {
      const needsSetup = generating.beat === 0 && (generating.log?.length ?? 0) === 0;
      const next = needsSetup ? (await this.setupFrozenTownPlaytest()).state : await this.runTavernBeat(generating);
      this.setState({ ...this.requireRefereeState(), prototypeTavernTown: next });
      this.emitPrototypeState(next, needsSetup ? "setup-complete" : "beat-complete");
      this.emitPrototypeProcess("state", needsSetup ? "Setup complete. The table is ready for play." : `Beat ${next.beat} committed.`, { beat: next.beat, status: "done" });
      return next;
    } catch (error) {
      const failed: PrototypeTavernTownState = {
        ...generating,
        mode: "failed",
        error: publicPrototypeError(error),
        updatedAt: new Date().toISOString()
      };
      this.setState({ ...this.requireRefereeState(), prototypeTavernTown: failed });
      this.emitPrototypeState(failed, "generation-failed");
      this.emitPrototypeError(error);
      throw error;
    }
  }

  async runTavernBeat(current: PrototypeTavernTownState): Promise<PrototypeTavernTownState> {
    this.installCotForwarder();
    const reasoningHandler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { lane?: PrototypeSocketProcessLane; message?: string; reasoning?: string; detail?: string; phase?: string } | undefined;
      if (!detail?.message) return;
      this.emitPrototypeProcess(detail.lane ?? "state", detail.message, {
        beat: current.beat + 1,
        status: "running",
        ...(detail.detail ? { detail: detail.detail } : {}),
        ...(detail.reasoning ? { reasoning: detail.reasoning } : {})
      });
    };
    (globalThis as unknown as EventTarget).addEventListener("agent-dungeon-prototype-reasoning", reasoningHandler);
    try {
    this.emitPrototypeProcess("referee", `Preparing beat ${current.beat + 1}: PlayerAgents choose table-visible intents, then Referee resolves them.`, { beat: current.beat + 1, status: "running", reasoning: "This beat spends exactly two PlayerAgent turns and one Referee turn. The feed shows sanitized process notes from each agent, not hidden chain-of-thought." });
    const playerA = await this.subAgent(PlayerAgent, "player-a");
    const playerB = await this.subAgent(PlayerAgent, "player-b");
    const referee = await this.subAgent(RefereeAgent, "referee");
    const playerEntries = [
      ["player-a", playerA],
      ["player-b", playerB]
    ] as const;

    const playerIntents: TavernIntent[] = [];
    for (const [playerId, player] of playerEntries) {
      const actor = current.party[playerId === "player-a" ? 0 : 1]?.character ?? playerId;
      this.emitPrototypeProcess("player", `${actor} is choosing an intent from the visible table state.`, { beat: current.beat + 1, status: "running", reasoning: "PlayerAgent receives only table-visible state: public module projection, visible NPCs, affordances, public threads, own character, and own private brain." });
      const intent = await player.chooseTavernIntent(this.tavernIntentContext(current, playerId));
      playerIntents.push(intent);
      this.emitPrototypeProcess("player", `${intent.actor}: ${intent.title}`, { beat: current.beat + 1, detail: intent.declaredAction, reasoning: intent.processReasoning, status: "done" });
    }

    this.emitPrototypeProcess("rules", "Looking up bounded OSE rule receipts for this beat.", { beat: current.beat + 1, status: "running" });
    const receipts = await this.consultPrototypeRules(current);
    this.emitPrototypeProcess("rules", receipts.length ? `Found ${receipts.length} rule receipt(s).` : "No external rule receipts found; continuing with current table context.", { beat: current.beat + 1, detail: receipts.map((receipt) => receipt.id).join(" | "), status: "done" });
    const refereePlanningSummary = playerIntents.map((intent) => `${intent.actor}: ${intent.declaredAction}`).join(" | ");
    this.emitPrototypeProcess("referee", "Referee is resolving the submitted PlayerAgent intents.", { beat: current.beat + 1, status: "running", reasoning: refereePlanningSummary });
    this.emitPrototypeProcess("referee", "Referee planning pass: compare player intents against visible threads and NPC pressure.", { beat: current.beat + 1, status: "running", reasoning: "Explicit app-level planning signal, not raw hidden model chain-of-thought. Inputs: " + refereePlanningSummary });
    this.emitPrototypeProcess("referee", "Referee planning pass: check rule receipts and avoid leaking hidden town graph facts.", { beat: current.beat + 1, status: "running", detail: receipts.map((receipt) => receipt.id).join(" | "), reasoning: "The Referee can use private module truth, but public output must expose only consequences visible at the table." });
    const wipBeats = [
      { message: "Referee WIP: Hrum is testing the residue instead of chasing Vard yet.", reasoning: "Likely ruling axis: careful dwarven examination can reveal a physical clue without forcing a danger-room transition." },
      { message: "Referee WIP: Vex is turning Mort's literacy dare into leverage.", reasoning: "Likely ruling axis: Mort should react to competence and fear; the door scratches can expose pressure without dumping hidden ledger truth." },
      { message: "Referee WIP: keep both player actions alive in parallel.", reasoning: "Do not collapse the beat into one protagonist. Resolve Hrum at the sluice and Vex at the tavern as simultaneous pressure cuts." },
      { message: "Referee WIP: choose consequences that create next affordances.", reasoning: "Good beat output should produce 3-7 next moves: follow Vard, inspect residue, press Mort, open/read the door, seek the unseen's man." }
    ];
    let wipIndex = 0;
    for (const wip of wipBeats.slice(0, 2)) this.emitPrototypeProcess("referee", wip.message, { beat: current.beat + 1, status: "running", reasoning: wip.reasoning });
    const refereeStartedAt = Date.now();
    const refereeProgressTimer = setInterval(() => {
      const elapsedSeconds = Math.round((Date.now() - refereeStartedAt) / 1000);
      const wip = wipBeats[wipIndex % wipBeats.length] ?? wipBeats[0]!;
      wipIndex += 1;
      this.emitPrototypeProcess("referee", `${wip.message} (${elapsedSeconds}s)`, {
        beat: current.beat + 1,
        status: "running",
        reasoning: wip.reasoning
      });
    }, 8_000);
    let beat: TavernBeat;
    try {
      beat = await referee.generateTavernBeat({
        state: { ...current, log: current.log.slice(0, 6) },
        playerIntents,
        ruleReceipts: receipts.map((receipt) => ({ id: receipt.id, docId: receipt.docId, headingPath: receipt.headingPath, snippet: receipt.snippet?.slice(0, 220) }))
      });
    } finally {
      clearInterval(refereeProgressTimer);
    }

    this.emitPrototypeProcess("referee", `${beat.title}`, { beat: current.beat + 1, detail: beat.processReasoning, reasoning: beat.devReasoning, status: "done" });
    const committed = this.commitTavernBeat(current, beat, playerIntents, receipts);
    const [playerAIntent, playerBIntent] = playerIntents;
    if (!playerAIntent || !playerBIntent) throw new Error("Town-module beat did not produce both player intents");
    const memoryResults = await Promise.allSettled([
      playerA.rememberTavernBeat({ current, committed, intent: playerAIntent, beat, receipts }),
      playerB.rememberTavernBeat({ current, committed, intent: playerBIntent, beat, receipts }),
      referee.rememberTavernBeat({ current, committed, playerIntents, beat, receipts })
    ]);
    for (const result of memoryResults) {
      if (result.status === "rejected") console.warn("[Referee] town-module beat memory update failed", result.reason);
    }

    this.emitPrototypeProcess("artifacts", "Updating hot brain summaries and syncing markdown artifacts.", { beat: committed.beat, status: "running" });
    const playerAState = memoryResults[0]?.status === "fulfilled" ? memoryResults[0].value : (await playerA.getBrainDebug()).state;
    const playerBState = memoryResults[1]?.status === "fulfilled" ? memoryResults[1].value : (await playerB.getBrainDebug()).state;
    const refereeState = memoryResults[2]?.status === "fulfilled" ? memoryResults[2].value : (await referee.getBrainDebug()).state;
    await this.syncPrototypeBrainArtifacts(committed, { playerA: playerAState, playerB: playerBState, referee: refereeState }).then((results) => {
      this.emitPrototypeProcess("artifacts", "Brain artifact sync finished.", { beat: committed.beat, detail: results.map((result) => `${result.role}:${result.status}`).join(" | "), status: "done" });
    }).catch((error) => {
      console.warn("[Referee] artifact brain sync failed", error);
      this.emitPrototypeProcess("artifacts", "Brain artifact sync failed; committed beat remains available.", { beat: committed.beat, detail: "Artifact sync error withheld from public monitor; see dev logs.", status: "error" });
      this.recordArtifactSyncResults([
        { role: "player-a", repoName: this.brainRepoName("player-a"), status: "error", error: String(error) },
        { role: "player-b", repoName: this.brainRepoName("player-b"), status: "error", error: String(error) },
        { role: "referee", repoName: this.brainRepoName("referee"), status: "error", error: String(error) },
        { role: "table", repoName: this.brainRepoName("table"), status: "error", error: String(error) }
      ]);
    });

    return committed;
    } finally {
      (globalThis as unknown as EventTarget).removeEventListener("agent-dungeon-prototype-reasoning", reasoningHandler);
      this.flushAllCotBuffers();
    }
  }

  private brainRepoName(role: AgentBrainRole): string {
    return `campaign-${this.name}-${role}`;
  }

  private async syncPrototypeBrainArtifacts(
    state: PrototypeTavernTownState,
    brains: { playerA: PlayerAgentState; playerB: PlayerAgentState; referee: RefereeAgentState }
  ): Promise<AgentBrainSyncResult[]> {
    const store = getAgentBrainStore(this.env);
    if (!store) {
      const skipped: AgentBrainSyncResult[] = (["player-a", "player-b", "referee", "table"] as const).map((role) => ({
        role,
        repoName: this.brainRepoName(role),
        lastSyncedBeat: state.beat,
        lastSyncedAt: new Date().toISOString(),
        status: "skipped",
        error: "ARTIFACTS binding unavailable"
      }));
      this.recordArtifactSyncResults(skipped);
      return skipped;
    }

    const inputs: Array<{ role: AgentBrainRole; files: Record<string, string> }> = [
      { role: "player-a", files: { "README.md": this.formatPlayerBrainMarkdown("player-a", brains.playerA, state) } },
      { role: "player-b", files: { "README.md": this.formatPlayerBrainMarkdown("player-b", brains.playerB, state) } },
      { role: "referee", files: { "README.md": this.formatRefereeBrainMarkdown(brains.referee, state) } },
      { role: "table", files: { "README.md": this.formatTableBrainMarkdown(state) } }
    ];

    const settled = await Promise.allSettled(inputs.map((input) => store.syncMarkdown({
      repoName: this.brainRepoName(input.role),
      role: input.role,
      files: input.files,
      message: `beat ${state.beat}: sync ${input.role} brain`,
      beat: state.beat
    })));

    const results = settled.map((result, index): AgentBrainSyncResult => {
      const role = inputs[index]?.role ?? "table";
      if (result.status === "fulfilled") return result.value;
      return {
        role,
        repoName: this.brainRepoName(role),
        lastSyncedBeat: state.beat,
        lastSyncedAt: new Date().toISOString(),
        status: "error",
        error: String(result.reason)
      };
    });
    this.recordArtifactSyncResults(results);
    return results;
  }

  private recordArtifactSyncResults(results: AgentBrainSyncResult[]): void {
    const current = this.requireRefereeState();
    const previous = current.prototypeBrainArtifacts ?? {};
    const next = { ...previous };
    for (const result of results) next[result.role] = result;
    this.setState({ ...current, prototypeBrainArtifacts: next });
  }

  private formatPlayerBrainMarkdown(role: "player-a" | "player-b", state: PlayerAgentState, table: PrototypeTavernTownState): string {
    return [
      `# ${role} Brain`,
      "",
      `Campaign: ${this.name}`,
      `Beat: ${table.beat}`,
      `Updated: ${state.updatedAt ?? table.updatedAt}`,
      "Privacy: private player repo. Do not expose to Referee, other players, or public monitor.",
      "",
      "## Summary",
      state.brainSummary,
      "",
      "## Current drives",
      `- Goal: ${state.currentGoal ?? "unset"}`,
      `- Fear: ${state.currentFear ?? "unset"}`,
      "",
      "## Private theories",
      ...(state.privateTheories.length ? state.privateTheories.map((item) => `- ${item}`) : ["- none yet"]),
      "",
      "## Relationships",
      ...(state.relationships.length ? state.relationships.map((item) => `- ${item}`) : ["- none yet"]),
      "",
      "## Recent memories",
      ...(state.recentMemories.length ? state.recentMemories.map((item) => `- Beat ${item.beat} (${item.at}): ${item.summary}`) : ["- none yet"])
    ].join("\n");
  }

  private formatRefereeBrainMarkdown(state: RefereeAgentState, table: PrototypeTavernTownState): string {
    return [
      "# Referee Brain",
      "",
      `Campaign: ${this.name}`,
      `Beat: ${table.beat}`,
      `Updated: ${state.updatedAt ?? table.updatedAt}`,
      "Privacy: Referee-only repo. Contains process notes and unresolved fronts; public monitor must not render raw content.",
      "",
      "## Summary",
      state.brainSummary,
      "",
      "## NPC memory",
      ...(state.npcMemory.length ? state.npcMemory.map((item) => `- ${item}`) : ["- none yet"]),
      "",
      "## Fronts / pressure",
      ...(state.frontNotes.length ? state.frontNotes.map((item) => `- ${item}`) : ["- none yet"]),
      "",
      "## Rule receipts",
      ...(state.rulesNotes.length ? state.rulesNotes.map((item) => `- ${item}`) : ["- none yet"]),
      "",
      "## Open questions",
      ...(state.unresolvedQuestions.length ? state.unresolvedQuestions.map((item) => `- ${item}`) : ["- none yet"]),
      "",
      "## Recent memories",
      ...(state.recentMemories.length ? state.recentMemories.map((item) => `- Beat ${item.beat} (${item.at}): ${item.summary}`) : ["- none yet"])
    ].join("\n");
  }

  private formatTableBrainMarkdown(state: PrototypeTavernTownState): string {
    return [
      "# Shared Table Brain",
      "",
      `Campaign: ${this.name}`,
      `Beat: ${state.beat}`,
      `Updated: ${state.updatedAt}`,
      "Privacy: table-visible only. Revealed NPCs, affordances, public threads, and rule receipt IDs.",
      "",
      "## Current location",
      state.location,
      "",
      "## NPCs",
      ...state.npcs.map((npc) => `- ${npc.name} (${npc.role}): wants ${npc.want}; memory ${npc.memory}; disposition ${npc.disposition}`),
      "",
      "## Affordances",
      ...state.affordances.map((item) => `- ${item}`),
      "",
      "## Visible threads",
      ...state.visibleThreads.map((item) => `- ${item}`),
      "",
      "## Rule receipt IDs",
      ...(state.ruleReceipts.length ? state.ruleReceipts.map((item) => `- ${item}`) : ["- none yet"]),
      "",
      "## Recent public process log",
      ...state.log.slice(0, 12).map((turn) => {
        const entry = turn as { beat?: number; lane?: string; actor?: string; title?: string; tableText?: string };
        return `- Beat ${entry.beat ?? "?"} ${entry.lane ?? "?"}/${entry.actor ?? "?"}: ${entry.title ?? "Untitled"} — ${entry.tableText ?? ""}`;
      })
    ].join("\n");
  }

  private tavernIntentContext(state: PrototypeTavernTownState, playerId: PlayerId) {
    const memberIndex = playerId === "player-a" ? 0 : 1;
    const member = state.party[memberIndex] ?? state.party[0];
    return {
      playerId,
      member,
      location: state.location,
      beat: state.beat,
      premise: state.premise,
      visibleThreads: state.visibleThreads,
      affordances: state.affordances,
      npcs: state.npcs.map((npc) => ({ name: npc.name, role: npc.role, disposition: npc.disposition, memory: npc.memory })),
      recentLog: state.log.slice(0, 6)
    };
  }

  private async consultPrototypeRules(state: PrototypeTavernTownState): Promise<PrototypeRuleReceipt[]> {
    const query = state.beat < 2
      ? "Old-School Essentials character creation 3d6 ability scores starting gold equipment"
      : "Old-School Essentials equipment cost rations torches rope adventuring gear retainers reaction";
    const response = await fetch(`https://joelclaw.com/api/docs/search?q=${encodeURIComponent(query)}&perPage=4&semantic=false`, { headers: { accept: "application/json" } });
    if (!response.ok) return [];
    const json = await response.json() as { result?: { hits?: Array<{ id?: string; docId?: string; chunkIndex?: number; headingPath?: string[]; snippet?: string }> } };
    return (json.result?.hits ?? [])
      .filter((hit): hit is Required<Pick<PrototypeRuleReceipt, "id" | "docId">> & PrototypeRuleReceipt => Boolean(hit.id && hit.docId))
      .slice(0, 4)
      .map((hit) => ({
        id: hit.id,
        docId: hit.docId,
        ...(hit.chunkIndex === undefined ? {} : { chunkIndex: hit.chunkIndex }),
        ...(hit.headingPath === undefined ? {} : { headingPath: hit.headingPath }),
        snippet: stripMarks(hit.snippet ?? "")
      }));
  }

  private commitTavernBeat(state: PrototypeTavernTownState, beat: TavernBeat, playerIntents: TavernIntent[], receipts: PrototypeRuleReceipt[]): PrototypeTavernTownState {
    const beatNumber = state.beat + 1;
    const receiptIds = [...new Set([...(state.ruleReceipts ?? []), ...receipts.map((receipt) => receipt.id), ...(beat.rulesUsed ?? [])])].slice(-12);
    const { error: _error, ...stateWithoutError } = state;
    void _error;
    return {
      ...stateWithoutError,
      mode: "running",
      beat: beatNumber,
      npcs: beat.npcUpdates?.length ? beat.npcUpdates : state.npcs,
      party: beat.partyUpdates?.length ? beat.partyUpdates : state.party,
      affordances: beat.nextAffordances,
      visibleThreads: beat.visibleThreads,
      ruleReceipts: receiptIds,
      updatedAt: new Date().toISOString(),
      log: [
        {
          beat: beatNumber,
          lane: "referee",
          actor: beat.actor,
          title: beat.title,
          tableText: beat.tableText,
          processReasoning: `Referee considered PlayerAgent intents: ${playerIntents.map((intent) => `${intent.actor}: ${intent.declaredAction}`).join(" | ")}. ${beat.processReasoning}`,
          devReasoning: beat.devReasoning,
          rulesUsed: beat.rulesUsed ?? receipts.map((receipt) => receipt.id)
        },
        ...playerIntents.map((intent) => ({
          beat: beatNumber,
          lane: "player",
          actor: intent.actor,
          title: intent.title,
          tableText: intent.tableSpeech,
          processReasoning: `${intent.declaredAction} [${intent.intentKind}]${intent.target ? ` targeting ${intent.target}` : ""}. ${intent.processReasoning}`,
          devReasoning: "Player-private inner monologue, goal, and fear stayed inside that PlayerAgent's private memory."
        })),
        ...state.log
      ].slice(0, 48)
    };
  }

  private commitCampaign(campaign: Campaign): Campaign {
    const prototypeTavernTown = this.state?.prototypeTavernTown;
    const prototypeBrainArtifacts = this.state?.prototypeBrainArtifacts;
    const prototypeTownForge = this.state?.prototypeTownForge;
    const prototypeFrozenTownModule = this.state?.prototypeFrozenTownModule;
    this.setState({
      ...campaign,
      ...(prototypeTavernTown ? { prototypeTavernTown } : {}),
      ...(prototypeBrainArtifacts ? { prototypeBrainArtifacts } : {}),
      ...(prototypeTownForge ? { prototypeTownForge } : {}),
      ...(prototypeFrozenTownModule ? { prototypeFrozenTownModule } : {})
    });
    return campaign;
  }

  private requireCampaign(): Campaign {
    return this.requireRefereeState();
  }

  private requireRefereeState(): RefereeState {
    if (!this.state || this.state.id !== this.name) {
      const existingPrototype = this.state?.prototypeTavernTown;
      const existingArtifacts = this.state?.prototypeBrainArtifacts;
      const existingTownForge = this.state?.prototypeTownForge;
      const existingFrozenTownModule = this.state?.prototypeFrozenTownModule;
      const next: RefereeState = {
        ...seedTavernCampaign(this.name),
        ...(existingPrototype ? { prototypeTavernTown: existingPrototype } : {}),
        ...(existingArtifacts ? { prototypeBrainArtifacts: existingArtifacts } : {}),
        ...(existingTownForge ? { prototypeTownForge: existingTownForge } : {}),
        ...(existingFrozenTownModule ? { prototypeFrozenTownModule: existingFrozenTownModule } : {})
      };
      this.setState(next);
      return next;
    }
    return this.state;
  }
}

function stripMarks(value: string): string {
  return value.replace(/<\/?mark>/g, "");
}

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, {
    headers: { "access-control-allow-origin": "*" },
    ...init
  });
}

function normalizeHostname(value: string | null | undefined): string {
  const host = (value ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  if (host.startsWith("[")) return host.slice(1, host.indexOf("]") > 0 ? host.indexOf("]") : undefined);
  return host.replace(/:\d+$/, "");
}

function isLocalPrototypeHost(hostname: string | null | undefined): boolean {
  const host = normalizeHostname(hostname);
  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1";
}

function isPrototypeBrainDevRequest(request: Request, env: Env): boolean {
  const url = new URL(request.url);
  if (url.searchParams.get("dev") !== "1") return false;
  const observedHosts = [url.hostname, request.headers.get("host"), request.headers.get("x-forwarded-host")];
  if (observedHosts.some(isLocalPrototypeHost)) return true;

  const localDevEnabled = (env as Env & { PROTOTYPE_DEV_ENDPOINTS?: string }).PROTOTYPE_DEV_ENDPOINTS === "1";
  if (localDevEnabled) return true;

  const token = (env as Env & { PROTOTYPE_DEV_TOKEN?: string }).PROTOTYPE_DEV_TOKEN?.trim();
  if (!token) return false;

  const authorization = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const headerToken = request.headers.get("x-prototype-dev-token")?.trim();
  return authorization === token || headerToken === token;
}

async function handleApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return null;

  if (url.pathname === "/api/prototype/town-forge-state") {
    const referee = await getAgentByName(env.Referee, "town-forge-prototype");
    return json({ state: townForgeMonitorState(await referee.getTownForge()) });
  }
  if (url.pathname === "/api/prototype/town-forge-start") {
    if (request.method !== "POST") return json({ error: "POST only" }, { status: 405 });
    const referee = await getAgentByName(env.Referee, "town-forge-prototype");
    return json({ state: townForgeMonitorState(await referee.runTownForge()) });
  }
  if (url.pathname === "/api/prototype/town-forge-reset") {
    if (request.method !== "POST") return json({ error: "POST only" }, { status: 405 });
    const referee = await getAgentByName(env.Referee, "town-forge-prototype");
    return json({ state: townForgeMonitorState(await referee.resetTownForge()) });
  }

  if (url.pathname === "/api/prototype/town-module-table-state") {
    const referee = await getAgentByName(env.Referee, "town-module-table");
    const state = await referee.getTownModuleTableStateRpc();
    return json({ state: isPrototypeBrainDevRequest(request, env) ? state : publicTownModuleTableState(state) });
  }
  if (url.pathname === "/api/prototype/town-module-table-summary") {
    const referee = await getAgentByName(env.Referee, "town-module-table");
    const state = await referee.getTownModuleTableStateRpc();
    return json({ summary: townModuleTableRunSummary(state) });
  }
  if (url.pathname === "/api/prototype/town-module-table-run") {
    if (request.method !== "POST") return json({ error: "POST only" }, { status: 405 });
    const referee = await getAgentByName(env.Referee, "town-module-table");
    const difficulty = url.searchParams.get("difficulty");
    const maxBeats = url.searchParams.get("maxBeats");
    const sampleSeconds = url.searchParams.get("sampleSeconds");
    const options: { difficulty?: number; maxBeats?: number; sampleSeconds?: number } = {};
    if (difficulty) options.difficulty = Number(difficulty);
    if (maxBeats) options.maxBeats = Number(maxBeats);
    if (sampleSeconds) options.sampleSeconds = Number(sampleSeconds);
    await referee.resetTownModuleTable(options);
    return json({ state: await referee.startTownModuleTableRun() });
  }
  if (url.pathname === "/api/prototype/town-module-table-reset") {
    if (request.method !== "POST") return json({ error: "POST only" }, { status: 405 });
    const referee = await getAgentByName(env.Referee, "town-module-table");
    const difficulty = url.searchParams.get("difficulty");
    const maxBeats = url.searchParams.get("maxBeats");
    const sampleSeconds = url.searchParams.get("sampleSeconds");
    const options: { difficulty?: number; maxBeats?: number; sampleSeconds?: number } = {};
    if (difficulty) options.difficulty = Number(difficulty);
    if (maxBeats) options.maxBeats = Number(maxBeats);
    if (sampleSeconds) options.sampleSeconds = Number(sampleSeconds);
    return json({ state: await referee.resetTownModuleTable(options) });
  }

  if (url.pathname === "/api/prototype/tavern-town-state") {
    const referee = await getAgentByName(env.Referee, "tavern-town-prototype");
    return json({ state: prototypeMonitorState(await referee.getPrototypeTavernTown()) });
  }
  if (url.pathname === "/api/prototype/tavern-town-reset") {
    if (request.method !== "POST") return json({ error: "POST only" }, { status: 405 });
    const referee = await getAgentByName(env.Referee, "tavern-town-prototype");
    return json({ state: prototypeMonitorState(await referee.resetPrototypeTavernTown()) });
  }
  if (url.pathname === "/api/prototype/tavern-town-beat") {
    if (request.method !== "POST") return json({ error: "POST only" }, { status: 405 });
    const referee = await getAgentByName(env.Referee, "tavern-town-prototype");
    const prototypeState: PrototypeTavernTownState = prototypeMonitorState(await referee.stepPrototypeTavernTown());
    return json({ state: prototypeState, beat: prototypeState.log?.[0] });
  }
  if (url.pathname === "/api/prototype/tavern-town-run") {
    if (request.method !== "POST") return json({ error: "POST only" }, { status: 405 });
    const referee = await getAgentByName(env.Referee, "tavern-town-prototype");
    const run = await referee.startPrototypePlaytestRun({ allowContinuous: true });
    return json({ run, state: prototypeMonitorState(await referee.getPrototypeTavernTown()) });
  }
  if (url.pathname === "/api/prototype/tavern-town-pause") {
    if (request.method !== "POST") return json({ error: "POST only" }, { status: 405 });
    const referee = await getAgentByName(env.Referee, "tavern-town-prototype");
    const run = referee.pausePrototypePlaytestRun("Paused by HTTP operator endpoint.");
    return json({ run, state: prototypeMonitorState(await referee.getPrototypeTavernTown()) });
  }
  if (url.pathname === "/api/prototype/frozen-town-module") {
    const referee = await getAgentByName(env.Referee, "tavern-town-prototype");
    return json({ module: await referee.getFrozenTownModule(), state: prototypeMonitorState(await referee.getPrototypeTavernTown()) });
  }
  if (url.pathname === "/api/prototype/frozen-town-setup") {
    if (request.method !== "POST") return json({ error: "POST only" }, { status: 405 });
    const forgeReferee = await getAgentByName(env.Referee, "town-forge-prototype");
    const sourceForge = await forgeReferee.getTownForge();
    const referee = await getAgentByName(env.Referee, "tavern-town-prototype");
    const result = await (referee as unknown as { setupFrozenTownPlaytest: (sourceForge: TownForgeState) => Promise<{ module: FrozenTownModuleRef; state: PrototypeTavernTownState }> }).setupFrozenTownPlaytest(sourceForge);
    return json({ module: result.module, state: prototypeMonitorState(result.state) });
  }
  if (url.pathname === "/api/prototype/tavern-town-brains") {
    if (!isPrototypeBrainDevRequest(request, env)) return json({ error: "dev endpoint requires dev=1 plus localhost or a configured dev token" }, { status: 403 });
    const referee = await getAgentByName(env.Referee, "tavern-town-prototype");
    if (request.method === "POST") return json(await referee.syncPrototypeTavernTownBrains());
    return json(await referee.getPrototypeTavernTownBrains());
  }

  const campaignId = url.searchParams.get("campaign") ?? "agent-dungeon-campaign";
  const referee = await getAgentByName(env.Referee, campaignId);

  if (url.pathname === "/api/create-game") {
    return json(projectForMonitor(await referee.createGame(campaignId)));
  }
  if (url.pathname === "/api/session-zero") {
    return json(projectForMonitor(await referee.runSessionZero()));
  }
  if (url.pathname === "/api/advance-turn") {
    return json(projectForMonitor(await referee.advanceWorldTurn()));
  }
  if (url.pathname === "/api/choose-adventure") {
    return json(projectForMonitor(await referee.chooseAdventure()));
  }
  if (url.pathname === "/api/travel-to-adventure") {
    return json(projectForMonitor(await referee.travelToAdventure()));
  }
  if (url.pathname === "/api/campaign") {
    return json(await referee.getPublicCampaign());
  }
  if (url.pathname === "/api/campaign-dev") {
    return json(await referee.getDevCampaign());
  }

  return json({ error: "Not found" }, { status: 404 });
}

async function campaignEvents(request: Request, env: Env, devMode = false): Promise<Response> {
  const url = new URL(request.url);
  const campaignId = url.searchParams.get("campaign") ?? "agent-dungeon-campaign";
  const referee = await getAgentByName(env.Referee, campaignId);
  const encoder = new TextEncoder();
  let ticks = 0;

  const stream = new ReadableStream({
    async start(controller) {
      async function send() {
        const campaign = devMode ? await referee.getDevCampaign() : await referee.getPublicCampaign();
        controller.enqueue(encoder.encode(`event: campaign\ndata: ${JSON.stringify(campaign)}\n\n`));
      }

      await send();
      const interval = setInterval(() => {
        void send().catch((error) => {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message: String(error) })}\n\n`));
        });
        ticks += 1;
        if (ticks >= 30) {
          clearInterval(interval);
          controller.close();
        }
      }, 2000);

      request.signal.addEventListener("abort", () => {
        clearInterval(interval);
        controller.close();
      });
    }
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream;charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": "*"
    }
  });
}

function townModuleTableToDomainRunState(state: TownModuleTableState): TableRunCoreState {
  return DomainTableRunCoreStateSchema.parse({
    mode: state.mode,
    runId: state.runId,
    moduleId: state.townId,
    moduleTitle: state.townName,
    beat: state.beat,
    moment: state.moment,
    location: state.location,
    locationId: state.locationId,
    sceneId: state.sceneId,
    visitedLocationIds: state.visitedLocationIds,
    mentionedLocationIds: state.mentionedLocationIds,
    transitionIntentLocationId: state.transitionIntentLocationId,
    activeFrontIds: state.activeFrontIds,
    phase: state.tablePhase,
    activeQuestion: state.activeQuestion,
    affordances: state.affordances,
    activeLeads: state.activeLeads,
    clocks: state.clocks,
    party: state.party,
    combat: state.combat,
    lastEncounter: state.lastEncounter,
    difficulty: state.difficulty,
    runLimits: state.runLimits,
    events: state.events,
    modelCallsUsed: state.modelCallsUsed,
    stoppedReason: state.stoppedReason,
    error: state.error
  });
}

function townModuleTableRunSummary(state: TownModuleTableState): Record<string, unknown> {
  return summarizeDomainTableRun(townModuleTableToDomainRunState(state));
}

function architecturePage(): Response {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agent Dungeon Architecture</title>
  <meta name="description" content="Executive summary of the Cloudflare Agent Dungeon runtime architecture.">
  <style>
    @font-face{font-family:Geist;src:url(https://wzrrd.sh/geist-sans-variable.woff2) format("woff2");font-weight:100 900;font-style:normal;font-display:swap}
    @font-face{font-family:Geist Mono;src:url(https://wzrrd.sh/geist-mono-variable.woff2) format("woff2");font-weight:100 900;font-style:normal;font-display:swap}
    *{box-sizing:border-box} body{margin:0;background:#fff;color:#111;font-family:Geist,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-feature-settings:"cv02","cv03","cv04","cv11","ss01"}.page{width:min(1040px,100% - 32px);margin:0 auto;padding:22px 0 72px}.nav{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:72px}.brand{display:inline-flex;align-items:center;gap:9px;color:#111;text-decoration:none;font-weight:650;letter-spacing:-.03em}.glyph{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:#111;color:#ff4fd8;font-weight:800}.links{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}.links a{color:#666;text-decoration:none;border-radius:999px;min-height:34px;padding:0 10px;display:inline-flex;align-items:center;font-size:.88rem}.links a:hover{background:#f5f5f5;color:#111}.eyebrow,.section-label{color:#71717a;text-transform:uppercase;letter-spacing:.08em;font-size:.82rem;font-weight:650;margin:0 0 14px}.hero{max-width:780px}.hero h1{margin:0;max-width:12ch;color:#09090b;font-size:clamp(3.1rem,7.2vw,6.2rem);line-height:.9;letter-spacing:-.055em;font-weight:720;text-wrap:balance}.lede{max-width:62ch;margin:24px 0 0;color:#52525b;font-size:clamp(1.08rem,1.6vw,1.24rem);line-height:1.58;letter-spacing:-.018em;text-wrap:pretty}.command{display:inline-flex;align-items:center;gap:10px;margin-top:28px;padding:10px 12px;border:1px solid #1111111a;border-radius:12px;background:#fafafa;color:#18181b;font-family:Geist Mono,ui-monospace,monospace;font-size:.9rem}.status{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid #1111111a;border-bottom:1px solid #1111111a;margin-top:56px}.status div{padding:16px 18px 16px 0}.status div+div{border-left:1px solid #1111111a;padding-left:18px}.status span{display:block;color:#71717a;font-size:.84rem;margin-bottom:8px}.status strong{font-weight:560;letter-spacing:-.025em}.summary{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);gap:clamp(28px,5vw,56px);margin-top:44px;padding:clamp(22px,4vw,34px);border:1px solid #1111111a;border-radius:22px;background:#fbfbfb}.summary h2,.section h2{margin:0;color:#111;font-size:clamp(1.8rem,3vw,2.65rem);line-height:.98;letter-spacing:-.055em}.summary p,.section p,.section li{color:#52525b;line-height:1.55;letter-spacing:-.015em}.steps{display:grid;gap:10px}.step{display:grid;grid-template-columns:32px minmax(0,1fr);gap:12px;padding:14px;border:1px solid #11111114;border-radius:16px;background:#fff}.step>span{display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:#111;color:#fff;font-weight:700;font-size:.78rem}.step strong{display:block;margin-bottom:6px;letter-spacing:-.025em}.section{margin-top:44px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.card{border:1px solid #11111114;border-radius:16px;padding:16px;background:#fff}.card h3{margin:0 0 8px;font-size:1.02rem;letter-spacing:-.035em}.card p{margin:0}.flow{display:grid;gap:10px;margin-top:16px}.flow div{padding:14px 16px;border:1px solid #11111114;border-radius:14px;background:#fafafa}.flow code, .command code{font-family:Geist Mono,ui-monospace,monospace}.links-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:16px}.links-list a{display:block;padding:13px 14px;border:1px solid #11111114;border-radius:14px;color:#18181b;text-decoration:none;background:#fff}.links-list a span{display:block;color:#71717a;font-size:.86rem;margin-top:4px}.footer{display:flex;justify-content:space-between;gap:16px;margin-top:56px;padding-top:22px;border-top:1px solid #1111111a;color:#71717a;font-size:.9rem}.badge{display:inline-flex;border-radius:999px;background:#111;color:#fff;padding:3px 8px;font-size:.75rem;font-weight:700;letter-spacing:.03em;text-transform:uppercase}a{color:#111}@media(max-width:820px){.page{width:min(100% - 24px,1040px)}.nav{align-items:flex-start;margin-bottom:48px}.hero h1{font-size:clamp(3.2rem,16vw,5.2rem)}.status{grid-template-columns:repeat(2,minmax(0,1fr))}.status div{border-top:1px solid #1111111a;padding:14px 0}.status div:nth-child(-n+2){border-top:0}.status div+div{border-left:0;padding-left:0}.status div:nth-child(2n){border-left:1px solid #1111111a;padding-left:16px}.summary,.grid,.links-list{grid-template-columns:1fr}.footer{flex-direction:column}}
  </style>
</head>
<body>
  <main class="page">
    <nav class="nav" aria-label="Primary"><a class="brand" href="/"><span class="glyph">AD</span><span>Agent Dungeon</span></a><div class="links"><a href="/prototype/town-module-table">Live table</a><a href="/api/prototype/town-module-table-summary">Run summary</a><a href="https://github.com/joelhooks/cloudflare-agent-dungeon">GitHub</a></div></nav>
    <section class="hero"><p class="eyebrow">Cloudflare-native autonomous table</p><h1>Agent Dungeon architecture</h1><p class="lede">A stateful Referee agent runs an ongoing Old School Essentials-inspired campaign on Cloudflare. Adventure source material lives in Artifacts, the Referee owns canonical truth in a Durable Object, Workers AI supplies agent minds, and a WebSocket monitor streams the public table transcript.</p><div class="command"><span>$</span><code>agentdungeon.ai/prototype/town-module-table</code></div></section>
    <section class="status" aria-label="Current production status"><div><span>Production route</span><strong>agentdungeon.ai</strong></div><div><span>Runtime body</span><strong>Referee Durable Object</strong></div><div><span>Adventure source</span><strong>Cloudflare Artifacts</strong></div><div><span>Live monitor</span><strong>WebSocket event stream</strong></div></section>
    <section class="summary"><div><p class="section-label">Executive summary</p><h2>Referee for truth. Agents for play. Events for the audience.</h2><p>The architecture separates authored adventure material from live play. <strong>AdventureModule</strong> describes static source. <strong>TableRun</strong> describes the active session. Player outputs are proposals; only the Referee validates, mutates state, rolls procedure checks, and commits public events.</p></div><div class="steps"><div class="step"><span>1</span><div><strong>Load Fenwater from Artifacts</strong><p>The frozen Town Forge output is read from the artifact repo/commit and adapted into the domain <code>AdventureModule</code>.</p></div></div><div class="step"><span>2</span><div><strong>Run inside the Referee Agent</strong><p>The Durable Object owns compact table state, clocks, party status, combat objectives, and the append-only transcript.</p></div></div><div class="step"><span>3</span><div><strong>Stream public table events</strong><p>The browser receives sanitized table events over the Agent socket. Dev-only identity artifacts and hidden notes are filtered from public output.</p></div></div></div></section>
    <section class="section"><p class="section-label">Runtime components</p><div class="grid"><div class="card"><h3>Worker shell</h3><p>Serves the app, API endpoints, static executive pages, and the WebSocket route for the table monitor.</p></div><div class="card"><h3>Referee Durable Object</h3><p>Single stateful game body. Owns canonical campaign state, hidden pressure, event log, run limits, and recovery.</p></div><div class="card"><h3>Workers AI</h3><p>Configured model slots drive player micro-events, Referee rulings, readiness checks, and maintenance work.</p></div><div class="card"><h3>Artifacts</h3><p>Canonical source for Fenwater Drainage: graph, public projection, Referee notes, and generation receipts.</p></div><div class="card"><h3>R2 runtime cache</h3><p>Stores runtime-addressable module blobs and skills. It is cache/storage, not the source of truth.</p></div><div class="card"><h3>Domain package</h3><p>Pure TypeScript schemas and reducers for AdventureModule, TableRun, events, rulings, locality, and combat objectives.</p></div></div></section>
    <section class="section"><p class="section-label">Control and data flow</p><div class="flow"><div><span class="badge">source</span> <strong>Town Forge Artifacts</strong> → <code>adventureModuleFromFenwaterTownGraph()</code> → <strong>AdventureModule</strong></div><div><span class="badge">runtime</span> <strong>Referee DO</strong> starts a bounded <strong>TableRun</strong>, asks model-backed players for proposals, validates locality/procedure, and commits events.</div><div><span class="badge">monitor</span> <strong>Browser WebSocket</strong> receives public <code>TableEvent</code> rows plus compact state for clocks, party, phase, and encounter/combat status.</div></div></section>
    <section class="section"><p class="section-label">Design guardrails</p><div class="grid"><div class="card"><h3>Fog of war</h3><p>Players see projections, not hidden source. Public monitor shows safe table events, not private Referee notes or raw rules corpus.</p></div><div class="card"><h3>Honest failures</h3><p>Generation/model/runtime failures become visible error rows. No canned demo fallback is presented as live play.</p></div><div class="card"><h3>Small interface first</h3><p>The prototype avoids a generic VTT. It proves one live table loop before widening to more module shapes.</p></div></div></section>
    <section class="section"><p class="section-label">Docs and receipts</p><div class="links-list"><a href="/prototype/town-module-table">Live Town Module Table<span>Watch the production table stream.</span></a><a href="/api/prototype/town-module-table-summary">Current run summary JSON<span>Mode, beat, phase, event counts, combat rows, stop reason.</span></a><a href="https://github.com/joelhooks/cloudflare-agent-dungeon/blob/feat/realtime-agent-dungeon-campaign/packages/domain/src/adventure-module.ts">AdventureModule schema<span>Static authored adventure boundary.</span></a><a href="https://github.com/joelhooks/cloudflare-agent-dungeon/blob/feat/realtime-agent-dungeon-campaign/packages/domain/src/table-run.ts">TableRun schema<span>Runtime table state, events, proposals, rulings, objectives.</span></a><a href="https://github.com/joelhooks/cloudflare-agent-dungeon/blob/feat/realtime-agent-dungeon-campaign/apps/worker/src/adventure-module/fenwater.ts">Fenwater adapter<span>Artifacts graph to domain AdventureModule.</span></a><a href="https://github.com/joelhooks/cloudflare-agent-dungeon/blob/feat/realtime-agent-dungeon-campaign/.brain/projects/town-table-interface-extraction.svx">Interface extraction note<span>Architecture rationale and remaining seams.</span></a></div></section>
    <footer class="footer"><span>Cloudflare Agent Dungeon · production architecture brief</span><span>Worker + Durable Object + Artifacts + Workers AI</span></footer>
  </main>
</body>
</html>`, { headers: { "content-type": "text/html;charset=utf-8", "cache-control": "public, max-age=120" } });
}

function townModuleTableUiPage(): Response {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agent Dungeon — Town Module Table</title>
  <style>
    body{margin:0;background:#050605;color:#eaf8de;font:14px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}header{position:sticky;top:0;z-index:3;background:#0b0f0a;border-bottom:1px solid #2d3a2a;padding:10px 12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}.tag{background:#b7ff5a;color:#050605;font-weight:800;padding:2px 6px;text-transform:uppercase}.muted{color:#8ca184}.dot{width:10px;height:10px;border-radius:99px;background:#ffd166;box-shadow:0 0 12px #ffd166;display:inline-block}.dot.on{background:#b7ff5a;box-shadow:0 0 14px #b7ff5a}.dot.err{background:#ff6b57;box-shadow:0 0 14px #ff6b57}.strip{position:sticky;top:45px;z-index:2;background:#081008;border-bottom:1px solid #21331e;padding:8px 12px;display:grid;grid-template-columns:1fr 1fr 1fr 1.5fr 1.5fr;gap:8px}.strip h2{font-size:10px;color:#8ca184;margin:0 0 2px;text-transform:uppercase}.strip div{min-width:0}.strip p{margin:0;color:#dfffd2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.clockline{color:#ffd166}.partyline{color:#d6a4ff}@media(max-width:900px){.strip{grid-template-columns:1fr 1fr;top:72px}}main{display:grid;grid-template-columns:1fr;gap:0}.event{border-bottom:1px solid #1e2a1b;padding:9px 12px;background:#050605}.event:first-child{background:#091009}.meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;color:#8ca184;font-size:11px;text-transform:uppercase}.lane{background:#6dd3ff;color:#031018;font-weight:800;padding:1px 5px}.lane.referee{background:#b7ff5a}.lane.world{background:#ffd166}.lane.commit{background:#d6a4ff}.lane.error{background:#ff6b57}.lane.artifacts{background:#cfe7c6}.lane.rules{background:#ffef9a}.lane.dice{background:#ffad69}.lane.clock{background:#ff7ab6}.kind{color:#cfe7c6}.speaker{color:#f6ffe9;font-weight:800}p{margin:4px 0 0;white-space:pre-wrap}.thought p{color:#d6a4ff}.event.encounter_start{background:#241008;border-left:8px solid #ff6b57;padding:16px 14px}.event.encounter_start p{font-size:18px;font-weight:900;color:#fff1d6}.event.combat_round{background:#18090b;border-left:8px solid #ffad69}.event.combat_round p{font-size:16px;color:#ffe6cf}.phase-combat{color:#ffad69;font-weight:900}.phase-aftermath{color:#d6a4ff;font-weight:900}.state{margin-left:auto}.empty{padding:32px 12px;color:#8ca184}
  </style>
</head>
<body>
  <header><span class="tag">Town Module Table</span><span id="dot" class="dot"></span><strong>Fenwater Drainage live table</strong><span id="status" class="muted state">connecting…</span></header>
  <section class="strip" id="strip"><div><h2>Phase</h2><p>—</p></div><div><h2>Location</h2><p>—</p></div><div><h2>Clocks</h2><p>—</p></div><div><h2>Leads</h2><p>—</p></div><div><h2>Party</h2><p>—</p></div></section>
  <main id="feed"><div class="empty">Attaching to Referee stream…</div></main>
<script>
const feed=document.getElementById('feed'); const status=document.getElementById('status'); const dot=document.getElementById('dot'); const strip=document.getElementById('strip');
let events=[]; let tableState=null;
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function render(){
  if(tableState){
    const clocks=(tableState.clocks||[]).map(c=>c.name+' '+c.value+'/'+c.max).join(' · ')+' · difficulty '+(tableState.difficulty||1)+'/8';
    const leads=(tableState.activeLeads||[]).slice(0,5).join(' · ');
    const party=(tableState.party||[]).map(p=>p.character+' '+(p.hp??'?')+'hp AC'+(p.armorClass??'?')+' '+((p.inventory||[]).slice(0,2).join('/')||'gear')+' @ '+(p.position||tableState.location||'?')).join(' · ');
    const combat=tableState.combat;
    const last=tableState.lastEncounter;
    const phase=(tableState.tablePhase||'exploration')+(combat?' · '+combat.foe+' HP '+combat.foeHp+'/'+(combat.foeMaxHp||combat.foeHp)+' AC '+combat.foeArmorClass:(last?' · last: '+last.foe+' '+last.outcome+' beat '+last.beat:''));
    const phaseClass=tableState.tablePhase==='combat'?'phase-combat':(tableState.tablePhase==='aftermath'?'phase-aftermath':'');
    strip.innerHTML='<div><h2>Phase</h2><p class="'+phaseClass+'">'+esc(phase)+'</p></div><div><h2>Location</h2><p>'+esc(tableState.location||'—')+'</p></div><div><h2>Clocks</h2><p class="clockline">'+esc(clocks||'—')+'</p></div><div><h2>Leads</h2><p>'+esc(leads||'—')+'</p></div><div><h2>Party</h2><p class="partyline">'+esc(party||'—')+'</p></div>';
  }
  events.sort((a,b)=>Date.parse(b.at||0)-Date.parse(a.at||0));
  feed.innerHTML=events.length?events.map(e=>'<article class="event '+esc(e.kind)+'"><div class="meta"><span class="lane '+esc(e.lane)+'">'+esc(e.lane)+'</span><span class="kind">'+esc(e.kind)+'</span><span class="speaker">'+esc(e.speaker)+'</span><span>beat '+esc(e.beat)+'</span><span>'+new Date(e.at).toLocaleTimeString()+'</span></div><p>'+esc(e.text)+'</p>'+(e.devText?'<p class="muted">'+esc(e.devText)+'</p>':'')+'</article>').join(''):'<div class="empty">Waiting for table events…</div>';
}
function connect(){
  const protocol=location.protocol==='https:'?'wss:':'ws:';
  const ws=new WebSocket(protocol+'//'+location.host+'/agents/referee/town-module-table?monitor=town-table');
  ws.onopen=()=>{status.textContent='connected · server starts/resumes automatically';dot.className='dot on'};
  ws.onclose=()=>{status.textContent='disconnected · retrying';dot.className='dot';setTimeout(connect,1200)};
  ws.onerror=()=>{status.textContent='socket error';dot.className='dot err'};
  ws.onmessage=(msg)=>{const data=JSON.parse(msg.data); if(data.type==='town_table.state'){tableState=data.state; events=data.state.events||events; status.textContent=(data.state.mode||'unknown')+' · beat '+data.state.beat+' · '+(data.state.activeQuestion||''); render();} if(data.type==='town_table.event'){events=[data.event,...events.filter(e=>e.id!==data.event.id)].slice(0,500); render();} if(data.type==='town_table.error'){status.textContent=data.message;dot.className='dot err';}};
}
connect();
</script>
</body>
</html>`, { headers: { "content-type": "text/html;charset=utf-8" } });
}

function monitorPage(): Response {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agent Dungeon Monitor</title>
  <style>
    body { max-width: 1100px; margin: 2rem auto; padding: 0 1rem; font: 18px/1.55 Georgia, serif; }
    button { margin: 0 .5rem .5rem 0; padding: .45rem .7rem; }
    .note { border-left: 4px solid #333; padding-left: .8rem; max-width: 75ch; }
    .dev-only { display: none; }
    body.dev .dev-only { display: inline-block; }
    pre { white-space: pre-wrap; border: 1px solid #ccc; padding: 1rem; background: #fafafa; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    @media (max-width: 800px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <h1>Agent Dungeon Monitor</h1>
  <p>Public table view. Private PlayerAgent secrets are not shown here.</p>
  <p class="note">Honest lanes: Kimi builds character plans and chooses hooks. The Referee engine resolves typed choices with dice and explicit OSE-ish procedure. No canned fallback characters, fake treasure button, or old 3-room demo controls.</p>
  <p>
    <button data-action="/api/create-game">Reset tavern campaign</button>
    <button data-action="/api/session-zero">Ask PlayerAgents: session 0</button>
    <button data-action="/api/choose-adventure">Ask PlayerAgents: choose hook</button>
    <button data-action="/api/travel-to-adventure">Resolve travel by dice</button>
    <button data-action="/api/advance-turn">Advance world clocks</button>
  </p>
  <p id="status">Realtime: connecting...</p>
  <div class="grid">
    <section><h2>Table events</h2><pre id="events">Loading...</pre></section>
    <section><h2>Referee audit</h2><pre id="audit">Loading...</pre></section>
  </div>
  <div class="grid">
    <section><h2>Characters</h2><pre id="characters">Loading...</pre></section>
    <section><h2>World</h2><pre id="world">Loading...</pre></section>
  </div>
  <h2>Campaign JSON</h2>
  <pre id="raw">Loading...</pre>
  <script>
    const status = document.getElementById('status');
    const events = document.getElementById('events');
    const audit = document.getElementById('audit');
    const characters = document.getElementById('characters');
    const world = document.getElementById('world');
    const raw = document.getElementById('raw');
    const nl = String.fromCharCode(10);
    const blankLine = nl + nl;
    const searchParams = new URLSearchParams(location.search);

    const devMode = searchParams.get('dev') === '1';
    const campaignId = searchParams.get('campaign') || 'agent-dungeon-campaign';
    document.body.classList.toggle('dev', devMode);

    function withCampaign(path) {
      const joiner = path.includes('?') ? '&' : '?';
      return path + joiner + 'campaign=' + encodeURIComponent(campaignId);
    }

    async function load(path) {
      try {
        status.textContent = 'Running ' + path + '...';
        const response = await fetch(withCampaign(path));
        const text = await response.text();
        if (!response.ok) throw new Error(text || (response.status + ' ' + response.statusText));
        const data = JSON.parse(text);
        render(data);
        if (devMode && path !== '/api/campaign-dev') {
          const devResponse = await fetch(withCampaign('/api/campaign-dev'));
          const devText = await devResponse.text();
          if (!devResponse.ok) throw new Error(devText || (devResponse.status + ' ' + devResponse.statusText));
          render(JSON.parse(devText));
        }
        status.textContent = 'Realtime: connected';
      } catch (error) {
        status.textContent = 'Error: ' + (error && error.message ? error.message : String(error));
        events.textContent = 'No canned fallback ran. The action failed honestly. Retry or open ?dev=1 for audit.';
      }
    }

    function render(data) {
      events.textContent = data.publicEvents.map(function (event) {
        return '[' + event.kind + '] ' + event.text;
      }).join(blankLine) || 'No public events.';

      const auditEvents = data.refereeAuditEvents || [];
      audit.textContent = auditEvents.map(function (event) {
        return '[PRIVATE/DEV ' + event.kind + '] ' + [event.characterId, event.declaredAction, event.refereeIntent, event.note].filter(Boolean).join(' | ');
      }).join(blankLine) || 'Private Referee audit is hidden on the public monitor. Add ?dev=1 to show the explicitly marked dev audit projection.';

      characters.textContent = Object.values(data.characters).map(function (character) {
        return character.name + ' — level ' + (character.level || 1) + ' ' + (character.className || 'unknown') + ', xp ' + (character.xp || 0) + ', hp ' + character.stats.hp + ', AC ' + character.stats.armorClass + ', food ' + ((character.supplies && character.supplies.rationDays) || 0) + ' day(s), gp ' + (character.goldGp || 0) + ', source ' + (character.creationSource || 'unknown') + nl + 'Inventory: ' + character.inventory.join(', ');
      }).join(blankLine) || 'No characters yet. Run session 0.';

      world.textContent = 'Day ' + data.time.day + ', ' + data.time.watch + nl + 'Party goal: ' + (data.party.chosenHookId || 'none yet') + blankLine + 'Locations:' + nl + Object.values(data.world.locations).map(function (location) {
        return '- ' + location.name + ' (' + location.kind + ')';
      }).join(nl) + blankLine + 'Hooks:' + nl + Object.values(data.hooks).map(function (hook) {
        return '- ' + hook.title + ' [' + hook.status + '] ' + hook.publicSummary;
      }).join(nl) + blankLine + 'Faction clocks:' + nl + Object.values(data.factions).map(function (faction) {
        return '- ' + faction.name + ': ' + faction.clock + '/' + faction.clockMax + ' — ' + faction.publicGoal;
      }).join(nl);

      raw.textContent = JSON.stringify(data, null, 2);
    }

    const source = new EventSource(withCampaign(devMode ? '/events-dev' : '/events'));
    source.addEventListener('campaign', function (event) {
      status.textContent = 'Realtime: connected';
      render(JSON.parse(event.data));
    });
    source.onerror = function () { status.textContent = 'Realtime: reconnecting...'; };

    document.querySelectorAll('[data-action]').forEach(function (button) {
      button.addEventListener('click', function () { load(button.dataset.action); });
    });

    load(devMode ? '/api/campaign-dev' : '/api/campaign');
  </script>
</body>
</html>`, { headers: { "content-type": "text/html;charset=utf-8" } });
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === "/events") return campaignEvents(request, env);
    if (url.pathname === "/events-dev") return campaignEvents(request, env, true);
    if (url.pathname === "/" || url.pathname === "/monitor") return monitorPage();
    if (url.pathname === "/architecture" || url.pathname === "/architecture/cloudflare") return architecturePage();
    if (url.pathname === "/prototype/town-forge") return townForgeUiPage();
    if (url.pathname === "/prototype/town-module-table") return townModuleTableUiPage();
    if (url.pathname === "/prototype/tavern-town" || url.pathname === "/prototype/town-module") return prototypeTavernTownUiPage();

    try {
      const api = await handleApi(request, env);
      if (api) return api;
    } catch (error) {
      if (url.pathname.startsWith("/api/")) {
        return json({ error: url.pathname.startsWith("/api/prototype/") ? publicPrototypeError(error) : String(error) }, { status: 500 });
      }
      throw error;
    }

    return (
      (await routeAgentRequest(request, env)) ??
      new Response("Cloudflare Agent Dungeon prototype. Try /monitor, /api/create-game, /api/session-zero, /api/choose-adventure, or /api/travel-to-adventure.", {
        headers: { "content-type": "text/plain;charset=utf-8" }
      })
    );
  }
} satisfies ExportedHandler<Env>;
