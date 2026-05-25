import { Agent, getAgentByName, routeAgentRequest, type Connection, type ConnectionContext, type WSMessage } from "agents";
import { R2SkillProvider } from "agents/experimental/memory/session";
import { Think, type Session, type TurnConfig, type TurnContext } from "@cloudflare/think";
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
  TownForgeStateSchema,
  TownGraphSchema,
  type ArtifactSyncStatus,
  type TownForgeReceipt,
  type TownForgeState,
  type TownGraph
} from "./town-forge";
import { MemoryFS } from "./memory-fs";
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
  type AdventureChoice,
  type Campaign,
  type Character,
  type CharacterCreationDraft,
  type CharacterCreationPlan,
  type HookId,
  type PlayerId,
  type RefereeOutcome,
  type Store,
  type StoreId
} from "@cloudflare-agent-dungeon/domain";

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

async function artifactCreateToken(repoLike: unknown, initialToken?: unknown): Promise<string> {
  const initial = await artifactMaybeString(initialToken);
  if (initial) return initial;
  const repo = repoLike as { createToken?: (scope?: "write" | "read", ttl?: number) => Promise<{ plaintext?: unknown }> };
  if (typeof repo.createToken === "function") {
    const token = await repo.createToken("write", 900);
    const plaintext = await artifactMaybeString(token.plaintext);
    if (plaintext) return plaintext;
  }
  throw new Error("Artifacts write token was not available from binding result");
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
    brainSummary: "No Referee tavern memories yet.",
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
      chat_template_kwargs: { enable_thinking: false, thinking: false } as any
    }) as unknown as LanguageModel;
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
      submit_referee_beat: tool({
        description: "Submit exactly one resolved tavern/town Referee beat. Required for tavern prototype turns.",
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
        activeTools: ["submit_referee_beat"],
        toolChoice: { type: "tool", toolName: "submit_referee_beat" } as TurnConfig["toolChoice"],
        maxSteps: 2,
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
    if (!stable) throw new Error("RefereeAgent conversation was not stable before tavern setup generation");
    await this.session.refreshSystemPrompt();

    let validationError = "";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await generateObject({
        model: this.getModel(),
        schema: TavernSetupSchema,
        maxOutputTokens: 1500,
        prompt: [
          "Build a fresh opening tavern/town setup for Cloudflare Agent Dungeon.",
          "You are the Referee mind. This is Session 0 / town setup before normal play starts.",
          "Do not reuse The Golden Eel, Hesta Vane, Rook Marlen, Sister Elian, Willowby, blue clay, buried bells, or the prior fixed seed.",
          "Create a bounded open-world tavern/town with 3-5 NPCs, each with a visible role, want, memory, and disposition.",
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
    throw new Error(`Referee tavern setup failed validation: ${validationError}`);
  }

  async generateTavernBeat(context: unknown): Promise<TavernBeat> {
    await ensureThinkSession(this);
    const stable = await this.waitUntilStable({ timeout: 30_000 });
    if (!stable) throw new Error("RefereeAgent conversation was not stable before tavern beat generation");
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
      const promptMessage = userMessage([
        "Generate exactly one table-facing tavern/town beat for Cloudflare Agent Dungeon.",
        "You are the Referee mind. PlayerAgents already chose their intents. Consider those choices directly; do not replace them with your own railroad.",
        "Use the session context blocks named brain and ose_playbooks. The playbooks are source pointers only; never quote rules corpus text.",
        "The town/tavern is the whole open world for now. NPCs want things, remember things, and pressure choices without forcing a quest path.",
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
      return repairTavernBeat(submitted);
    }
    throw new Error(`Referee tavern beat failed validation: ${validationError}`);
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
    brainSummary: "No player tavern memories yet.",
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
      submit_tavern_intent: tool({
        description: "Submit exactly one player tavern/town intent with private goal, fear, and inner monologue. Required for tavern prototype turns.",
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
        activeTools: ["submit_tavern_intent"],
        toolChoice: { type: "tool", toolName: "submit_tavern_intent" } as TurnConfig["toolChoice"],
        maxSteps: 2,
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

  async chooseTavernIntent(context: unknown): Promise<TavernIntent> {
    await ensureThinkSession(this);
    const stable = await this.waitUntilStable({ timeout: 30_000 });
    if (!stable) throw new Error("PlayerAgent conversation was not stable before tavern intent generation");
    await this.session.refreshSystemPrompt();
    const playerId = (context as { playerId: PlayerId }).playerId;
    const member = (context as { member?: { player?: string; character?: string } }).member;
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
      const promptMessage = userMessage([
        "Choose one tavern/town action as a player in an Old School Essentials campaign.",
        "You are a PlayerAgent, not the Referee. You only know the supplied visible state. Do not invent hidden truths.",
        "Use the session context blocks named brain and ose_playbooks. The playbooks are player-safe source pointers only; do not quote rules text.",
        "Narrate your own choice. tableSpeech is what the character says or visibly does at the table. declaredAction is the gameplay intent.",
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

      return {
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
    }

    throw new Error(`PlayerAgent tavern intent failed for ${playerId}: ${validationError}`);
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
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON object in model response");
  return JSON.parse(trimmed.slice(start, end + 1));
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

type RefereeState = Campaign & {
  prototypeTavernTown?: PrototypeTavernTownState;
  prototypeBrainArtifacts?: Partial<Record<AgentBrainRole, AgentBrainArtifactRecord>>;
  prototypeTownForge?: TownForgeState;
};

const PROTOTYPE_TAVERN_GENERATION_LOCK_TIMEOUT_MS = 3 * 60 * 1000;
const TOWN_FORGE_STALE_RUN_TIMEOUT_MS = 45 * 1000;
const TOWN_FORGE_EVENT_HISTORY_LIMIT = 240;

type PrototypeSocketProcessLane = "socket" | "setup" | "player" | "referee" | "rules" | "artifacts" | "state" | "error";

type PrototypeSocketProcessEvent = {
  type: "prototype.process";
  lane: PrototypeSocketProcessLane;
  message: string;
  beat?: number;
  detail?: string;
  status?: "running" | "done" | "error";
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

type PrototypeSocketCommand = {
  type?: string;
  source?: "manual" | "auto" | string;
  allowContinuous?: boolean;
};

type MonitorSocketKind = "tavern-town" | "town-forge";

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

type PrototypeSocketConnectionState = {
  monitorKind?: MonitorSocketKind;
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
  return null;
}

function isPrototypeMonitorSocketRequest(request: Request): boolean {
  return monitorSocketKind(request) !== null;
}

function isTownForgeRawSocketRequest(request: Request, env: Env): boolean {
  const url = new URL(request.url);
  return monitorSocketKind(request) === "town-forge" && url.searchParams.get("raw") === "1" && isPrototypeBrainDevRequest(request, env);
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

export class Referee extends Agent<Env, RefereeState> {
  initialState: RefereeState = seedTavernCampaign("agent-dungeon-campaign");
  private activeTownForgeAbort: AbortController | undefined;
  private activeTownForgeRunId: string | undefined;

  override getConnectionTags(_connection: Connection, ctx: ConnectionContext): string[] {
    const kind = monitorSocketKind(ctx.request);
    if (kind === "town-forge") return isTownForgeRawSocketRequest(ctx.request, this.env) ? ["town-forge-monitor", "town-forge-raw-monitor"] : ["town-forge-monitor"];
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
    connection.setState({ ...(connection.state as PrototypeSocketConnectionState | undefined), monitorKind: kind, prototypeAutoStepsUsed: 0 });
    if (kind === "town-forge") {
      this.sendTownForgeSocketEvent(connection, { type: "town_forge.connected", at: new Date().toISOString(), campaignId: this.name });
      this.sendTownForgeStateTo(connection, isTownForgeRawSocketRequest(ctx.request, this.env) ? "connected-raw-dev" : "connected");
      return;
    }
    this.sendPrototypeSocketEvent(connection, { type: "prototype.connected", at: new Date().toISOString(), campaignId: this.name });
    this.sendPrototypeStateTo(connection, "connected");
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

  private sendPrototypeSocketEvent(connection: Connection, event: PrototypeSocketEvent): void {
    connection.send(JSON.stringify(event));
  }

  private emitPrototypeSocketEvent(event: PrototypeSocketEvent): void {
    const message = JSON.stringify(event);
    for (const connection of this.getConnections("prototype-monitor")) connection.send(message);
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

  private emitPrototypeProcess(lane: PrototypeSocketProcessLane, message: string, options: { beat?: number; detail?: string; status?: PrototypeSocketProcessEvent["status"] } = {}): void {
    const event: PrototypeSocketProcessEvent = {
      type: "prototype.process",
      lane,
      message,
      at: new Date().toISOString(),
      campaignId: this.name
    };
    if (options.beat !== undefined) event.beat = options.beat;
    if (options.detail !== undefined) event.detail = options.detail;
    if (options.status !== undefined) event.status = options.status;
    this.emitPrototypeSocketEvent(event);
  }

  private emitPrototypeError(error: unknown): void {
    const message = publicPrototypeError(error);
    this.emitPrototypeSocketEvent({
      type: "prototype.error",
      message,
      at: new Date().toISOString(),
      campaignId: this.name
    });
    this.emitPrototypeProcess("error", message, { status: "error" });
  }

  private sendTownForgeSocketEvent(connection: Connection, event: TownForgeSocketEvent): void {
    connection.send(JSON.stringify(event));
  }

  private emitTownForgeSocketEvent(event: TownForgeSocketEvent): void {
    const message = JSON.stringify(event);
    for (const connection of this.getConnections("town-forge-monitor")) connection.send(message);
  }

  private emitTownForgeRawChunk(attempt: number, index: number, totalChars: number, chunk: string): void {
    const message = JSON.stringify({
      type: "town_forge.raw_chunk",
      chunk,
      index,
      attempt,
      totalChars,
      at: new Date().toISOString(),
      campaignId: this.name
    } satisfies TownForgeSocketRawChunkEvent);
    for (const connection of this.getConnections("town-forge-raw-monitor")) connection.send(message);
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
  } = {}): void {
    const event: TownForgeSocketProcessEvent = {
      type: "town_forge.process",
      lane,
      message,
      at: new Date().toISOString(),
      campaignId: this.name
    };
    if (options.detail !== undefined) event.detail = options.detail;
    if (options.reasoning !== undefined) event.reasoning = options.reasoning;
    if (options.assetKind !== undefined) event.assetKind = options.assetKind;
    if (options.asset !== undefined) event.asset = options.asset;
    if (options.status !== undefined) event.status = options.status;
    this.appendTownForgeEvent(event);
    this.emitTownForgeSocketEvent(event);
  }

  private emitTownForgeError(error: unknown): void {
    const message = "Town Forge failed. See Wrangler logs for the private error.";
    console.warn("[Referee] town forge failed", error);
    this.emitTownForgeSocketEvent({
      type: "town_forge.error",
      message,
      at: new Date().toISOString(),
      campaignId: this.name
    });
    this.emitTownForgeProcess("error", message, { status: "error" });
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
    return {
      previousMode: state.mode,
      previousError: state.error,
      receiptSummary: state.receipts.map((receipt) => ({ kind: receipt.kind, status: receipt.status, title: receipt.title, summary: receipt.summary })).slice(-12),
      graphDrafts: events
        .filter((event) => event.lane === "graph")
        .slice(0, 40)
        .map((event) => ({ kind: event.assetKind, message: event.message, detail: event.detail, asset: event.asset })),
      recentProcess: events
        .filter((event) => event.lane !== "graph")
        .slice(0, 20)
        .map((event) => ({ lane: event.lane, status: event.status, message: event.message, detail: event.detail }))
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

      this.emitTownForgeProcess("referee", `Workers AI structured stream request submitted (attempt ${attempt}/2).`, {
        status: "running",
        detail: "No stream chunk has been received yet.",
        reasoning: "This is the honest pre-first-byte state: the request is with Workers AI / the provider path, but the runtime has no internal model progress to report until streaming events arrive."
      });

      const heartbeat = setInterval(() => {
        const elapsedSeconds = Math.round((Date.now() - started) / 1000);
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
        abortController.abort("town-forge-generation-timeout");
      }, 90_000);

      try {
        const result = streamObject({
          model: this.townForgeModel(),
          schema: TownGraphSchema,
          maxOutputTokens: 5000,
          abortSignal: abortController.signal,
          prompt: this.townForgeGenerationPrompt(context, generatedAt, validationError),
          onError: ({ error }) => {
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
          if (part.type === "text-delta") {
            textChunks += 1;
            textChars += part.textDelta.length;
            this.emitTownForgeRawChunk(attempt, textChunks, textChars, part.textDelta);
            lastObserved = `text chunks ${textChunks}; streamed JSON characters ${textChars}`;
            if (!firstChunkSeen) {
              firstChunkSeen = true;
              this.emitTownForgeProcess("referee", "First Workers AI JSON chunk received.", {
                status: "running",
                detail: `${part.textDelta.length} character(s) in first chunk.`,
                reasoning: "The provider is now streaming response text. This is not raw chain-of-thought; it is the JSON object stream being assembled by the AI SDK."
              });
            } else if (textChunks % 100 === 0 && Date.now() - lastTextEventAt > 4_000) {
              lastTextEventAt = Date.now();
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
            this.emitTownForgeProcess("validation", "Workers AI stream finished; validating final TownGraph schema.", {
              status: "running",
              detail: lastObserved,
              reasoning: "The provider stream is complete. The next real step is AI SDK/Zod validation of the final object."
            });
          } else if (part.type === "error") {
            lastObserved = `stream error: ${String(part.error)}`;
            this.emitTownForgeProcess("referee", "Workers AI stream returned an error part.", {
              status: "error",
              detail: lastObserved,
              reasoning: "The stream produced an error part before a validated graph existed. The run may still throw through the AI SDK result promise."
            });
          }
        }

        this.emitTownForgeProcess("validation", "Final stream consumed; awaiting structured object.", {
          status: "running",
          detail: lastObserved,
          reasoning: "The text stream has ended. Now the runtime awaits the AI SDK's final object promise and validates it against TownGraph.v1."
        });

        const parsed = TownGraphSchema.parse({
          ...(await result.object),
          schema: "TownGraph.v1",
          sourceSkill: TOWN_FORGE_SKILL_KEY,
          generatedAt
        });
        this.emitTownForgeProcess("validation", "TownGraph.v1 validation passed.", {
          status: "done",
          detail: `${parsed.locations.length} locations · ${parsed.npcs.length} NPC records · ${parsed.rumors.length} rumors · ${parsed.clocks.length} clocks · ${parsed.latentEncounters.length} latent encounters`,
          reasoning: "The final object passed the same Zod schema that protects artifact writes and public projection. Live graph asset events can now be emitted safely."
        });
        return parsed;
      } catch (error) {
        validationError = String(error);
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
      this.emitTownForgeProcess("state", "Town Forge is already running; refusing overlapping request.", { status: "running" });
      this.emitTownForgeState(current, "already-forging");
      return current;
    }

    const isResume = current.mode === "failed";

    await this.deleteSubAgent(RefereeAgent, "town-forge-referee").catch((error) => {
      console.warn("[Referee] town forge could not clear prior child Referee before run", error);
      this.emitTownForgeProcess("state", "Continuing after child Referee cleanup warning; fresh run will fail honestly if state is dirty.", { status: "warning" });
    });

    const runId = this.createTownForgeRunId();
    const forging: TownForgeState = TownForgeStateSchema.parse({
      ...current,
      runId,
      mode: "forging",
      error: undefined,
      receipts: isResume ? current.receipts : [],
      events: isResume ? (current.events ?? []) : [],
      updatedAt: new Date().toISOString()
    });
    this.activeTownForgeRunId = runId;
    this.setState({ ...this.requireRefereeState(), prototypeTownForge: forging });
    this.emitTownForgeState(forging, isResume ? "forge-resumed" : "forge-started");
    this.emitTownForgeProcess("state", isResume ? "Resuming Town Forge from persisted failed state." : "Town Forge started: Referee-only worldbuilding, no players, no character creation.", {
      status: "running",
      ...(isResume ? { detail: `${forging.events.length} persisted event(s), ${forging.receipts.length} receipt(s) carried forward.` } : {}),
      reasoning: isResume
        ? "The previous failed run is treated as recoverable. Existing stream history and public-safe draft graph assets stay visible; reset is the only operation that clears them."
        : "The Referee body is opening a single-flight forge run. It will either produce validated town graph data or fail honestly; no fixtures are allowed."
    });

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
        town = await this.generateTownForgeGraphWithTelemetry({
          campaignId: this.name,
          route: "/prototype/town-forge",
          sourceSkill: TOWN_FORGE_SKILL_KEY,
          ...(isResume ? { resume: this.townForgeResumeContext(current) } : {}),
          constraints: [
            "Referee-only worldbuilding; no PlayerAgents and no character creation.",
            "Use real town graph shape: locations, NPC records, rumors, clocks, latent encounters, public projection.",
            "No factions first-class in this slice.",
            "NPCs are graph records, not separate agents.",
            "Public projection must omit hidden notes and rumor truth states.",
            "No fixtures, canned demo data, or deterministic fake town fallback. Fail honestly if generation fails.",
            "If resuming, reuse the public-safe draft direction from prior persisted events when it is coherent, but still produce a fresh validated TownGraph.v1."
          ]
        }, runId);
        generationReceipt = townForgeReceipt({
          kind: "generation",
          status: "ok",
          title: "Referee generated TownGraph.v1 from a streamed Workers AI object",
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
        const failed: TownForgeState = TownForgeStateSchema.parse({
          schema: "TownForgeState.v1",
          mode: "failed",
          runId: this.name,
          receipts,
          artifacts: { skill: skillArtifact, r2Key: TOWN_FORGE_R2_KEY },
          events: this.getTownForge().events ?? [],
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
        runId: this.name,
        town,
        publicTown: sanitizeTownGraphForMonitor(town),
        receipts: finalReceipts,
        artifacts: {
          skill: skillArtifact,
          town: townArtifact,
          r2Key: TOWN_FORGE_R2_KEY
        },
        events: this.getTownForge().events ?? [],
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
      const failed: TownForgeState = TownForgeStateSchema.parse({
        ...forging,
        mode: "failed",
        events: this.getTownForge().events ?? [],
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

  async setupPrototypeTavernTown(): Promise<PrototypeTavernTownState> {
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
      this.emitPrototypeProcess("referee", "Referee is building the tavern/town opening from rolled table facts.", { beat: 0, status: "running" });
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
    this.setState({ ...this.requireRefereeState(), prototypeTavernTown, prototypeBrainArtifacts: {} });
    this.emitPrototypeState(prototypeTavernTown, "reset");
    return prototypeTavernTown;
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
      const next = needsSetup ? await this.setupPrototypeTavernTown() : await this.runTavernBeat(generating);
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
    this.emitPrototypeProcess("referee", `Preparing beat ${current.beat + 1}: PlayerAgents choose table-visible intents, then Referee resolves them.`, { beat: current.beat + 1, status: "running" });
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
      this.emitPrototypeProcess("player", `${actor} is choosing an intent from the visible table state.`, { beat: current.beat + 1, status: "running" });
      const intent = await player.chooseTavernIntent(this.tavernIntentContext(current, playerId));
      playerIntents.push(intent);
      this.emitPrototypeProcess("player", `${intent.actor}: ${intent.title}`, { beat: current.beat + 1, detail: intent.declaredAction, status: "done" });
    }

    this.emitPrototypeProcess("rules", "Looking up bounded OSE rule receipts for this beat.", { beat: current.beat + 1, status: "running" });
    const receipts = await this.consultPrototypeRules(current);
    this.emitPrototypeProcess("rules", receipts.length ? `Found ${receipts.length} rule receipt(s).` : "No external rule receipts found; continuing with current table context.", { beat: current.beat + 1, detail: receipts.map((receipt) => receipt.id).join(" | "), status: "done" });
    this.emitPrototypeProcess("referee", "Referee is resolving the submitted PlayerAgent intents.", { beat: current.beat + 1, status: "running" });
    const beat = await referee.generateTavernBeat({
      state: { ...current, log: current.log.slice(0, 6) },
      playerIntents,
      ruleReceipts: receipts.map((receipt) => ({ id: receipt.id, docId: receipt.docId, headingPath: receipt.headingPath, snippet: receipt.snippet?.slice(0, 220) }))
    });

    this.emitPrototypeProcess("referee", `${beat.title}`, { beat: current.beat + 1, detail: beat.processReasoning, status: "done" });
    const committed = this.commitTavernBeat(current, beat, playerIntents, receipts);
    const [playerAIntent, playerBIntent] = playerIntents;
    if (!playerAIntent || !playerBIntent) throw new Error("Tavern beat did not produce both player intents");
    const memoryResults = await Promise.allSettled([
      playerA.rememberTavernBeat({ current, committed, intent: playerAIntent, beat, receipts }),
      playerB.rememberTavernBeat({ current, committed, intent: playerBIntent, beat, receipts }),
      referee.rememberTavernBeat({ current, committed, playerIntents, beat, receipts })
    ]);
    for (const result of memoryResults) {
      if (result.status === "rejected") console.warn("[Referee] tavern beat memory update failed", result.reason);
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
    this.setState({
      ...campaign,
      ...(prototypeTavernTown ? { prototypeTavernTown } : {}),
      ...(prototypeBrainArtifacts ? { prototypeBrainArtifacts } : {}),
      ...(prototypeTownForge ? { prototypeTownForge } : {})
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
      const next: RefereeState = {
        ...seedTavernCampaign(this.name),
        ...(existingPrototype ? { prototypeTavernTown: existingPrototype } : {}),
        ...(existingArtifacts ? { prototypeBrainArtifacts: existingArtifacts } : {}),
        ...(existingTownForge ? { prototypeTownForge: existingTownForge } : {})
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
    if (url.pathname === "/prototype/town-forge") return townForgeUiPage();
    if (url.pathname === "/prototype/tavern-town") return prototypeTavernTownUiPage();

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
