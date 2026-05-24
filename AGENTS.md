# AGENTS.md — Cloudflare Agent Dungeon

This repo is for the CascadiaJS demo + long-running toy where sandboxed Cloudflare agents play an ongoing Old School Essentials campaign.

## Operating shape

- Real software, not throwaway stage goo.
- Turborepo monorepo.
- Cloudflare-first runtime with Wrangler and real Cloudflare validation once behavior touches runtime.
- Think-first prototype for the agentic loop, supervised by explicit actor/state lifecycle.
- XState/statecharts are the philosophical lifecycle model: finite modes, events, guards, child actors, retries, cancellation, recovery.
- Effect is preferred for domain/runtime workflows, services, errors, layers, scheduling, and durable boundaries.
- Keep the official Effect source in `./agent-sources/effect` as a shallow local mirror before doing Effect work.
- Referee and player Skills are first-class artifacts.
- AT Protocol remains the substrate inspiration for identity, typed records, trust, event sourcing, firehose, agent-to-agent/operator communication, and provenance.

## Prototype target

First runnable prototype:

- 1 Referee agent.
- 2 player agents.
- 3 rooms.
- Referee designs the micro-module for the campaign.
- Players know only what the DM explicitly reveals.
- Live monitor page streams gameplay so an audience can pull up the running game.
- Old School Essentials rules/docs come from JoelClaw docs/PDF Brain first, then may migrate into Cloudflare Vectorize + FTS.

## Guardrails

- Do not build a generic VTT first.
- Do not give player agents omniscient state access.
- Do not make public demo endpoints leak copyrighted/private rules corpus text.
- Do not hand-roll a whole agent harness unless Think/Pi/Flue fail the prototype needs.
- Use `agent-secrets` for Cloudflare credentials. Never hardcode secrets.
