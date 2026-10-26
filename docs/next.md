# Next

written: 2026-10-26

## Next
1. Build the comeback return mode from its approved proposal in draft PR #2194 (#2191); #2189 is merged, so it can start.
2. Propose change 2 of #2187, the favourite finder (bracket and daily duels); decisions are on #2187.
3. Root-cause the order-dependent `usePerGradeSyncHold` test flake (#2190); it can turn the required `test` job red.
4. Triage the baseline oddities found while specifying #2187 and #2191 (#2188, #2193).

## Waiting on Fraser
- None from the favourites or comeback work.

## Watch out
- The OpenSpec archive bot is blocked by merged changes with unticked tasks (#2195, #2192); `favourite-everywhere` archives once they clear.
- Run tests on Node 24 (`/opt/homebrew/opt/node@24/bin`); Node 26 breaks jsdom `localStorage`.
- `next dev` rewrites AGENTS.md with an em-dash block; never commit that change.
