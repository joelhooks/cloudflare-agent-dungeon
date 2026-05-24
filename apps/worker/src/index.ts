import { Agent, getAgentByName, routeAgentRequest } from "agents";
import { Think, type TurnConfig } from "@cloudflare/think";
import { createWorkersAI } from "workers-ai-provider";
import { generateObject, Output, type LanguageModel } from "ai";
import { z } from "zod";
import {
  projectForPlayer,
  rememberSecret,
  resolveRound,
  seedThreeRoomCampaign,
  type ActionProposal,
  type Campaign,
  type CharacterProjection,
  type PlayerId
} from "@cloudflare-agent-dungeon/domain";

const ActionProposalSchema = z.object({
  tableSpeech: z.string().optional(),
  declaredAction: z.string().min(1),
  actionKind: z.enum(["inspect_area", "move_to_location", "hold_position", "interact", "other"]),
  targetRoomId: z.string().optional(),
  refereeIntent: z.string().optional()
});

type ActionProposalOutput = z.infer<typeof ActionProposalSchema>;

/**
 * Long-lived referee mind. Slice one keeps it mostly as a documented seam while
 * the deterministic Referee parent proves the data boundaries first.
 */
export class RefereeAgent extends Think<Env> {
  override getModel(): LanguageModel {
    const workersai = createWorkersAI({ binding: this.env.AI });
    return workersai("@cf/moonshotai/kimi-k2.6", {
      sessionAffinity: this.sessionAffinity
    }) as unknown as LanguageModel;
  }

  override getSystemPrompt(): string {
    return [
      "You are the Old School Essentials Referee mind for Cloudflare Agent Dungeon.",
      "You advise adjudication and narration, but the Referee parent owns canonical truth.",
      "Never reveal hidden room state or player-private secrets unless the Referee parent passes them as table-safe context."
    ].join(" ");
  }
}

/**
 * Long-lived player mind. PlayerAgent represents a player/personality who is
 * roleplaying a separate Character. Private memory lives here, not on Referee.
 */
export class PlayerAgent extends Think<Env> {
  private secrets: string[] = [];
  private pendingActionProposal: ActionProposalOutput | null = null;
  private structuredActionTurn = false;

