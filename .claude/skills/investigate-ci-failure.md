---
name: investigate-ci-failure
description: Root-cause CI failure investigation protocol. Use when a fix-round of CI failures fails to converge - replaces the reflex to dispatch a second sweep agent with a structured triage + evidence-gathering pass.
allowed-tools: [Bash, Read, Edit, Grep, Glob, Agent, TaskCreate, TaskUpdate, TaskList]
---

# Investigate CI Failure

A structured replacement for the "dispatch another sweep agent" reflex when a CI failure does not converge after the first fix-round. The protocol forces triage and evidence-gathering before any code change, so the fix targets the real root cause instead of pattern-matching against test names.

## When to use

Trigger this skill the moment a fix-round (the agent that ran after CI failed) **does not converge** - i.e. the next CI run still red, or still red on the same shape of failure. Do **not** wait until the second or third sweep has burned more agent hours.

Use it directly with `/investigate-ci-failure`, or from `/batch-issues` when the in-session reviewer or the PR queue drain hits this state. Memory record: `feedback_investigate_after_sweep_fail`.

## Why this exists

Memory record `feedback_investigate_after_sweep_fail`, plus the worked examples below, both make the same point: a CI failure that doesn't yield to one fix-round will not yield to a second one of the same shape. Sweep agents pattern-match on the failing test names and tweak fixtures or bump timeouts - that's exactly the wrong tool when the real cause is a production-code regression, a bundle-size cliff, or a perf budget breach.

Each sweep round costs roughly 30 min of agent time plus a 10-minute CI cycle. Three wasted rounds is ~2 hours before anyone reads the trace.

## The protocol

### 1. Stop and triage

Do not dispatch a fix agent. Pull the failure log and the list of failing tests with `gh run view <run-id> --log-failed` (or scroll the CI annotations). For each failing test, classify it into one of:

- **Logic** - mismatched expectation, missing fixture, dead UI element, copy drift, stale selector. Symptom looks like "expected X, received Y" or "element not found".
- **Perf** - timeout-shaped, slow first paint, bundle-parse stall, network-idle wait that never settles. Symptom looks like "Test timeout of 30000ms exceeded" or "Locator expected to be visible" after a long wait.

Write the classification down (even one line per test in a TODO list). The two shapes need completely different evidence.

### 2a. Perf-shape failures - mandate a Playwright trace

A perf-shape failure cannot be diagnosed from the test source alone. The actual frame timings live in the trace.

1. Reproduce locally with tracing on, against the pinned image so you don't fall into the Node-version pit (AGENTS.md "E2E suite fails locally but passes in CI"):

   ```bash
   docker run --rm -v "$PWD":/work -w /work \
     mcr.microsoft.com/playwright:v1.60.0-noble \
     bash -c "npm ci && npm run build && (npm start &) && \
              npx wait-on --timeout 60000 http://localhost:3000 && \
              npx playwright test --project=chromium --trace=on <spec>"
   ```

2. Open `playwright-report/` (or the trace zip) and read the timings of the dominant phases:

   - **Bundle parse / hydrate**: how long does the JS bundle take to evaluate? A new dependency or a fattened seed payload shows up here.
   - **`buildSession` / SRS setup**: the first review-session build is the heaviest single synchronous step on the practice surface.
   - **IDB write**: per-grade upsert latency on WebKit is materially worse than Chromium.
   - **React first paint**: time from hydrate to first interactive frame.

3. Record the dominant phase and its duration in the commit message ("trace shows 2.96 MB seed JSON parsed in 1.8s on WebKit before first paint"). That single line is what protects the next investigation from re-running the same trace.

### 2b. Logic-shape failures - read the code path, not just the test

A logic-shape failure looks easy ("the test expects 'Pasture' and the page says 'Pasture (3)'") but the temptation to fix the test in place is exactly what produces sweep-round cycles. Read the production path the test exercises **before** touching the test.

1. Open the failing test file. Identify the locator / assertion that fails and the user flow that leads to it.
2. Read the component, page, hook, or lib function that renders the asserted state. Not just the file the test names - follow the imports until you reach the function that produces the actual output the assertion sees.
3. Identify the divergence: is the test asserting an old contract (the UI changed deliberately), or is the UI rendering wrong output (the test caught a regression)?
4. Only now decide whether the fix is fixture-level (update the test) or production-code-level (revert / repair the regression).

### 3. Document the evidence in the commit

The commit that lands the fix must record the evidence, not just the change. Two reasons:

- The next time the same shape fails, a human or agent reading `git log` sees what the diagnosis looked like and skips re-investigating.
- It forces the author to actually look at evidence, not pattern-match.

Use this shape in the body:

```
Root cause: <one line>.
Evidence: <trace timing | code reference | log excerpt>.
Fix: <fixture-level | production-code> at <file:line>.
```

### 4. Only now decide the fix shape

By this point the choice between "update fixture" and "fix production code" is mechanical. If the evidence shows the production code regressed, fix the production code; never paper over a regression with a fixture tweak. If the evidence shows the test is asserting a stale contract, update the test and call that out in the PR description.

## Anti-patterns this skill replaces

- **Dispatching a second sweep agent** after the first one failed. Two sweeps of the same shape do not converge - the shape is wrong.
- **Bumping the Playwright timeout** to make a perf-shape failure pass. This hides the regression and pushes it onto the next browser project where the timeout is tighter.
- **Updating a snapshot or selector** to match what the page currently renders, without first reading whether the page should render that.
- **Reading only the failing test source** for a logic-shape failure. The bug rarely lives in the test file; the test file is the witness.

## Worked example 1: #1234 (Generation 9 / +250 cards / WebKit perf)

The #1234 batch doubled the card count and broke WebKit perf. The first three fix rounds were sweep agents briefed with "the e2e suite is red, fix the failing tests". Each round pattern-matched on the failing spec names and tweaked fixtures or bumped timeouts. None converged - the next CI run was still red on the same shape.

The fourth round was briefed differently: "investigate, do not dispatch a sweep, capture Playwright traces". Within one round the trace showed the dominant phase was a 2.96 MB seed JSON being parsed synchronously on WebKit before first paint, well outside the test's 30s timeout. The fix was production-code (lazy-load + streaming parse), not fixture-level.

Cost of the wrong tool: ~2 hours of agent time plus three CI cycles. Cost of the right tool on first contact: one investigation round.

Memory record: `feedback_perf_budget_in_planner` - features that scale a count must include a WebKit timing-budget consideration in the planner step.

## Worked example 2: #1263 (sweep rounds, WebKit timing)

Same shape, different feature. Sweep rounds tried to land fixes on visible failure names. The investigation round read the trace and found the actual stall - bundle parse on WebKit - was nowhere near the test file the failures pointed at. The fix lived in the production bundle config, not the test fixtures.

Same lesson, same memory record. The skill exists so the orchestrator (and future-me) does not re-learn it from the cost side again.

## Related references

- Memory: `feedback_investigate_after_sweep_fail` - the precipitating note.
- Memory: `feedback_perf_budget_in_planner` - the planner-step prevention for perf failures.
- Memory: `feedback_agent_fix_full_audit` - for recurring fix patterns, audit the whole repo not just the visible failures.
- AGENTS.md "Backlog / process" - the protocol pointer.
- `.claude/commands/batch-issues.md` - the drain workflow that delegates to this skill on the first non-convergence.
