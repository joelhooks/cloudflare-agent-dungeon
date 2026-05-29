// PROTOTYPE — FROZEN TOWN MODULE LIVE MONITOR
// Question: does a raw live log make the frozen town module feel like autonomous OSE play?
// Assumption: state persists server-side in one Referee Agent; the browser is only a monitor/control surface.
// Run with: pnpm --filter @cloudflare-agent-dungeon/worker dev
// Open: /prototype/town-module?variant=log&dev=1
// Delete or absorb after Joel picks the useful shape.

import { z } from "zod";

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
  inventory: z.array(z.string()),
  abilities: z.object({
    strength: z.number().int(),
    intelligence: z.number().int(),
    wisdom: z.number().int(),
    dexterity: z.number().int(),
    constitution: z.number().int(),
    charisma: z.number().int()
  }).optional(),
  hp: z.number().int().optional(),
  armorClass: z.number().int().optional(),
  className: z.string().optional(),
  goldGp: z.number().int().optional()
});

const PrototypeStateSchema = z.object({
  mode: z.string(),
  beat: z.number().int().nonnegative(),
  location: z.string(),
  premise: z.string(),
  npcs: z.array(PrototypeNpcSchema),
  party: z.array(PrototypePartyMemberSchema),
  affordances: z.array(z.string()),
  visibleThreads: z.array(z.string()),
  ruleReceipts: z.array(z.string()),
  log: z.array(z.unknown()).optional()
});

type PrototypeState = z.infer<typeof PrototypeStateSchema>;

export type PrototypeTavernTownState = PrototypeState & {
  log: unknown[];
  processEvents?: unknown[];
  updatedAt?: string;
  error?: string;
};

const GeneratedBeatCandidateSchema = z.object({
  lane: z.enum(["referee", "player", "npc", "rules", "audit"]),
  actor: z.string(),
  title: z.string(),
  tableText: z.string(),
  processReasoning: z.string(),
  devReasoning: z.string(),
  nextAffordances: z.array(z.string()).min(1),
  visibleThreads: z.array(z.string()).min(1),
  npcUpdates: z.array(PrototypeNpcSchema).optional(),
  partyUpdates: z.array(PrototypePartyMemberSchema).optional(),
  rulesUsed: z.array(z.string()).optional()
});

const GeneratedBeatSchema = GeneratedBeatCandidateSchema.extend({
  nextAffordances: z.array(z.string()).min(3).max(7),
  visibleThreads: z.array(z.string()).min(1).max(7)
});

type GeneratedBeat = z.infer<typeof GeneratedBeatSchema>;
type GeneratedBeatCandidate = z.infer<typeof GeneratedBeatCandidateSchema>;

const PrototypePlayerIntentSchema = z.object({
  player: z.string(),
  character: z.string(),
  actor: z.string(),
  title: z.string(),
  tableSpeech: z.string(),
  declaredAction: z.string(),
  intentKind: z.enum(["talk", "ask", "buy", "hire", "observe", "reveal_backstory", "leave", "wait", "other"]),
  target: z.string().optional(),
  processReasoning: z.string(),
  innerMonologue: z.string(),
  privateGoal: z.string(),
  privateFear: z.string()
});

type PrototypePlayerIntent = z.infer<typeof PrototypePlayerIntentSchema>;

type RuleReceipt = {
  id: string;
  docId: string;
  chunkIndex?: number;
  headingPath?: string[];
  snippet?: string;
};

export async function advancePrototypeTavernTownState(env: Env, currentState: PrototypeTavernTownState): Promise<PrototypeTavernTownState> {
  const state = PrototypeStateSchema.parse(currentState) as PrototypeTavernTownState;
  const receipts = await consultPrototypeRules(state);
  const playerIntents = await generatePrototypePlayerIntents(env, state);
  const generated = await generatePrototypeBeat(env, state, receipts, playerIntents);
  return {
    ...applyGeneratedBeat(state, generated, receipts, playerIntents),
    updatedAt: new Date().toISOString()
  };
}

