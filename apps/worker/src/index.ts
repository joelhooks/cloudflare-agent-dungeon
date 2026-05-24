import { Agent, getAgentByName, routeAgentRequest } from "agents";
import { Think } from "@cloudflare/think";
import { createWorkersAI } from "workers-ai-provider";
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { prototypeTavernTownUiPage } from "./prototype-tavern-town-ui";
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

/**
 * Long-lived referee mind. It reasons over validated player choices and dice
 * receipts, then generates table-safe outcomes while keeping private reasoning
 * in the Referee audit lane.
 */
export class RefereeAgent extends Think<Env> {
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

export class PlayerAgent extends Think<Env> {
  private secrets: string[] = [];

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
        `Private personality/secrets summary available to you only: ${this.privateContextSummary()}`
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
          `Private personality/secrets summary available to you only: ${this.privateContextSummary()}`
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

  private privateContextSummary(): string {
    if (this.secrets.length === 0) return "No private notes.";
    return `${this.secrets.length} private note(s). Use them to shape play, but do not reveal them unless you choose to act on them.`;
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

export class Referee extends Agent<Env, Campaign> {
  initialState: Campaign = seedTavernCampaign("agent-dungeon-campaign");

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

  private commitCampaign(campaign: Campaign): Campaign {
    this.setState(campaign);
    return campaign;
  }

  private requireCampaign(): Campaign {
    if (!this.state || this.state.id !== this.name) {
      return this.commitCampaign(seedTavernCampaign(this.name));
    }
    return this.state;
  }
}

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, {
    headers: { "access-control-allow-origin": "*" },
    ...init
  });
}

async function handleApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return null;

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
