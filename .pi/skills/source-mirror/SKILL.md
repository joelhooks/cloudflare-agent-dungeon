---
name: source-mirror
description: Clone/update project-local source mirrors under .agent-sources, keep them out of commits, and read docs/source before making API claims.
---

# Source Mirror

Use when researching Cloudflare Agents SDK, Think, Effect, prior inspiration repos, or any external source before implementation.

## Rules

- Clone source repos into project-local `.agent-sources/`.
- Keep `.agent-sources/` out of commits via `.git/info/exclude`, not project `.gitignore`, unless Joel explicitly wants it committed.
- Prefer shallow clones for speed.
- Read source/docs before claiming API behavior. Vibes are a footgun.

## Cloudflare Agents mirror

Expected setup:

```bash
mkdir -p .agent-sources
git clone --depth 1 --filter=blob:none https://github.com/cloudflare/agents.git .agent-sources/cloudflare-agents
printf '\n.agent-sources/\n' >> .git/info/exclude
```

Useful paths:

- `.agent-sources/cloudflare-agents/docs/**`
- `.agent-sources/cloudflare-agents/docs/think/**`
- `.agent-sources/cloudflare-agents/packages/agents/src/**`
- `.agent-sources/cloudflare-agents/packages/think/src/**`
- `.agent-sources/cloudflare-agents/examples/**`

## Effect source

Before writing, reviewing, or refactoring Effect code, hydrate/search official Effect source through the pi-effect/effect-source workflow.

Expected path:

```txt
.agent-sources/effect
```

## Research receipt

Capture source-backed findings in `.brain/resources/` with:

- local mirror path
- repo URL
- observed commit when useful
- files read
- answer / tradeoffs
- open questions

Do not let chat be the only record.
