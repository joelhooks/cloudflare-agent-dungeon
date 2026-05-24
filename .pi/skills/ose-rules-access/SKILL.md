---
name: ose-rules-access
description: Query JoelClaw docs/PDF Brain for Old School Essentials rules while preserving Referee-only access and avoiding public corpus leakage.
---

# OSE Rules Access

Use when implementing or reviewing Old School Essentials rules lookup, Referee adjudication, `consultRules`, source citations, or public monitor output involving rules/source material.

## Policy

- RefereeAgent may consult rules/source.
- PlayerAgents must not access global rules/source unless the Referee deliberately exposes a bounded safe artifact.
- Public monitor output must never include raw private/copyrighted rules chunks.
- Prefer safe summaries, doc IDs, chunk IDs, and short citations over source text.
- Internal events may store doc/chunk IDs for audit and replay.

## Public docs API first

Start with JoelClaw docs/PDF Brain:

```bash
curl -sS https://joelclaw.com/api/docs
curl -sS "https://joelclaw.com/api/docs/search?q=Old%20School%20Essentials&perPage=5&semantic=false"
curl -sS "https://joelclaw.com/api/docs/search?q=Old-School%20Essentials%20referee&perPage=5&semantic=false"
```

Search narrow phrases. Keep `perPage` small. Use `semantic=false` first when checking exact terminology.

## Tool shape

A first `consultRules` tool should:

1. Accept a bounded query and optional adjudication context.
2. Call JoelClaw docs search.
3. Return small referee-facing excerpts or summaries plus doc IDs/chunk IDs.
4. Mark returned data as referee-private unless explicitly transformed into a player-safe/public artifact.
5. Never pass full book chunks into public monitor events.

## Output discipline

When reporting findings:

- Say what was searched.
- Include doc IDs/chunk IDs when available.
- Distinguish source-backed facts from Referee judgment.
- If evidence is thin, say so instead of filling gaps from model memory.
