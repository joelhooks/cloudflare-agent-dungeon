// PROTOTYPE — THROWAWAY UI STUDY
// Question: what should the autonomous tavern/town process monitor feel like?
// Run with: pnpm --filter @cloudflare-agent-dungeon/worker dev
// Open: /prototype/tavern-town?variant=ledger|table|console
// Delete or absorb after Joel picks the useful shape.

export function prototypeTavernTownUiPage(): Response {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PROTOTYPE — Tavern Town Runner</title>
  <style>
    :root {
      --paper: #fbf7eb;
      --ink: #201711;
      --muted: #6f6255;
      --line: #d8c7a9;
      --red: #8e2f22;
      --gold: #b07722;
      --green: #32684c;
      --blue: #315f79;
      --violet: #68466d;
      --shadow: 0 18px 60px rgba(35, 24, 13, .16);
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(176, 119, 34, .20), transparent 28rem),
        linear-gradient(135deg, #fffdf6, var(--paper));
      font: 18px/1.5 Georgia, 'Iowan Old Style', serif;
    }

    button, select {
      font: inherit;
      color: var(--ink);
      background: #fffaf0;
      border: 1px solid var(--ink);
      border-radius: 999px;
      padding: .55rem .9rem;
      cursor: pointer;
      box-shadow: 3px 3px 0 var(--ink);
    }

    button:disabled { opacity: .45; cursor: not-allowed; box-shadow: none; }
    button:hover:not(:disabled), select:hover { transform: translate(-1px, -1px); box-shadow: 4px 4px 0 var(--ink); }

    .shell { width: min(1420px, calc(100vw - 32px)); margin: 0 auto; padding: 24px 0 112px; }
    .prototype-ribbon {
      display: inline-flex; gap: .5rem; align-items: center;
      border: 1px solid var(--ink); border-radius: 999px; padding: .25rem .65rem;
      background: #fff; box-shadow: 2px 2px 0 var(--ink); font-size: .78rem; text-transform: uppercase; letter-spacing: .08em;
    }

    header { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(320px, .85fr); gap: 28px; align-items: end; margin: 24px 0 28px; }
    h1 { font-size: clamp(2.3rem, 6vw, 6rem); line-height: .92; letter-spacing: -.055em; margin: 0 0 12px; max-width: 12ch; }
    h2 { margin: 0 0 .7rem; font-size: 1.1rem; text-transform: uppercase; letter-spacing: .08em; }
    p { margin: 0 0 1rem; }
    .lede { max-width: 68ch; color: #3b2c20; font-size: 1.08rem; }

    .control-panel, .card, .feed-item, .state-card {
      background: rgba(255, 252, 244, .84);
      border: 1px solid var(--line);
      box-shadow: var(--shadow);
      backdrop-filter: blur(8px);
    }

    .control-panel { padding: 16px; border-radius: 24px; }
    .controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .status-line { margin-top: 12px; color: var(--muted); font-size: .95rem; }
    .status-pill { display: inline-block; color: #fff; background: var(--green); border-radius: 999px; padding: .1rem .5rem; margin-right: .35rem; }

    .app { display: grid; gap: 18px; }
    body.variant-ledger .app { grid-template-columns: minmax(0, .95fr) minmax(460px, 1.2fr) minmax(320px, .8fr); }
    body.variant-table .app { grid-template-columns: minmax(0, 1fr) minmax(440px, .86fr); }
    body.variant-console .app { grid-template-columns: minmax(0, .78fr) minmax(520px, 1.22fr); }

    .stack { display: grid; gap: 14px; align-content: start; }
    .card { border-radius: 26px; padding: 18px; }
    .town-map { min-height: 280px; position: relative; overflow: hidden; background: linear-gradient(145deg, rgba(255,255,255,.65), rgba(245,227,190,.65)); }
    .road { position: absolute; left: -5%; right: -5%; top: 54%; height: 26px; background: rgba(107, 85, 58, .24); transform: rotate(-7deg); border-top: 1px dashed rgba(32,23,17,.3); border-bottom: 1px dashed rgba(32,23,17,.3); }
    .place {
      position: absolute; width: 128px; min-height: 76px; border: 1px solid var(--ink); border-radius: 18px;
      background: #fff9eb; padding: 10px; box-shadow: 5px 5px 0 rgba(32,23,17,.85); font-size: .92rem;
    }
    .place strong { display: block; }
    .place small { color: var(--muted); }
    .p1 { left: 8%; top: 18%; } .p2 { right: 12%; top: 10%; } .p3 { left: 38%; top: 48%; } .p4 { right: 8%; bottom: 10%; }

    .npc-grid, .party-grid { display: grid; gap: 10px; }
    .npc, .pc, .affordance {
      border: 1px solid var(--line); border-radius: 18px; padding: 12px; background: rgba(255,255,255,.58);
    }
    .npc strong, .pc strong, .affordance strong { display: block; }
    .npc span, .pc span, .affordance span { color: var(--muted); font-size: .93rem; }

    .feed { display: flex; flex-direction: column; gap: 12px; }
    .feed-item { border-radius: 22px; padding: 14px 16px; animation: drop .28s ease-out both; }
    .feed-item .meta { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; font-size: .78rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
    .lane { color: #fff; border-radius: 999px; padding: .1rem .46rem; background: var(--blue); }
    .lane.referee { background: var(--red); }
    .lane.player { background: var(--green); }
    .lane.npc { background: var(--gold); color: #160f09; }
    .lane.rules { background: var(--violet); }
    .lane.audit { background: #2c2b2a; }
    .feed-item h3 { margin: 0 0 4px; font-size: 1.15rem; }
    .feed-item p { margin: 0; }
    .reason { margin-top: 10px; padding: 10px; border-left: 3px solid var(--line); color: #4a382a; background: rgba(255,255,255,.54); }

    .state-card { border-radius: 22px; padding: 14px; }
    .state-card pre { margin: 0; white-space: pre-wrap; font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }

    .table-stage {
      min-height: 560px; border-radius: 34px; border: 1px solid var(--ink); position: relative; overflow: hidden;
      background:
        radial-gradient(circle at 50% 48%, rgba(111, 70, 36, .35), transparent 11rem),
        linear-gradient(145deg, #51301e, #1c120d 70%);
      box-shadow: var(--shadow);
      color: #ffecc9;
      padding: 24px;
    }
    .table-stage h2 { color: #fff1cf; }
    .round-table { position: absolute; left: 50%; top: 53%; transform: translate(-50%, -50%); width: min(66vw, 520px); aspect-ratio: 1; border-radius: 50%; background: radial-gradient(circle, #8a5431, #4b2919 66%); border: 10px solid #2a160e; box-shadow: inset 0 0 60px rgba(0,0,0,.35), 0 22px 70px rgba(0,0,0,.45); }
    .token { position: absolute; width: 144px; border: 1px solid rgba(255,236,201,.5); background: rgba(25,14,9,.75); color: #fff1cf; border-radius: 18px; padding: 10px; }
    .t1 { left: 7%; top: 18%; } .t2 { right: 8%; top: 20%; } .t3 { left: 12%; bottom: 10%; } .t4 { right: 13%; bottom: 12%; }

    body.variant-table .ledger-only, body.variant-console .ledger-only { display: none; }
    body.variant-ledger .table-only, body.variant-console .table-only { display: none; }
    body.variant-ledger .console-only, body.variant-table .console-only { display: none; }

    .console {
      background: #11100e; color: #f4ead8; border-radius: 26px; padding: 18px; box-shadow: var(--shadow); min-height: 620px;
      font: 15px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; border: 1px solid #312820;
    }
    .console .feed-item { background: #191713; border: 1px solid #3c342d; box-shadow: none; border-radius: 12px; }
    .console .reason { background: #211f1a; border-left-color: #b07722; color: #d8c7a9; }

    .bottom-bar {
      position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 10;
      display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; max-width: calc(100vw - 24px);
      background: rgba(255,255,255,.86); border: 1px solid var(--ink); border-radius: 999px; padding: 8px; box-shadow: 6px 6px 0 var(--ink);
      backdrop-filter: blur(10px);
    }
    .bottom-bar a { text-decoration: none; color: var(--ink); border-radius: 999px; padding: .45rem .7rem; }
    .bottom-bar a.active { background: var(--ink); color: #fff; }

    @keyframes drop { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: translateY(0); } }
    @media (max-width: 1100px) { header, body.variant-ledger .app, body.variant-table .app, body.variant-console .app { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main class="shell">
    <span class="prototype-ribbon">Prototype / wipe me</span>
    <header>
      <div>
        <h1>Tavern Town Runner</h1>
        <p class="lede">UI study for an autonomous, player-driven town/tavern loop. Newest turn stays on top. The monitor shows reasoning, table speech, NPC pressure, rules receipts, and dev-only audit lanes as the world thinks through one beat at a time.</p>
      </div>
      <section class="control-panel">
        <h2>World daemon</h2>
        <div class="controls">
          <button id="start">Start World</button>
          <button id="pause" disabled>Pause</button>
          <button id="step">Step One Beat</button>
          <select id="speed" aria-label="speed">
            <option value="1800">slow</option>
            <option value="950" selected>table pace</option>
            <option value="420">fast skim</option>
          </select>
        </div>
        <p class="status-line"><span class="status-pill" id="mode">idle</span><span id="statusText">No persistence. Simulated process only.</span></p>
      </section>
    </header>

    <section class="app">
      <div class="stack ledger-only">
        <section class="card town-map">
          <div class="road"></div>
          <div class="place p1"><strong>Golden Eel</strong><small>smoke, debts, rumor</small></div>
          <div class="place p2"><strong>Archmarket</strong><small>gear and bad prices</small></div>
          <div class="place p3"><strong>Old Shrine</strong><small>healing, omens</small></div>
          <div class="place p4"><strong>Retainer Board</strong><small>cowards, liars, gems</small></div>
        </section>
        <section class="card"><h2>Persistent NPCs</h2><div class="npc-grid" id="npcs"></div></section>
      </div>

      <section class="table-stage table-only">
        <h2>The table view</h2>
        <div class="round-table"></div>
        <div class="token t1"><strong>Referee</strong><br>Frames affordances, not plot.</div>
        <div class="token t2"><strong>Mara</strong><br>Cautious player, tests every surface.</div>
        <div class="token t3"><strong>Tovin</strong><br>Bold player, wants a story worth retelling.</div>
        <div class="token t4"><strong>NPCs</strong><br>Want things. Remember things.</div>
      </section>

      <section class="stack">
        <h2>Newest turn first</h2>
        <div class="feed" id="feed"></div>
      </section>

      <section class="stack">
        <section class="card"><h2>Party / session 0</h2><div class="party-grid" id="party"></div></section>
        <section class="card"><h2>Current affordances</h2><div class="party-grid" id="affordances"></div></section>
        <section class="state-card"><h2>Visible state</h2><pre id="state"></pre></section>
      </section>

      <section class="console console-only"><h2>Process console</h2><div class="feed" id="consoleFeed"></div></section>
    </section>
  </main>

  <nav class="bottom-bar" aria-label="Prototype variants">
    <a data-variant="ledger" href="?variant=ledger">ledger</a>
    <a data-variant="table" href="?variant=table">table</a>
    <a data-variant="console" href="?variant=console">console</a>
  </nav>

  <script>
    const params = new URLSearchParams(location.search);
    const variant = params.get('variant') || 'ledger';
    document.body.classList.add('variant-' + variant);
    document.querySelectorAll('[data-variant]').forEach(function (link) {
      link.classList.toggle('active', link.dataset.variant === variant);
    });

    const beats = [
      { lane: 'referee', title: 'Referee builds the boundary', text: 'Willowby is not a backdrop. It is the whole prototype map: Golden Eel tavern, Archmarket, old shrine, retainer board, muddy road out.', reason: 'Town is the sandbox. No dungeon route exists until players make one matter.' },
      { lane: 'npc', title: 'NPCs persist into the graph', text: 'Hesta Vane wants debts paid. Rook the drover wants his brother found. Sister Elian wants the shrine bell left alone.', reason: 'NPCs get wants, memory, rumors, disposition, and pressure. Not disposable flavor.' },
      { lane: 'referee', title: 'Players are invited to the table', text: 'The Referee asks each PlayerAgent what kind of nobody they are before the dice make it painful.', reason: 'Session 0 starts conversationally. The dice do not replace identity; they complicate it.' },
      { lane: 'rules', title: 'Character creation procedure', text: '3d6 down the line. One ability swap. Roll gold. Buy gear manually. Food and light are not vibes.', reason: 'OSE procedure is the rail. It creates constraints without scripting behavior.' },
      { lane: 'player', title: 'Mara shapes a cautious thief', text: '“I want someone who survives by touching nothing first and asking why everyone else is calm.”', reason: 'Inner monologue: if the party laughs at the pole, they can trigger the trap.' },
      { lane: 'player', title: 'Tovin chooses pressure over safety', text: '“Give me a cleric who is brave because he is terrified of being ordinary.”', reason: 'The party is not balanced by force. It is balanced by questions, hiring, gear, and consequences.' },
      { lane: 'referee', title: 'Referee notices gaps', text: 'No one bought rope. One character has light. Nobody hired a local. Hesta offers names, not orders.', reason: 'Balance is a conversation: expose risk and affordances, then let players choose badly or well.' },
      { lane: 'npc', title: 'Tavern roleplay reveals hooks sideways', text: 'Rook slams a wet boot on the table: blue clay is packed in the heel, and he swears his brother walked home from Stagmere with no face.', reason: 'Hooks emerge from NPC wants and concrete details, not from a Choose Hook button.' },
      { lane: 'player', title: 'Players ask instead of accepting', text: 'Mara asks who profits if Rook disappears. Tovin asks whether the shrine pays for recovered bodies.', reason: 'This is the open-world beat: players interrogate the situation before choosing a direction.' },
      { lane: 'audit', title: 'Private reasoning stays dev-only', text: 'Referee notes: Hesta is hiding guild pressure; Rook is truthful but wrong about the cause.', reason: 'Public monitor shows process. Dev audit shows the machinery without leaking secrets to players.' }
    ];

    const world = {
      mode: 'idle',
      beat: 0,
      tavern: 'Golden Eel',
      npcs: [
        { name: 'Hesta Vane', role: 'innkeeper', wants: 'debts paid before trouble arrives', memory: 'remembers who dodged last winter rent' },
        { name: 'Rook Marlen', role: 'drover', wants: 'brother found or avenged', memory: 'knows the Blackfen Road by smell' },
        { name: 'Sister Elian', role: 'shrine keeper', wants: 'old bell left buried', memory: 'tracks who lies near holy water' }
      ],
      party: [
        { player: 'Mara', character: 'not rolled yet', pressure: 'wants survival tools before glory' },
        { player: 'Tovin', character: 'not rolled yet', pressure: 'wants to matter immediately' }
      ],
      affordances: ['talk to Hesta', 'ask Rook about the blue clay', 'buy light/rope/food', 'read the retainer board', 'ignore everyone and drink']
    };

    const feed = document.getElementById('feed');
    const consoleFeed = document.getElementById('consoleFeed');
    const mode = document.getElementById('mode');
    const statusText = document.getElementById('statusText');
    const start = document.getElementById('start');
    const pause = document.getElementById('pause');
    const step = document.getElementById('step');
    const speed = document.getElementById('speed');
    let timer = null;

    function laneLabel(lane) { return lane === 'audit' ? 'dev audit' : lane; }
    function itemHtml(item, index) {
      return '<article class="feed-item">' +
        '<div class="meta"><span class="lane ' + item.lane + '">' + laneLabel(item.lane) + '</span><span>beat ' + String(index + 1).padStart(2, '0') + '</span></div>' +
        '<h3>' + item.title + '</h3>' +
        '<p>' + item.text + '</p>' +
        '<div class="reason"><strong>reasoning/process:</strong> ' + item.reason + '</div>' +
      '</article>';
    }

    function mutateForBeat(item) {
      if (item.title.includes('Mara')) world.party[0].character = 'cautious thief, gear-brained';
      if (item.title.includes('Tovin')) world.party[1].character = 'fearful cleric, brave anyway';
      if (item.title.includes('Referee notices')) world.affordances = ['buy rope', 'hire local guide', 'ask Hesta about guild debts', 'press Rook on his brother', 'leave without prep'];
      if (item.title.includes('Tavern roleplay')) world.affordances = ['follow blue clay lead', 'question Sister Elian', 'inspect Rook boot', 'seek a retainer', 'keep drinking'];
      if (item.title.includes('Players ask')) world.affordances = ['negotiate reward', 'buy supplies first', 'split questions between NPCs', 'leave tonight', 'sleep and risk clocks'];
    }

    function renderStatic() {
      document.getElementById('npcs').innerHTML = world.npcs.map(function (npc) {
        return '<div class="npc"><strong>' + npc.name + '</strong><span>' + npc.role + '</span><br>' + npc.wants + '<br><span>' + npc.memory + '</span></div>';
      }).join('');
      document.getElementById('party').innerHTML = world.party.map(function (pc) {
        return '<div class="pc"><strong>' + pc.player + '</strong><span>' + pc.character + '</span><br>' + pc.pressure + '</div>';
      }).join('');
      document.getElementById('affordances').innerHTML = world.affordances.map(function (text) {
        return '<div class="affordance"><strong>' + text + '</strong><span>available now, not mandatory</span></div>';
      }).join('');
      document.getElementById('state').textContent = JSON.stringify(world, null, 2);
      mode.textContent = world.mode;
    }

    function renderFeeds() {
      const shown = beats.slice(0, world.beat).reverse();
      const html = shown.map(function (item, reversedIndex) {
        return itemHtml(item, world.beat - reversedIndex - 1);
      }).join('') || '<article class="feed-item"><h3>Waiting for Start World</h3><p>The table has not begun.</p><div class="reason"><strong>reasoning/process:</strong> The daemon should start the table, not a screenplay.</div></article>';
      feed.innerHTML = html;
      consoleFeed.innerHTML = html;
    }

    function render() { renderStatic(); renderFeeds(); }

    function nextBeat() {
      if (world.beat >= beats.length) {
        stop('Prototype beat deck complete. Verdict time: which UI shape helps you think?');
        return;
      }
      const item = beats[world.beat];
      mutateForBeat(item);
      world.beat += 1;
      statusText.textContent = 'Streaming ' + item.title + '… newest turn stays on top.';
      render();
    }

    function schedule() {
      clearInterval(timer);
      timer = setInterval(nextBeat, Number(speed.value));
    }

    function stop(message) {
      clearInterval(timer);
      timer = null;
      world.mode = 'paused';
      start.disabled = false;
      pause.disabled = true;
      pause.textContent = 'Pause';
      statusText.textContent = message;
      render();
    }

    start.addEventListener('click', function () {
      world.mode = 'running';
      start.disabled = true;
      pause.disabled = false;
      statusText.textContent = 'World daemon running. This is simulated throwaway UI state.';
      nextBeat();
      schedule();
    });

    pause.addEventListener('click', function () {
      if (timer) {
        stop('Paused. State remains in memory only.');
      } else {
        world.mode = 'running';
        start.disabled = true;
        pause.disabled = false;
        statusText.textContent = 'Resumed.';
        schedule();
        render();
      }
    });

    step.addEventListener('click', function () {
      if (world.mode === 'idle') world.mode = 'stepping';
      nextBeat();
      render();
    });

    speed.addEventListener('change', function () {
      if (timer) schedule();
    });

    render();
  </script>
</body>
</html>`, { headers: { "content-type": "text/html;charset=utf-8" } });
}
