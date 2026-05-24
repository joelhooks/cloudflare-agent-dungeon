# Cloudflare Agent Dungeon Operating Layer

This repo is the Cloudflare Agent Dungeon: a CascadiaJS demo plus a real long-running toy/game where Cloudflare-hosted sandboxed agents play an ongoing Old School Essentials campaign.

## Identity and scope

- This is real software, not stage goo.
- Build the smallest runnable learning slice before expanding the system.
- Do not build a full VTT first.
- Do not implement federation first.
- Do not hand-roll a whole agent loop if Cloudflare Think works.

## Canonical domain language

Use **Referee** as the OSE-aligned term in code and durable docs.

Avoid `DM`, `GameMaster`, and `GM` for new code/domain names unless quoting prior source or explaining aliases.

Canonical shape:

```txt
Referee extends Agent
  owns canonical campaign/world state, hidden info, event log, dice ledger,
  party workspace, player projections, monitor firehose

  ├─ RefereeAgent extends Think
  │    referee mind/session/tools/rules lookup/private referee memory
  │
  ├─ PlayerAgent[player-a] extends Think
  │    player A mind/private memory/private workspace/player-safe tools
  │
  └─ PlayerAgent[player-b] extends Think
       player B mind/private memory/private workspace/player-safe tools
```

North star:

> Use Think for minds, Agents SDK for bodies, Referee for truth, shared party workspace for revealed table artifacts, private player sandboxes for secrets, and event projections for what each mind is allowed to know.

## Think-first / Agents SDK idioms

- Prefer Cloudflare Think for agent minds: prompts, tools, session context, memory, streaming, and persisted turns.
- Prefer a plain `Agent` parent for the deterministic Referee/body unless a specific source-backed reason requires `Think`.
- Use `runAgentTool()` for deterministic Referee → child Think turns when retained runs, replay, cancellation, drill-in, or event forwarding matter.
- Use raw `subAgent(...).chat()` only when Agent Tools are too much ceremony and the prototype owns forwarding/cancellation/replay itself.
- Keep lifecycle explicit. Use XState/statecharts or Effect services for non-trivial finite modes, retries, cancellation, recovery, child turn status, or scheduling.

## Fog-of-war is a capability firewall

- Referee owns canonical hidden state.
- PlayerAgents receive only explicit projections produced by Referee.
- Player tools must not read hidden campaign state, global rules/source corpus, or other players' private sandboxes.
- Player outputs are typed proposals, not direct mutations.
- Referee validates proposals before committing typed events.
- RefereeAgent may use `consultRules`; PlayerAgents may not unless the Referee deliberately exposes a bounded safe artifact.
- Public monitor output must show sanitized gameplay, safe citations, and summaries only. Never stream raw private/copyrighted rules corpus text.

## Workspace boundaries

- Shared party workspace: revealed table artifacts only — map notes, marching order, visible inventory, handouts, party theories.
- Private player sandbox: player-local memory/plans/secrets. No game API read path for other players.
- Referee/private workspace: hidden module state, source notes, unresolved threads, adjudication context.

## Source mirror policy

Clone source repos into project-local `.agent-sources/` as shallow mirrors/subtrees and keep them out of commits via `.git/info/exclude`.

Expected pattern:

```bash
mkdir -p .agent-sources
git clone --depth 1 --filter=blob:none https://github.com/cloudflare/agents.git .agent-sources/cloudflare-agents
printf '\n.agent-sources/\n' >> .git/info/exclude
```

Read source before claiming API behavior. Prefer `.agent-sources/cloudflare-agents/docs/**` plus package source.

For Effect work, hydrate official Effect source into `.agent-sources/effect` with the pi-effect/effect-source workflow before writing or reviewing Effect code.

## OSE / rules corpus access

Old School Essentials source access starts with JoelClaw docs/PDF Brain. Before implementing or changing OSE procedures — character creation, classes, equipment prices, adventuring turns, encounters, morale/reaction, treasure, XP, level-up, retainers, supplies, or magic items — search JoelClaw and cite the doc/chunk IDs in Brain or referee audit receipts.

Canonical JoelClaw OSE source docs currently include:

- `old-school-essentials-classic-fantasy-rules-tome-3751c5149a24` — Old School Essentials Classic Fantasy Rules Tome v1.4
- `old-school-essentials-basic-rules-v1-4-a4d9608ea98b` — Old School Essentials Basic Rules v1.4
- `old-school-essentials-advanced-expansion-set-cha-317a5d4ba5c1` — Advanced Expansion Set Characters v1.0
- `old-school-essentials-advanced-expansion-set-mag-32d160048e03` — Advanced Expansion Set Magic v1.0
- `old-school-essentials-advanced-expansion-set-mon-d93a729edbee` — Advanced Expansion Set Monsters v1.0
- `old-school-essentials-advanced-expansion-set-tre-eec18f681015` — Advanced Expansion Set Treasures v1.0

Public docs API examples:

```bash
curl -sS https://joelclaw.com/api/docs
curl -sS "https://joelclaw.com/api/docs/search?q=Old%20School%20Essentials&perPage=5&semantic=false"
curl -sS "https://joelclaw.com/api/docs/search?q=Old-School%20Essentials%20referee&perPage=5&semantic=false"
curl -sS "https://joelclaw.com/api/docs/search?q=Old-School%20Essentials%20Classic%20Fantasy%20Rules%20Tome%20character%20creation&perPage=5&semantic=false"
curl -sS "https://joelclaw.com/api/docs/old-school-essentials-classic-fantasy-rules-tome-3751c5149a24/toc"
```

Rules:

- Source-grounded content law applies: do not invent OSE mechanics when a rule should come from the books.
- RefereeAgent may use `consultRules` / JoelClaw docs lookups for adjudication and procedure checks.
- PlayerAgents must not access global rules/source unless deliberately exposed as a player-safe table artifact.
- Capture doc IDs/chunk IDs in internal events when useful.
- Public monitor should show safe citations/summaries, not raw full book chunks.

## Brain-first memory policy

Use `.brain/` as the canonical durable project graph.

- Project work → `.brain/projects/`
- Durable systems/vocabulary → `.brain/areas/`
- Source research → `.brain/resources/`
- Hard-to-reverse tradeoffs → `.brain/decisions/`

Use `second-brain-execution` and `para-operator` when organizing durable knowledge.

Do not let chat history be the only source of truth.

## Operating loop

Joel is driving and learning. Do not bulldoze end-to-end.

1. Research one bounded mechanism from source.
2. Report plain-language findings and tradeoffs.
3. Implement the smallest useful slice.
4. Capture learning in Brain.