export function prototypeTavernTownUiPage(): Response {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PROTOTYPE — Town Module Live Log</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;700;800&display=swap');
    :root {
      --bg: #070807;
      --panel: #0e110f;
      --panel2: #141812;
      --ink: #eaf8de;
      --muted: #8ca184;
      --line: #2d3a2a;
      --hot: #b7ff5a;
      --amber: #ffd166;
      --red: #ff6b57;
      --blue: #6dd3ff;
      --violet: #d6a4ff;
      --grid: rgba(183, 255, 90, .08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--ink);
      background:
        linear-gradient(var(--grid) 1px, transparent 1px),
        linear-gradient(90deg, var(--grid) 1px, transparent 1px),
        radial-gradient(circle at 70% 10%, rgba(183,255,90,.12), transparent 28rem),
        var(--bg);
      background-size: 22px 22px, 22px 22px, auto, auto;
      font: 15px/1.5 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
      letter-spacing: -.02em;
    }
    button, select {
      font: inherit;
      color: var(--ink);
      background: var(--panel2);
      border: 1px solid var(--hot);
      padding: .55rem .72rem;
      text-transform: uppercase;
      box-shadow: 0 0 0 1px rgba(183,255,90,.14), 0 0 18px rgba(183,255,90,.08);
      cursor: pointer;
    }
    button:disabled { color: var(--muted); border-color: var(--line); cursor: not-allowed; box-shadow: none; }
    button:hover:not(:disabled), select:hover { background: #1b2418; }
    .shell { width: min(1500px, calc(100vw - 28px)); margin: 0 auto; padding: 18px 0 92px; }
    .topbar, .bottombar {
      border: 1px solid var(--line);
      background: rgba(14,17,15,.92);
      padding: 10px;
      display: flex;
      gap: 10px;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.02);
    }
    h1 { margin: 0; font-size: clamp(1.7rem, 4vw, 4.6rem); line-height: .88; letter-spacing: -.08em; text-transform: uppercase; }
    h2 { margin: 0 0 8px; color: var(--hot); font-size: .82rem; letter-spacing: .12em; text-transform: uppercase; }
    .tag { color: var(--bg); background: var(--hot); padding: .14rem .42rem; font-weight: 800; text-transform: uppercase; }
    .muted { color: var(--muted); }
    .hero { display: grid; grid-template-columns: minmax(0, 1fr) minmax(360px, .7fr); gap: 14px; margin: 14px 0; align-items: stretch; }
    .panel { border: 1px solid var(--line); background: rgba(14,17,15,.91); padding: 14px; min-width: 0; }
    .controls { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .cost-guard { display: flex; gap: 8px; align-items: center; margin-top: 10px; color: var(--amber); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    .status { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; color: var(--muted); }
    .mode { color: var(--bg); background: var(--amber); padding: .12rem .45rem; font-weight: 800; }
    .app { display: grid; gap: 14px; }
    body.variant-console .app { grid-template-columns: minmax(0, 1.25fr) minmax(340px, .75fr); }
    body.variant-split .app { grid-template-columns: minmax(340px, .7fr) minmax(0, 1fr) minmax(320px, .65fr); }
    body.variant-map .app { grid-template-columns: minmax(0, 1fr) minmax(420px, .75fr); }
    .feed { display: flex; flex-direction: column; gap: 10px; }
    .turn {
      border: 1px solid var(--line);
      background: linear-gradient(180deg, rgba(20,24,18,.96), rgba(10,12,10,.96));
      padding: 12px;
      position: relative;
      overflow: hidden;
    }
    .turn:first-child { border-color: var(--hot); box-shadow: 0 0 0 1px rgba(183,255,90,.25), 0 0 34px rgba(183,255,90,.08); }
    .turn:before { content: ''; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(90deg, rgba(183,255,90,.08), transparent 24%); opacity: .55; }
    .meta { position: relative; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; color: var(--muted); font-size: .78rem; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 8px; }
    .lane { color: var(--bg); background: var(--blue); padding: .1rem .4rem; font-weight: 800; }
    .lane.referee { background: var(--hot); }
    .lane.player { background: var(--blue); }
    .lane.npc { background: var(--amber); }
    .lane.setup { background: var(--violet); }
    .lane.rules { background: var(--violet); }
    .lane.artifacts { background: var(--amber); }
    .lane.socket, .lane.state { background: #cfe7c6; }
    .lane.error { background: var(--red); }
    .lane.audit { background: var(--red); }
    .lane.cot { background: #1c2a16; color: #d9ffa7; box-shadow: inset 0 0 0 1px var(--hot); }
    .turn.cot { background: #07100a; border-color: #18331a; }
    .turn.cot h3 { color: #b9ffa1; font-size: .85rem; }
    .turn.cot.kind-text h3 { color: #ffdb8b; }
    .turn.cot .delta { font: 12px/1.45 'Geist Mono', ui-monospace, monospace; color: #cfe7c6; white-space: pre-wrap; word-break: break-word; }
    .turn.cot.kind-text .delta { color: #ffe6b5; }
    .turn h3 { position: relative; margin: 0 0 6px; font-size: 1.06rem; color: #f6ffe9; text-transform: uppercase; letter-spacing: -.02em; }
    .turn p { position: relative; margin: 0; }
    .turn.live { border-style: dashed; background: linear-gradient(180deg, rgba(21,28,17,.96), rgba(8,10,8,.96)); }
    .turn.live.done { opacity: .78; }
    .turn.live.error { border-color: var(--red); }
    .reason { position: relative; margin-top: 10px; padding: 9px 10px; border-left: 2px solid var(--hot); background: rgba(183,255,90,.05); color: #bdd3b4; }
    .dev { border-left-color: var(--red); color: #d9aaa1; }
    .stack { display: grid; gap: 14px; align-content: start; }
    .kv { display: grid; gap: 8px; }
    .row { border: 1px solid var(--line); background: rgba(255,255,255,.02); padding: 9px; }
    .row strong { color: #f6ffe9; display: block; }
    .row span { color: var(--muted); }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; color: #cfe7c6; font: 12px/1.45 'Geist Mono', ui-monospace, monospace; }
    .mapbox { min-height: 430px; position: relative; overflow: hidden; background: radial-gradient(circle at 50% 50%, rgba(183,255,90,.12), transparent 11rem), #080908; }
    .node { position: absolute; border: 1px solid var(--hot); background: #10150f; padding: 10px; width: 160px; box-shadow: 0 0 24px rgba(183,255,90,.1); }
    .node small { color: var(--muted); }
    .n1 { left: 7%; top: 12%; } .n2 { right: 8%; top: 16%; } .n3 { left: 38%; top: 48%; } .n4 { right: 18%; bottom: 10%; }
    .variant-console .map-only, .variant-console .split-only { display: none; }
    .variant-split .map-only { display: none; }
    .variant-map .split-only { display: none; }
    body.variant-log { background: #050605; font-size: 13px; }
    .variant-log .hero, .variant-log .map-only, .variant-log .split-only, .variant-log .app > .stack:last-child { display: none; }
    .variant-log .shell { width: 100vw; padding: 0 0 72px; }
    .variant-log .topbar { border-width: 0 0 1px; position: sticky; top: 0; z-index: 10; align-items: stretch; }
    .logbar { display: none; }
    .variant-log .logbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; width: 100%; }
    .live-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--red); box-shadow: 0 0 12px var(--red); display: inline-block; }
    .live-dot.on { background: var(--hot); box-shadow: 0 0 14px var(--hot); }
    .live-dot.busy { background: var(--amber); box-shadow: 0 0 14px var(--amber); }
    .log-status { color: var(--muted); flex: 1; min-width: 260px; }
    .variant-log .app { display: block; }
    .variant-log .panel { border: 0; padding: 0; background: transparent; }
    .variant-log h2 { padding: 8px 10px; margin: 0; border-bottom: 1px solid var(--line); background: #070807; }
    .variant-log .feed { gap: 0; flex-direction: column; }
    .variant-log .turn { border-width: 0 0 1px; padding: 7px 10px; background: #050605; box-shadow: none; }
    .variant-log .turn:first-child { border-color: var(--line); box-shadow: none; }
    .variant-log .turn:before { display: none; }
    .variant-log .turn h3 { font-size: .9rem; margin: 0 0 2px; text-transform: none; color: var(--ink); }
    .variant-log .turn p, .variant-log .reason { font-size: 12px; margin-top: 3px; padding: 0; border: 0; background: transparent; color: #aac4a2; }
    .variant-log .meta { margin-bottom: 2px; font-size: 10px; }
    .switcher { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 20; display: flex; gap: 8px; background: rgba(7,8,7,.95); border: 1px solid var(--hot); padding: 8px; box-shadow: 0 0 35px rgba(183,255,90,.13); }
    .switcher a { color: var(--ink); text-decoration: none; padding: .42rem .62rem; border: 1px solid var(--line); text-transform: uppercase; }
    .switcher a.active { color: var(--bg); background: var(--hot); border-color: var(--hot); font-weight: 800; }
    @media (max-width: 1100px) { .hero, body.variant-console .app, body.variant-split .app, body.variant-map .app { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main class="shell">
    <div class="topbar"><span class="tag">Prototype / wipe me</span><span class="muted">Frozen Town Module playtest · Referee-owned truth · player-safe projections · newest event first</span><div class="logbar"><span id="liveDot" class="live-dot"></span><strong>Agent Dungeon Town Module Log</strong><button id="logRun">Run</button><button id="logPause">Pause</button><button id="logReset">Reset</button><span id="logStatus" class="log-status">connecting…</span></div></div>
    <section class="hero">
      <div class="panel">
        <h1>Town Module Console</h1>
        <p class="muted">Frozen town module playtest. The Referee owns module truth, PlayerAgents receive only projections, and the daemon advances table beats through the town instead of a scripted plot.</p>
      </div>
      <div class="panel">
        <h2>World daemon</h2>
        <div class="controls">
          <button id="start">Start World</button>
          <button id="pause" disabled>Pause</button>
          <button id="step">Step One Beat</button>
          <button id="reset">Reset Server Game</button>
          <select id="speed"><option value="7000">slow</option><option value="4200" selected>table pace</option><option value="1800">fast skim</option></select>
        </div>
        <label class="cost-guard"><input id="allowContinuous" type="checkbox"> allow continuous $$$ autoplay</label>
        <p class="status"><span class="mode" id="mode">idle</span><span id="statusText">Server state loading. Start World first runs setup, then is capped at 3 AI beats unless continuous autoplay is explicitly enabled.</span></p>
      </div>
    </section>

    <section class="app">
      <section class="panel mapbox map-only">
        <h2>Town graph</h2>
        <div class="node n1"><strong>Golden Eel</strong><br><small>table, debts, rumor</small></div>
        <div class="node n2"><strong>Archmarket</strong><br><small>gear, scarcity, gossip</small></div>
        <div class="node n3"><strong>Old Shrine</strong><br><small>omens, healing, bells</small></div>
        <div class="node n4"><strong>Retainer Board</strong><br><small>help with a price</small></div>
      </section>

      <section class="stack split-only">
        <div class="panel"><h2>NPC memory</h2><div class="kv" id="npcs"></div></div>
        <div class="panel"><h2>Party</h2><div class="kv" id="party"></div></div>
      </section>

      <section class="stack">
        <div class="panel"><h2>Process stream</h2><div class="feed" id="feed"></div></div>
      </section>

      <section class="stack">
        <div class="panel"><h2>Affordances now</h2><div class="kv" id="affordances"></div></div>
        <div class="panel"><h2>Rule receipts</h2><div class="kv" id="receipts"></div></div>
        <div class="panel"><h2>Visible state</h2><pre id="state"></pre></div>
      </section>
    </section>
  </main>

  <nav class="switcher" aria-label="Prototype variants">
    <a data-variant="console" href="?variant=console">console</a>
    <a data-variant="split" href="?variant=split">split</a>
    <a data-variant="map" href="?variant=map">map</a>
    <a data-variant="log" href="?variant=log&dev=1">raw log</a>
  </nav>

  <script>
    const params = new URLSearchParams(location.search);
    const variant = params.get('variant') || 'console';
    const devMode = params.get('dev') === '1';
    document.body.classList.add('variant-' + variant);
    document.querySelectorAll('[data-variant]').forEach(function (link) { link.classList.toggle('active', link.dataset.variant === variant); });

    let state = ${JSON.stringify(initialPrototypeState())};
    const DEFAULT_AUTO_BEAT_LIMIT = 3;
    let timer = null;
    let socket = null;
    let reconnectTimer = null;
    let socketReady = false;
    let busy = false;
    let autoRunning = false;
    let autoBeatsRemaining = 0;
    let liveEvents = [];
    const start = document.getElementById('start');
    const pause = document.getElementById('pause');
    const step = document.getElementById('step');
    const reset = document.getElementById('reset');
    const speed = document.getElementById('speed');
    const allowContinuous = document.getElementById('allowContinuous');
    const mode = document.getElementById('mode');
    const statusText = document.getElementById('statusText');
    const logRun = document.getElementById('logRun');
    const logPause = document.getElementById('logPause');
    const logReset = document.getElementById('logReset');
    const logStatus = document.getElementById('logStatus');
    const liveDot = document.getElementById('liveDot');

    function escapeHtml(value) { return String(value).replace(/[&<>"']/g, function (ch) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]); }); }
    function renderRows(id, rows, fn) { document.getElementById(id).innerHTML = rows.map(fn).join('') || '<div class="row"><span>none</span></div>'; }
    function render() {
      mode.textContent = state.mode;
      start.disabled = !socketReady || autoRunning;
      const serverActive = autoRunning || state.mode === 'running' || state.mode === 'generating';
      pause.disabled = !serverActive;
      if (logRun) logRun.disabled = !socketReady || serverActive;
      if (logPause) logPause.disabled = !serverActive;
      if (logReset) logReset.disabled = !socketReady || busy;
      if (liveDot) liveDot.className = 'live-dot ' + (!socketReady ? '' : state.mode === 'generating' || busy ? 'busy' : autoRunning ? 'on' : 'on');
      if (logStatus) logStatus.textContent = (!socketReady ? 'SOCKET OFFLINE' : (autoRunning || state.mode === 'running' || state.mode === 'generating' ? 'RUNNING' : 'LIVE / PAUSED')) + ' · mode=' + state.mode + ' · beat=' + state.beat + ' · ' + statusText.textContent;
      step.disabled = busy || !socketReady;
      reset.disabled = busy || !socketReady;
      renderRows('npcs', state.npcs, function (npc) { return '<div class="row"><strong>' + escapeHtml(npc.name) + ' / ' + escapeHtml(npc.role) + '</strong><span>wants: ' + escapeHtml(npc.want) + '</span><br><span>memory: ' + escapeHtml(npc.memory) + '</span><br><span>disposition: ' + escapeHtml(npc.disposition) + '</span></div>'; });
      renderRows('party', state.party, function (pc) {
        const details = [pc.hp != null ? 'hp ' + pc.hp : '', pc.armorClass != null ? 'ac ' + pc.armorClass : '', pc.goldGp != null ? pc.goldGp + ' gp' : ''].filter(Boolean).join(' · ');
        const abilities = pc.abilities ? Object.entries(pc.abilities).map(function (entry) { return entry[0].slice(0, 3).toUpperCase() + ' ' + entry[1]; }).join(', ') : '';
        return '<div class="row"><strong>' + escapeHtml(pc.player) + ' → ' + escapeHtml(pc.character) + '</strong><br>' + (details ? '<span>' + escapeHtml(details) + '</span><br>' : '') + (abilities ? '<span>abilities: ' + escapeHtml(abilities) + '</span><br>' : '') + '<span>goal: ' + escapeHtml(pc.goal) + '</span><br><span>fear: ' + escapeHtml(pc.fear) + '</span><br><span>gear: ' + escapeHtml(pc.inventory.join(', ') || 'none') + '</span></div>';
      });
      renderRows('affordances', state.affordances, function (text) { return '<div class="row"><strong>' + escapeHtml(text) + '</strong><span>available, not mandatory</span></div>'; });
      renderRows('receipts', state.ruleReceipts, function (text) { return '<div class="row"><span>' + escapeHtml(text) + '</span></div>'; });
      const persistedEvents = Array.isArray(state.processEvents) ? state.processEvents : [];
      const seenEvents = new Set();
      const allLiveEvents = liveEvents.concat(persistedEvents).filter(function (event) {
        const key = [event.at, event.lane, event.status, event.message, event.detail].join('|');
        if (seenEvents.has(key)) return false;
        seenEvents.add(key);
        return true;
      }).sort(function (a, b) {
        return Date.parse(b && b.at ? b.at : 0) - Date.parse(a && a.at ? a.at : 0);
      });
      const liveHtml = allLiveEvents.map(function (event) {
        const statusClass = event.status ? ' ' + event.status : '';
        if (event.lane === 'cot') {
          const kind = event.cotKind || (event.reasoning && /\btext stream\b/.test(event.reasoning) ? 'text' : 'reasoning');
          const meter = event.cotMeta || (event.reasoning ? escapeHtml(event.reasoning) : '');
          const deltaText = event.detail || '';
          return '<article class="turn live cot kind-' + escapeHtml(kind) + statusClass + '"><div class="meta"><span class="lane cot">cot/' + escapeHtml(kind) + '</span><span>' + escapeHtml(meter) + '</span><span>' + escapeHtml(event.at ? new Date(event.at).toLocaleTimeString() : 'now') + '</span></div><h3>' + escapeHtml(event.message || 'agent thought') + '</h3><div class="delta">' + escapeHtml(deltaText) + '</div></article>';
        }
        return '<article class="turn live' + statusClass + '"><div class="meta"><span class="lane ' + escapeHtml(event.lane || 'socket') + '">' + escapeHtml(event.lane || 'socket') + '</span><span>' + escapeHtml(event.status || 'live') + '</span><span>' + escapeHtml(event.at ? new Date(event.at).toLocaleTimeString() : 'now') + '</span></div><h3>' + escapeHtml(event.message || event.type || 'socket event') + '</h3>' + (event.detail ? '<p>' + escapeHtml(event.detail) + '</p>' : '') + (event.reasoning && devMode ? '<div class="reason"><strong>agent reasoning:</strong> ' + escapeHtml(event.reasoning) + '</div>' : '') + '</article>';
      }).join('');
      const playerSocketHtml = ['Mara / Hrum','Tovin / Vex'].map(function (label) {
        const key = label.includes('Mara') ? /Mara|Hrum|player-a/i : /Tovin|Vex|player-b/i;
        const event = allLiveEvents.find(function (candidate) { return candidate && (candidate.lane === 'player' || candidate.lane === 'cot') && key.test([candidate.message, candidate.detail, candidate.reasoning].join(' ')); });
        return '<article class="turn live player-socket"><div class="meta"><span class="lane player">player socket</span><span>' + escapeHtml(label) + '</span><span>' + escapeHtml(event && event.at ? new Date(event.at).toLocaleTimeString() : 'waiting') + '</span></div><h3>' + escapeHtml(event ? (event.message || 'connected') : 'Waiting for player activity') + '</h3>' + (event && event.detail ? '<p>' + escapeHtml(event.detail) + '</p>' : '') + (event && event.reasoning && devMode ? '<div class="reason"><strong>agent reasoning:</strong> ' + escapeHtml(event.reasoning) + '</div>' : '') + '</article>';
      }).join('');
      const logHtml = (state.log || []).slice().sort(function (a, b) {
        const beatDelta = Number(b && b.beat || 0) - Number(a && a.beat || 0);
        if (beatDelta) return beatDelta;
        return String(b && b.title || '').localeCompare(String(a && a.title || ''));
      }).map(function (turn) {
        const devBlock = devMode && turn.devReasoning ? '<div class="reason dev"><strong>dev/private:</strong> ' + escapeHtml(turn.devReasoning || '') + '</div>' : '';
        return '<article class="turn"><div class="meta"><span class="lane ' + escapeHtml(turn.lane) + '">' + escapeHtml(turn.lane) + '</span><span>beat ' + escapeHtml(turn.beat) + '</span><span>' + escapeHtml(turn.actor) + '</span></div><h3>' + escapeHtml(turn.title) + '</h3><p>' + escapeHtml(turn.tableText) + '</p><div class="reason"><strong>process:</strong> ' + escapeHtml(turn.processReasoning) + '</div>' + devBlock + '</article>';
      }).join('');
      document.getElementById('feed').innerHTML = playerSocketHtml + liveHtml + logHtml || '<article class="turn"><div class="meta"><span class="lane socket">socket</span></div><h3>Waiting for Referee Socket</h3><p>The browser is connecting directly to the Referee Agent. First step builds the world and rolls characters; later calls advance one beat at a time.</p><div class="reason"><strong>process:</strong> No polling loop. The Referee socket pushes state and process events.</div></article>';
      document.getElementById('state').textContent = JSON.stringify({ ...state, log: undefined }, null, 2);
    }

    function socketUrl() {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      return protocol + '//' + location.host + '/agents/referee/tavern-town-prototype?monitor=prototype' + (devMode ? '&dev=1' : '');
    }

    function connectSocket() {
      clearTimeout(reconnectTimer);
      statusText.textContent = 'Connecting to native Referee socket…';
      socket = new WebSocket(socketUrl());
      socket.addEventListener('open', function () {
        socketReady = true;
        statusText.textContent = 'Referee socket connected.';
        sendSocketCommand('prototype.get_state');
        render();
      });
      socket.addEventListener('message', function (event) { handleSocketMessage(event.data); });
      socket.addEventListener('close', function () {
        socketReady = false;
        busy = false;
        if (autoRunning) pauseRun('Socket closed. Autoplay paused before spending more AI money.');
        statusText.textContent = 'Referee socket disconnected; reconnecting…';
        render();
        reconnectTimer = setTimeout(connectSocket, 1400);
      });
      socket.addEventListener('error', function () { statusText.textContent = 'Referee socket error; waiting for reconnect…'; render(); });
    }

    function handleSocketMessage(raw) {
      let event;
      try { event = JSON.parse(raw); } catch { return; }
      if (event.type === 'prototype.connected') {
        liveEvents = [{ lane: 'socket', message: 'Connected to Referee Agent socket.', status: 'done', at: event.at }].concat(liveEvents).slice(0, variant === 'log' ? 240 : 18);
        render();
        return;
      }
      if (event.type === 'prototype.process') {
        if (event.lane === 'cot') {
          const kind = event.reasoning && /\btext stream\b/.test(event.reasoning) ? 'text' : 'reasoning';
          const stamped = Object.assign({}, event, { cotKind: kind, cotMeta: event.reasoning || '' });
          const head = liveEvents[0];
          if (head && head.lane === 'cot' && head.cotKind === kind && head.message === event.message) {
            head.detail = (head.detail || '') + (event.detail || '');
            head.at = event.at;
            head.cotMeta = stamped.cotMeta;
          } else {
            liveEvents = [stamped].concat(liveEvents).slice(0, variant === 'log' ? 480 : 24);
          }
          if (variant === 'log') statusText.textContent = event.message + ' …';
          render();
          return;
        }
        liveEvents = [event].concat(liveEvents).slice(0, variant === 'log' ? 240 : 18);
        statusText.textContent = event.message || 'Referee process update.';
        render();
        return;
      }
      if (event.type === 'prototype.state' && event.state) {
        receiveState(event.state, event.reason || 'socket');
        return;
      }
      if (event.type === 'prototype.error') {
        stopWithError(new Error(event.message || 'Referee socket error'));
      }
    }

    function receiveState(next, reason) {
      const wasBusy = busy;
      state = next;
      if (reason === 'already-generating' || (state.mode !== 'generating' && reason !== 'setup-committed')) busy = false;
      if (reason === 'connected' || reason === 'requested') statusText.textContent = 'Loaded server game at beat ' + state.beat + ' over Referee socket.';
      if (reason === 'generation-started') statusText.textContent = 'Referee socket says generation started.';
      if (reason === 'setup-committed') statusText.textContent = 'Generated setup. Syncing brain artifacts before releasing the step lock.';
      if (reason === 'setup-complete') statusText.textContent = 'Generated setup. Characters are rolled and the world is ready.';
      if (reason === 'beat-complete') statusText.textContent = 'Generated beat ' + state.beat + '. Newest committed turn is below the live feed.';
      if (reason === 'already-generating') statusText.textContent = 'Server is already generating. Controls are unlocked so you can wait or reset.';
      if (reason === 'reset') statusText.textContent = 'Server game reset.';
      render();
      if (autoRunning && wasBusy && state.mode !== 'generating') schedule();
    }

    function sendSocketCommand(type, source) {
      if (!socketReady || !socket || socket.readyState !== WebSocket.OPEN) {
        statusText.textContent = 'Referee socket is not connected yet.';
        render();
        return false;
      }
      socket.send(JSON.stringify({ type: type, source: source || 'manual', allowContinuous: allowContinuous.checked }));
      return true;
    }

    function nextBeat(source) {
      if (busy) return;
      busy = true;
      state.mode = 'generating';
      liveEvents = [{ lane: 'socket', message: source === 'auto' ? 'Autoplay requested the next beat.' : 'Manual step requested the next beat.', status: 'running', at: new Date().toISOString(), reasoning: 'Browser requested one complete beat: PlayerAgent A intent, PlayerAgent B intent, Referee resolution, memory update, artifact sync.' }].concat(liveEvents).slice(0, variant === 'log' ? 240 : 18);
      statusText.textContent = state.beat === 0 && (!state.log || state.log.length === 0)
        ? 'Socket command sent: freeze/load town module and roll characters…'
        : 'Socket command sent: ask PlayerAgents, then Referee, for one town-module beat…';
      if (!sendSocketCommand('prototype.step', source || 'manual')) busy = false;
      render();
    }

    function resetServerGame() {
      if (busy) return;
      busy = true;
      clearTimeout(timer);
      timer = null;
      autoRunning = false;
      liveEvents = [{ lane: 'socket', message: 'Reset requested over Referee socket.', status: 'running', at: new Date().toISOString() }].concat(liveEvents).slice(0, variant === 'log' ? 240 : 18);
      statusText.textContent = 'Resetting one server-side prototype game…';
      if (!sendSocketCommand('prototype.reset')) busy = false;
      render();
    }

    function schedule() { clearTimeout(timer); timer = setTimeout(runAutoLoop, Number(speed.value)); }
    function runAutoLoop() {
      if (!autoRunning) return;
      if (!allowContinuous.checked && autoBeatsRemaining <= 0) {
        pauseRun('Auto-paused after ' + DEFAULT_AUTO_BEAT_LIMIT + ' AI beats. Step manually or enable continuous $$$ autoplay.');
        return;
      }
      if (!allowContinuous.checked) autoBeatsRemaining -= 1;
      nextBeat('auto');
    }
    function stopWithError(error) { clearTimeout(timer); timer = null; autoRunning = false; state.mode = 'failed'; busy = false; statusText.textContent = 'Error: ' + (error && error.message ? error.message : String(error)); render(); }
    function pauseRun(message) { clearTimeout(timer); timer = null; autoRunning = false; state.mode = 'paused'; statusText.textContent = message; sendSocketCommand('prototype.pause'); render(); }

    function runForever() { allowContinuous.checked = true; autoRunning = true; autoBeatsRemaining = 999999; state.mode = 'running'; statusText.textContent = 'RUNNING continuously on server supervisor. Pause or Reset to stop spending AI money.'; sendSocketCommand('prototype.run', 'manual'); render(); }
    start.addEventListener('click', function () { autoRunning = true; autoBeatsRemaining = DEFAULT_AUTO_BEAT_LIMIT; state.mode = 'running'; statusText.textContent = allowContinuous.checked ? 'Continuous $$$ server run enabled. Pause when done.' : 'Server run started. It will stop only on pause/reset/failure for now.'; sendSocketCommand('prototype.run', 'manual'); render(); });
    pause.addEventListener('click', function () { pauseRun('Paused. Server state preserved.'); });
    step.addEventListener('click', function () { nextBeat('manual'); });
    reset.addEventListener('click', resetServerGame);
    if (logRun) logRun.addEventListener('click', runForever);
    if (logPause) logPause.addEventListener('click', function () { pauseRun('Paused. Server state preserved.'); });
    if (logReset) logReset.addEventListener('click', resetServerGame);
    speed.addEventListener('change', function () { if (timer) schedule(); });
    window.addEventListener('keydown', function (event) {
      if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName || '')) return;
      const variants = ['console','split','map','log'];
      const idx = variants.indexOf(variant);
      if (event.key === 'ArrowRight') location.search = '?variant=' + variants[(idx + 1) % variants.length];
      if (event.key === 'ArrowLeft') location.search = '?variant=' + variants[(idx + variants.length - 1) % variants.length];
    });
    render();
    connectSocket();
  </script>
</body>
</html>`, { headers: { "content-type": "text/html;charset=utf-8" } });
}

export function initialPrototypeState(): PrototypeTavernTownState {
  return {
    mode: "idle",
    beat: 0,
    location: "Unmade town module table",
    premise: "The Referee has not loaded a town module yet. First server step creates or freezes the module and rolls characters.",
    npcs: [],
    party: [],
    affordances: ["load or freeze a town module", "roll the player characters", "start the first table scene"],
    visibleThreads: [],
    ruleReceipts: [],
    updatedAt: new Date().toISOString(),
    log: [],
    processEvents: []
  };
}

async function consultPrototypeRules(state: PrototypeState): Promise<RuleReceipt[]> {
  const query = state.beat < 2
    ? "Old-School Essentials character creation 3d6 ability scores starting gold equipment"
    : "Old-School Essentials equipment cost rations torches rope adventuring gear retainers reaction";
  const url = `https://joelclaw.com/api/docs/search?q=${encodeURIComponent(query)}&perPage=4&semantic=false`;
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) return [];
  const json = await response.json() as { result?: { hits?: Array<{ id?: string; docId?: string; chunkIndex?: number; headingPath?: string[]; snippet?: string }> } };
  return (json.result?.hits ?? [])
    .filter((hit): hit is Required<Pick<RuleReceipt, "id" | "docId">> & RuleReceipt => Boolean(hit.id && hit.docId))
    .slice(0, 4)
    .map((hit) => ({
      id: hit.id,
      docId: hit.docId,
      ...(hit.chunkIndex === undefined ? {} : { chunkIndex: hit.chunkIndex }),
      ...(hit.headingPath === undefined ? {} : { headingPath: hit.headingPath }),
      snippet: stripMarks(hit.snippet ?? "")
    }));
}

async function generatePrototypePlayerIntents(env: Env, state: PrototypeState): Promise<PrototypePlayerIntent[]> {
  const intents: PrototypePlayerIntent[] = [];
  for (const member of state.party) {
    intents.push(await generatePrototypePlayerIntent(env, state, member));
  }
  return intents;
}

async function generatePrototypePlayerIntent(env: Env, state: PrototypeState, member: PrototypeState["party"][number]): Promise<PrototypePlayerIntent> {
  let validationError = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await runPrototypeKimi(env, buildPrototypePlayerIntentPrompt(state, member, validationError), 900);

    try {
      return PrototypePlayerIntentSchema.parse(parseJsonObject(extractWorkersAIText(result)));
    } catch (error) {
      validationError = summarizeValidationError(error);
    }
  }
  throw new Error(`Prototype PlayerAgent intent failed for ${member.player}: ${validationError}`);
}

async function runPrototypeKimi(env: Env, prompt: string, maxCompletionTokens: number): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await env.AI.run("@cf/moonshotai/kimi-k2.6", {
        messages: [{ role: "user", content: prompt }],
        chat_template_kwargs: { thinking: false, enable_thinking: false },
        reasoning_effort: null,
        max_completion_tokens: maxCompletionTokens
      });
    } catch (error) {
      lastError = error;
      if (!/3040|capacity|temporarily exceeded/i.test(String(error)) || attempt === 3) break;
      await sleep(700 * attempt);
    }
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPrototypePlayerIntentPrompt(state: PrototypeState, member: PrototypeState["party"][number], validationError: string): string {
  return [
    "You are a PlayerAgent in an Old School Essentials frozen town module campaign.",
    "You are NOT the Referee. You do not know hidden NPC secrets, faction agendas, or rulebook text.",
    "Narrate your own choice as a player/character from only the visible town-module state and available affordances.",
    "Pick one action you actually want to attempt. You may choose an existing affordance or a closely related open-world action.",
    "Return compact JSON only. No markdown. No extra keys.",
    "Shape: { player:string, character:string, actor:string, title:string, tableSpeech:string, declaredAction:string, intentKind:'talk|ask|buy|hire|observe|reveal_backstory|leave|wait|other', target?:string, processReasoning:string, innerMonologue:string, privateGoal:string, privateFear:string }",
    "Keep every string under 240 characters so JSON does not truncate.",
    validationError ? `Previous attempt failed schema validation: ${validationError}. Retry with valid JSON.` : "",
    `Your player/character: ${JSON.stringify(member)}`,
    `Visible location: ${state.location}`,
    `Visible threads: ${JSON.stringify(state.visibleThreads)}`,
    `Available affordances: ${JSON.stringify(state.affordances)}`,
    `Recent public log: ${JSON.stringify((state.log ?? []).slice(0, 4))}`
  ].filter(Boolean).join("\n");
}

async function generatePrototypeBeat(env: Env, state: PrototypeState, receipts: RuleReceipt[], playerIntents: PrototypePlayerIntent[]): Promise<GeneratedBeat> {
  let validationError = "";
  let lastCandidate: GeneratedBeatCandidate | null = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await runPrototypeKimi(env, buildPrototypeBeatPrompt(state, receipts, playerIntents, validationError), 1800);

    try {
      const candidate = GeneratedBeatCandidateSchema.parse(parseJsonObject(extractWorkersAIText(result)));
      lastCandidate = candidate;
      return GeneratedBeatSchema.parse(repairGeneratedBeat(candidate, state));
    } catch (error) {
      validationError = summarizeValidationError(error);
    }
  }

  if (lastCandidate) return GeneratedBeatSchema.parse(repairGeneratedBeat(lastCandidate, state));
  throw new Error(`Prototype beat generation failed after retry: ${validationError}`);
}

function buildPrototypeBeatPrompt(state: PrototypeState, receipts: RuleReceipt[], playerIntents: PrototypePlayerIntent[], validationError: string): string {
  return [
    "You are a THROWAWAY prototype Referee generator for Cloudflare Agent Dungeon.",
    "Generate exactly ONE town-module beat. Do not run a scripted route. Do not force hook acceptance.",
    "The frozen town module is the whole open world for now. Players can talk, buy, hire, wait, leave, ask sideways, or ignore pressure.",
    "Use player-driven affordances. NPCs should want things and remember things.",
    "You must explicitly consider the supplied PlayerAgent intents. The Referee outcome should respond to those choices, not ignore or replace them.",
    "Rules validation comes from OSE rulebook receipts supplied from JoelClaw docs. Code is not the rules authority.",
    "Do not quote long rulebook text. You may cite receipt ids in rulesUsed.",
    "Return compact JSON only. No markdown. No extra keys.",
    "Hard shape: { lane:'referee|player|npc|rules|audit', actor:string, title:string, tableText:string, processReasoning:string, devReasoning:string, nextAffordances:string[], visibleThreads:string[], npcUpdates?:Npc[], partyUpdates?:PartyMember[], rulesUsed?:string[] }",
    "Hard limits: nextAffordances MUST contain 3-7 items. visibleThreads MUST contain 1-7 items. If you have more ideas, choose the best 7. Do not exceed these limits.",
    "Keep tableText under 900 characters and process/dev reasoning under 300 characters each so JSON does not truncate.",
    "Start with { and end with }. Do not wrap in markdown fences.",
    validationError ? `Previous attempt failed schema validation: ${validationError}. Retry with fewer array items and valid JSON.` : "",
    `State: ${JSON.stringify({ ...state, log: (state.log ?? []).slice(0, 4) })}`,
    `PlayerAgent intents to consider: ${JSON.stringify(playerIntents)}`,
    `Rule receipts: ${JSON.stringify(receipts.map((receipt) => ({ id: receipt.id, docId: receipt.docId, headingPath: receipt.headingPath, snippet: receipt.snippet?.slice(0, 240) })))}`
  ].filter(Boolean).join("\n");
}

function repairGeneratedBeat(candidate: GeneratedBeatCandidate, state: PrototypeState): GeneratedBeat {
  const nextAffordances = takeUnique(candidate.nextAffordances, 7);
  const visibleThreads = takeUnique(candidate.visibleThreads, 7);
  const repaired = {
    ...candidate,
    nextAffordances: padToMinimum(nextAffordances, state.affordances, 3).slice(0, 7),
    visibleThreads: padToMinimum(visibleThreads, state.visibleThreads, 1).slice(0, 7)
  };
  return GeneratedBeatSchema.parse(repaired);
}

function takeUnique(values: string[], max: number): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, max);
}

function padToMinimum(values: string[], fallback: string[], minimum: number): string[] {
  const padded = [...values];
  for (const item of fallback) {
    if (padded.length >= minimum) break;
    if (!padded.includes(item)) padded.push(item);
  }
  while (padded.length < minimum) padded.push("wait and listen");
  return padded;
}

function summarizeValidationError(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");
  return String(error);
}

function applyGeneratedBeat(state: PrototypeState, beat: GeneratedBeat, receipts: RuleReceipt[], playerIntents: PrototypePlayerIntent[]): PrototypeState & { log: unknown[] } {
  const receiptIds = [...new Set([...(state.ruleReceipts ?? []), ...receipts.map((receipt) => receipt.id), ...(beat.rulesUsed ?? [])])].slice(-12);
  const beatNumber = state.beat + 1;
  return {
    ...state,
    mode: "running",
    beat: beatNumber,
    npcs: beat.npcUpdates?.length ? beat.npcUpdates : state.npcs,
    party: beat.partyUpdates?.length ? beat.partyUpdates : state.party,
    affordances: beat.nextAffordances,
    visibleThreads: beat.visibleThreads,
    ruleReceipts: receiptIds,
    log: [
      {
        beat: beatNumber,
        lane: beat.lane,
        actor: beat.actor,
        title: beat.title,
        tableText: beat.tableText,
        processReasoning: `Referee considered player intents: ${playerIntents.map((intent) => `${intent.actor}: ${intent.declaredAction}`).join(" | ")}. ${beat.processReasoning}`,
        devReasoning: beat.devReasoning,
        rulesUsed: beat.rulesUsed ?? receipts.map((receipt) => receipt.id)
      },
      ...playerIntents.map((intent) => playerIntentToLog(intent, beatNumber)),
      ...((state as PrototypeState & { log?: unknown[] }).log ?? [])
    ].slice(0, 36)
  };
}

function playerIntentToLog(intent: PrototypePlayerIntent, beatNumber: number) {
  return {
    beat: beatNumber,
    lane: "player",
    actor: intent.actor,
    title: intent.title,
    tableText: intent.tableSpeech,
    processReasoning: `${intent.declaredAction} [${intent.intentKind}]${intent.target ? ` targeting ${intent.target}` : ""}. ${intent.processReasoning}`,
    devReasoning: `inner=${intent.innerMonologue} | goal=${intent.privateGoal} | fear=${intent.privateFear}`
  };
}

function extractWorkersAIText(result: unknown): string {
  const response = result as { response?: string; choices?: Array<{ message?: { content?: string }; text?: string }> };
  return response.response ?? response.choices?.[0]?.message?.content ?? response.choices?.[0]?.text ?? "";
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  if (candidate.startsWith("{") && candidate.endsWith("}")) return JSON.parse(candidate);
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) return JSON.parse(candidate.slice(start, end + 1));
  throw new Error(`No complete JSON object in model response. Response likely truncated: ${trimmed.slice(0, 260)}`);
}

function stripMarks(value: string): string {
  return value.replace(/<\/?mark>/g, "");
}

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, { headers: { "access-control-allow-origin": "*" }, ...init });
}
