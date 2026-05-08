# poke-memory

An Anki-style spaced-repetition app for learning Pokémon names and evolutions, with progress tracking of what the user knows. A Pokédex browser is a secondary surface.

This repo also serves as a sandbox for practicing Claude Code sub-agent workflows — see the roster and playbook below. When choosing how to do work here, lean toward demonstrating sub-agent patterns over the fastest path, but only when the agent earns its keep.

## Stack
- Next.js 16.2.5 (App Router)
- React 19.2.4
- Tailwind CSS 4
- TypeScript 5

<!-- BEGIN:nextjs-agent-rules -->
## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Sub-agent roster

Custom agents live in `.claude/agents/`. Invoke via the Agent tool with `subagent_type: "<name>"`.

| Agent | When to use |
|---|---|
| [next16-expert](.claude/agents/next16-expert.md) | Any Next.js 16 API / caching / routing / rendering question. Read-only. |
| [pokeapi-expert](.claude/agents/pokeapi-expert.md) | Choosing PokéAPI endpoints, schemas, caching. Use BEFORE writing integration code. |
| [srs-expert](.claude/agents/srs-expert.md) | Designing/implementing the spaced-repetition scheduler. |
| [planner](.claude/agents/planner.md) | Designing an implementation plan before any code is written. |
| [researcher](.claude/agents/researcher.md) | Generalist investigation that doesn't fit a specialist. |
| [ui-coder](.claude/agents/ui-coder.md) | Pages, layouts, components, styling. |
| [data-coder](.claude/agents/data-coder.md) | API routes, Server Actions, persistence, integrations. |
| [code-reviewer](.claude/agents/code-reviewer.md) | Independent diff review at the end of a change. Read-only. |

## Orchestration playbook

The main agent (Claude in the user's session) orchestrates. Coder agents do not call other agents directly — they receive research findings via the prompt. The standard flow for non-trivial work:

1. **Plan** — invoke `planner`. It surfaces unknowns to research first.
2. **Research in parallel** — invoke specialists (`next16-expert`, `pokeapi-expert`, `srs-expert`, `researcher`) in a single message when their questions are independent. Pass findings to coders via prompt.
3. **Implement** — invoke `ui-coder` and/or `data-coder` with full context (research findings + spec). Run them in parallel when their work is independent.
4. **Review** — invoke `code-reviewer` at the end. Iterate on its punch list.

When *not* to use a sub-agent: small one-off edits, single-file changes, or anything where the round-trip cost outweighs the value. Seeing when to skip an agent is part of the practice.

## File ownership

| Path | Owner |
|---|---|
| `app/**/page.tsx`, `app/**/layout.tsx`, `app/**/loading.tsx`, `app/**/error.tsx` | ui-coder |
| `components/**` | ui-coder |
| `app/api/**` | data-coder |
| `lib/**` | data-coder |
| `db/**` | data-coder |
| Server Actions | data-coder (implementation), ui-coder (call sites) |
| SRS scheduler | srs-expert designs the algorithm; data-coder implements + persists |
| PokéAPI integration | pokeapi-expert designs endpoints/caching; data-coder implements |

## Conventions

*(To be filled in as the project develops. Don't fabricate conventions here — add them only when adopted through actual code decisions.)*
