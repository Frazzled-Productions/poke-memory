# Next.js 16 conventions in poke-memory

Moved out of `AGENTS.md` (2026-10-14). Read the relevant guide in `node_modules/next/dist/docs/`
before writing code; these are the repo's settled rules.

## Caching

- **Cache Components is enabled** (`cacheComponents: true` in `next.config.ts`). All cache APIs assume this model.
- Read-your-own-writes after a Server Action mutation: `updateTag(tag)` (Server Actions only).
- Background SWR-style invalidation from Route Handlers: `revalidateTag(tag, 'max')` (the single-arg form is deprecated and a TS error).
- `revalidatePath('/path')` only for path-level data, not specific tags.
- Tag underlying cached fetches with `cacheTag(...)` inside `'use cache'` functions - without that, `updateTag` has nothing to invalidate.

## Page params

- `params` and `searchParams` are `Promise` - always `await` them. Synchronous access is fully removed.
- Prefer the generated `PageProps<'/path/[seg]'>` helper after `next typegen` / first dev / first build. The manual inline `params: Promise<{ slug: string }>` always works without that step.
