---
name: brain-maintenance
description: Maintain Cloudflare Agent Dungeon .brain notes as the durable project graph using PARA placement and source-backed receipts.
---

# Brain Maintenance

Use when adding durable project knowledge, source research, decisions, plans, or review receipts for Cloudflare Agent Dungeon.

## Canonical memory

`.brain/` is the durable project graph. Trackers, PRs, and chat are execution surfaces, not the memory system.

Placement:

- Project work, PRDs, shaping docs, plans, demos → `.brain/projects/`
- Durable systems, vocabulary, lifecycle rules → `.brain/areas/`
- Source-grounded research and reusable references → `.brain/resources/`
- Hard-to-reverse tradeoffs / ADR-grade decisions → `.brain/decisions/`
- Raw receipts / machine-readable evidence → `.brain/data/`

## Operating loop

For learning-driven prototype work:

1. Research a bounded mechanism from source.
2. Report plain-language findings and tradeoffs.
3. Implement only the smallest useful slice.
4. Capture the learning back into Brain.

## Good Brain notes

A useful note includes:

- title, kind, status, created date, tags
- the question being answered
- source files/commands/URLs consulted
- bottom-line answer
- tradeoffs and risks
- next questions
- links to related notes

## Skills to prefer

Use these when the organization or source grounding matters:

- `second-brain-execution`
- `para-operator`
- `brain-component-composition` when editing rendered `.svx` components/data

## Checks

After changing Brain structure or MDSvX notes, run the pi-notes Brain checker when available:

```bash
pi-notes brain check
```

If the local tool is not on PATH, use the Pi `pi_notes_brain_check` tool if available.
