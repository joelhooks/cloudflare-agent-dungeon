import { Agent, getAgentByName, routeAgentRequest } from "agents";
import { Think, type Session, type TurnConfig, type TurnContext } from "@cloudflare/think";
import { createWorkersAI } from "workers-ai-provider";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { Output, generateObject, tool, type LanguageModel, type ToolSet, type UIMessage } from "ai";
import { z } from "zod";
import {
  initialPrototypeState,
  prototypeTavernTownUiPage,
  type PrototypeTavernTownState
} from "./prototype-tavern-town-ui";
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

type TavernBeat = z.infer<typeof TavernBeatSchema>;

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
  lastSubmittedTavernBeat?: TavernBeat & { at: string; requestBeat?: number };
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
      "Never reveal hidden faction agendas, private Referee notes, rules corpus text, or player-private secrets in publicNarration. Keep that in privateReasoning."
    ].join(" ");
  }

  override configureSession(session: Session): Session {
    return session
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
      })
    };
  }

  override beforeTurn(_ctx: TurnContext): TurnConfig | void {
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
    try {
      const prompt = [
        "Create your own level 1 Old School Essentials character for session 0.",
        "Return compact JSON only. No markdown. No prose.",
        "Shape: {\"name\":string,\"className\":\"fighter|cleric|magic-user|thief|dwarf|elf|halfling\",\"abilitySwap\":{\"first\":ability,\"second\":ability},\"alignment\":\"lawful|neutral|chaotic\",\"deity\":string optional,\"reasonExceptional\":string,\"innerMonologue\":string,\"goal\":string,\"fear\":string,\"purchases\":[{\"itemId\":string,\"quantity\":number}]}",
        "Use the rolled abilities and starting gold exactly as provided.",
        "You may make at most one ability score swap.",
        "Buy starting gear manually from available item ids. Food, light, containers, and tools matter.",
        "Do not buy more than the rolled starting gold can afford.",
        `Draft: ${JSON.stringify(draft)}`,
        `Available items: ${compactStoreCatalog(stores)}`,
        `Private brain summary available to you only: ${this.privateContextSummary()}`
      ].join("\n");
      const result = await this.env.AI.run("@cf/moonshotai/kimi-k2.6", {
        messages: [{ role: "user", content: prompt }],
        chat_template_kwargs: { thinking: false, enable_thinking: false },
        reasoning_effort: null,
        max_completion_tokens: 900
      });
      return toCharacterCreationPlan(draft.playerId, CharacterCreationPlanSchema.parse(parseJsonObject(extractWorkersAIText(result))));
    } catch (error) {
      console.warn("[PlayerAgent] character creation failed; no canned fallback", error);
      throw new Error(`PlayerAgent character creation failed for ${draft.playerId}: ${String(error)}`);
    }
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

type RefereeState = Campaign & {
  prototypeTavernTown?: PrototypeTavernTownState;
  prototypeBrainArtifacts?: Partial<Record<AgentBrainRole, AgentBrainArtifactRecord>>;
};

const PROTOTYPE_TAVERN_GENERATION_LOCK_TIMEOUT_MS = 3 * 60 * 1000;

function hasFreshPrototypeGenerationLock(state: PrototypeTavernTownState): boolean {
  if (state.mode !== "generating") return false;
  const startedAt = Date.parse(state.updatedAt ?? "");
  return Number.isFinite(startedAt) && Date.now() - startedAt < PROTOTYPE_TAVERN_GENERATION_LOCK_TIMEOUT_MS;
}

export class Referee extends Agent<Env, RefereeState> {
  initialState: RefereeState = seedTavernCampaign("agent-dungeon-campaign");

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

  getPrototypeTavernTown(): PrototypeTavernTownState {
    const state = this.requireRefereeState();
    if (!state.prototypeTavernTown) {
      const prototypeTavernTown = initialPrototypeState();
      this.setState({ ...state, prototypeTavernTown });
      return prototypeTavernTown;
    }
    return state.prototypeTavernTown;
  }

  resetPrototypeTavernTown(): PrototypeTavernTownState {
    const prototypeTavernTown = initialPrototypeState();
    this.setState({ ...this.requireRefereeState(), prototypeTavernTown });
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
      if (hasFreshPrototypeGenerationLock(current)) return current;
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

    try {
      const next = await this.runTavernBeat(generating);
      this.setState({ ...this.requireRefereeState(), prototypeTavernTown: next });
      return next;
    } catch (error) {
      const failed: PrototypeTavernTownState = {
        ...generating,
        mode: "failed",
        error: String(error),
        updatedAt: new Date().toISOString()
      };
      this.setState({ ...this.requireRefereeState(), prototypeTavernTown: failed });
      throw error;
    }
  }

  async runTavernBeat(current: PrototypeTavernTownState): Promise<PrototypeTavernTownState> {
    const playerA = await this.subAgent(PlayerAgent, "player-a");
    const playerB = await this.subAgent(PlayerAgent, "player-b");
    const referee = await this.subAgent(RefereeAgent, "referee");
    const playerEntries = [
      ["player-a", playerA],
      ["player-b", playerB]
    ] as const;

    const playerIntents: TavernIntent[] = [];
    for (const [playerId, player] of playerEntries) {
      playerIntents.push(await player.chooseTavernIntent(this.tavernIntentContext(current, playerId)));
    }

    const receipts = await this.consultPrototypeRules(current);
    const beat = await referee.generateTavernBeat({
      state: { ...current, log: current.log.slice(0, 6) },
      playerIntents,
      ruleReceipts: receipts.map((receipt) => ({ id: receipt.id, docId: receipt.docId, headingPath: receipt.headingPath, snippet: receipt.snippet?.slice(0, 220) }))
    });

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

    const playerAState = memoryResults[0]?.status === "fulfilled" ? memoryResults[0].value : (await playerA.getBrainDebug()).state;
    const playerBState = memoryResults[1]?.status === "fulfilled" ? memoryResults[1].value : (await playerB.getBrainDebug()).state;
    const refereeState = memoryResults[2]?.status === "fulfilled" ? memoryResults[2].value : (await referee.getBrainDebug()).state;
    await this.syncPrototypeBrainArtifacts(committed, { playerA: playerAState, playerB: playerBState, referee: refereeState }).catch((error) => {
      console.warn("[Referee] artifact brain sync failed", error);
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
    this.setState({
      ...campaign,
      ...(prototypeTavernTown ? { prototypeTavernTown } : {}),
      ...(prototypeBrainArtifacts ? { prototypeBrainArtifacts } : {})
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
      const next: RefereeState = {
        ...seedTavernCampaign(this.name),
        ...(existingPrototype ? { prototypeTavernTown: existingPrototype } : {}),
        ...(existingArtifacts ? { prototypeBrainArtifacts: existingArtifacts } : {})
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

  if (url.pathname === "/api/prototype/tavern-town-state") {
    const referee = await getAgentByName(env.Referee, "tavern-town-prototype");
    return json({ state: await referee.getPrototypeTavernTown() });
  }
  if (url.pathname === "/api/prototype/tavern-town-reset") {
    if (request.method !== "POST") return json({ error: "POST only" }, { status: 405 });
    const referee = await getAgentByName(env.Referee, "tavern-town-prototype");
    return json({ state: await referee.resetPrototypeTavernTown() });
  }
  if (url.pathname === "/api/prototype/tavern-town-beat") {
    if (request.method !== "POST") return json({ error: "POST only" }, { status: 405 });
    const referee = await getAgentByName(env.Referee, "tavern-town-prototype");
    const prototypeState: PrototypeTavernTownState = await referee.stepPrototypeTavernTown();
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
    if (url.pathname === "/prototype/tavern-town") return prototypeTavernTownUiPage();

    try {
      const api = await handleApi(request, env);
      if (api) return api;
    } catch (error) {
      if (url.pathname.startsWith("/api/")) {
        return json({ error: String(error) }, { status: 500 });
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