  override getModel(): LanguageModel {
    const workersai = createWorkersAI({ binding: this.env.AI });
    return workersai("@cf/moonshotai/kimi-k2.6", {
      sessionAffinity: this.sessionAffinity
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

  override beforeTurn(): TurnConfig | void {
    if (!this.structuredActionTurn) return;
    return {
      output: Output.object({ schema: ActionProposalSchema }),
      activeTools: []
    };
  }

  override onStepFinish(event: unknown): void {
    const output = (event as { output?: unknown }).output;
    const parsed = ActionProposalSchema.safeParse(output);
    if (parsed.success) {
      this.pendingActionProposal = parsed.data;
    }
  }

  rememberSecret(note: string): { ok: true } {
    this.secrets = rememberSecret(this.secrets, note);
    return { ok: true };
  }

  listOwnSecrets(): string[] {
    return [...this.secrets];
  }

  proposeAction(projection: CharacterProjection): ActionProposal {
    return this.deterministicAction(projection);
  }

  async proposeActionWithStructuredTurn(projection: CharacterProjection): Promise<ActionProposal> {
    try {
      const result = await generateObject({
        model: this.getModel(),
        schema: ActionProposalSchema,
        prompt: [
          "What do you do?",
          "Return one structured action proposal matching the schema.",
          "Use actionKind for gameplay semantics instead of stuffing mechanics into prose.",
          "Valid actionKind values: inspect_area, move_to_location, hold_position, interact, other.",
          "If moving toward a visible exit, set targetRoomId to that room id.",
          "Do not include player secrets. Use refereeIntent only for Referee-visible intent.",
          `Projection: ${JSON.stringify(projection)}`,
          `Private personality/secrets summary available to you only: ${this.privateContextSummary()}`
        ].join("\n")
      });

      const proposal = result.object;
      return {
        playerId: projection.playerId,
        characterId: projection.characterId,
        ...(proposal.tableSpeech ? { tableSpeech: proposal.tableSpeech } : {}),
        declaredAction: proposal.declaredAction,
        actionKind: proposal.actionKind,
        ...(proposal.targetRoomId ? { targetRoomId: proposal.targetRoomId as `room-${string}` } : {}),
        ...(proposal.refereeIntent ? { refereeIntent: proposal.refereeIntent } : {})
      };
    } catch (error) {
      console.warn("[PlayerAgent] structured action turn failed; using deterministic fallback", error);
      return this.deterministicAction(projection);
    }
  }

  private deterministicAction(projection: CharacterProjection): ActionProposal {
    const cautiousSecret = this.secrets.find((secret) =>
      secret.toLowerCase().includes("osric")
    );

    if (projection.playerId === "player-a") {
      return {
        playerId: projection.playerId,
        characterId: projection.characterId,
        tableSpeech: "Hold up. Let me check the threshold first.",
        declaredAction: "inspect the mossy threshold for traps",
        actionKind: "inspect_area",
        ...(cautiousSecret
          ? { refereeIntent: "I am slowing Osric down without saying I distrust his impulse control." }
          : { refereeIntent: "I am being careful before the party enters." })
      };
    }

    return {
      playerId: projection.playerId,
      characterId: projection.characterId,
      tableSpeech: "Fine, but make it quick. This torch is not getting younger.",
      declaredAction: "hold the torch high and wait for Brindle's signal",
      actionKind: "hold_position"
    };
  }

  private privateContextSummary(): string {
    if (this.secrets.length === 0) return "No private notes.";
    return `${this.secrets.length} private note(s). Use them to shape play, but do not reveal them unless you choose to act on them.`;
  }
}

export class Referee extends Agent<Env> {
  private campaign: Campaign | null = null;

  async createGame(campaignId = this.name): Promise<Campaign> {
    this.campaign = seedThreeRoomCampaign(campaignId);

    // Spawn stable long-lived minds. We do not use per-run facets as identity.
    await this.subAgent(RefereeAgent, "referee");
    await this.subAgent(PlayerAgent, "player-a");
    await this.subAgent(PlayerAgent, "player-b");

    return this.campaign;
  }

  getCampaign(): Campaign {
    return this.requireCampaign();
  }

  getProjection(playerId: PlayerId) {
    return projectForPlayer(this.requireCampaign(), playerId);
  }

  async seedPlayerPrivateMemoryForDemo(): Promise<{ ok: true }> {
    const player = await this.subAgent(PlayerAgent, "player-a");
    await player.rememberSecret("I suspect Osric will charge ahead and get us killed.");
    return { ok: true };
  }

  resolveRound(proposals: ActionProposal[]): Campaign {
    this.campaign = resolveRound(this.requireCampaign(), proposals);
    return this.campaign;
  }

  async runDemoRound(): Promise<Campaign> {
    if (!this.campaign) await this.createGame(this.name);
    return this.resolveRound([
      {
        playerId: "player-a",
        characterId: "character-brindle",
        tableSpeech: "Hold up. Something smells wrong.",
        declaredAction: "inspect the mossy threshold for traps",
        actionKind: "inspect_area",
        refereeIntent: "I want to catch danger before Osric notices I am worried."
      },
      {
        playerId: "player-b",
        characterId: "character-osric",
        tableSpeech: "I was born ready.",
        declaredAction: "raise the torch and wait for Brindle's signal",
        actionKind: "hold_position"
      }
    ]);
  }

  async runPlayerIntentRound(): Promise<Campaign> {
    if (!this.campaign) await this.createGame(this.name);

    const playerA = await this.subAgent(PlayerAgent, "player-a");
    const playerB = await this.subAgent(PlayerAgent, "player-b");

    const proposals = await Promise.all([
      playerA.proposeAction(projectForPlayer(this.requireCampaign(), "player-a")),
      playerB.proposeAction(projectForPlayer(this.requireCampaign(), "player-b"))
    ]);

    return this.resolveRound(proposals);
  }

  async runLivePlayerIntentRound(): Promise<Campaign> {
    if (!this.campaign) await this.createGame(this.name);

    const playerA = await this.subAgent(PlayerAgent, "player-a");
    const playerB = await this.subAgent(PlayerAgent, "player-b");

    const proposals = await Promise.all([
      playerA.proposeActionWithStructuredTurn(projectForPlayer(this.requireCampaign(), "player-a")),
      playerB.proposeActionWithStructuredTurn(projectForPlayer(this.requireCampaign(), "player-b"))
    ]);

    return this.resolveRound(proposals);
  }

  override async onBeforeSubAgent(_request: Request, child: { className: string; name: string }): Promise<Response | void> {
    const allowed =
      (child.className === "RefereeAgent" && child.name === "referee") ||
      (child.className === "PlayerAgent" && (child.name === "player-a" || child.name === "player-b"));

    if (!allowed || !this.hasSubAgent(child.className, child.name)) {
      return new Response("Not found", { status: 404 });
    }
  }

  private requireCampaign(): Campaign {
    if (!this.campaign) {
      this.campaign = seedThreeRoomCampaign(this.name);
    }
    return this.campaign;
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

  const campaignId = url.searchParams.get("campaign") ?? "demo-campaign";
  const referee = await getAgentByName(env.Referee, campaignId);

  if (url.pathname === "/api/create-game") {
    return json(await referee.createGame(campaignId));
  }
  if (url.pathname === "/api/projection/player-a") {
    return json(await referee.getProjection("player-a"));
  }
  if (url.pathname === "/api/projection/player-b") {
    return json(await referee.getProjection("player-b"));
  }
  if (url.pathname === "/api/demo-round") {
    return json(await referee.runDemoRound());
  }
  if (url.pathname === "/api/seed-player-secret") {
    return json(await referee.seedPlayerPrivateMemoryForDemo());
  }
  if (url.pathname === "/api/player-intent-round") {
    return json(await referee.runPlayerIntentRound());
  }
  if (url.pathname === "/api/live-player-intent-round") {
    return json(await referee.runLivePlayerIntentRound());
  }
  if (url.pathname === "/api/campaign") {
    return json(await referee.getCampaign());
  }

  return json({ error: "Not found" }, { status: 404 });
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
    pre { white-space: pre-wrap; border: 1px solid #ccc; padding: 1rem; background: #fafafa; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    @media (max-width: 800px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <h1>Agent Dungeon Monitor</h1>
  <p>Public table view. Private PlayerAgent secrets are not shown here.</p>
  <p>
    <button data-action="/api/create-game">Reset</button>
    <button data-action="/api/seed-player-secret">Seed player secret</button>
    <button data-action="/api/live-player-intent-round">Run live Kimi round</button>
    <button data-action="/api/player-intent-round">Run deterministic round</button>
  </p>
  <div class="grid">
    <section><h2>Table events</h2><pre id="events">Loading...</pre></section>
    <section><h2>Referee audit</h2><pre id="audit">Loading...</pre></section>
  </div>
  <h2>Campaign JSON</h2>
  <pre id="raw">Loading...</pre>
  <script>
    const events = document.getElementById('events');
    const audit = document.getElementById('audit');
    const raw = document.getElementById('raw');

    async function load(path) {
      const response = await fetch(path);
      const data = await response.json();
      render(data);
    }

    function render(data) {
      events.textContent = data.publicEvents.map(function (event) {
        return '[' + event.kind + '] ' + event.text;
      }).join('\n\n') || 'No public events.';

      audit.textContent = data.refereeAuditEvents.map(function (event) {
        return '[' + event.kind + '] ' + [event.characterId, event.declaredAction, event.refereeIntent, event.note].filter(Boolean).join(' | ');
      }).join('\n\n') || 'No private Referee audit events.';

      raw.textContent = JSON.stringify(data, null, 2);
    }

    document.querySelectorAll('[data-action]').forEach(function (button) {
      button.addEventListener('click', function () { load(button.dataset.action); });
    });

    load('/api/create-game');
  </script>
</body>
</html>`, { headers: { "content-type": "text/html;charset=utf-8" } });
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/monitor") return monitorPage();

    const api = await handleApi(request, env);
    if (api) return api;

    return (
      (await routeAgentRequest(request, env)) ??
      new Response("Cloudflare Agent Dungeon prototype. Try /monitor, /api/create-game, /api/seed-player-secret, /api/player-intent-round, or /api/live-player-intent-round.", {
        headers: { "content-type": "text/plain;charset=utf-8" }
      })
    );
  }
} satisfies ExportedHandler<Env>;
