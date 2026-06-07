// scripts/lib/seed-all-helpers.mjs
// Pure, unit-testable helpers extracted from the seed:all orchestrator.
// The orchestrator (scripts/seed-all.mjs) imports these so they can be tested
// without spawning child processes.

/**
 * Parse CLI arguments for the seed:all orchestrator.
 *
 * Recognised flags:
 *   --force   Pass --force to every child step that accepts it. Used when
 *             PokéAPI has corrected existing data (renames, fixed chains,
 *             better artwork) and a full regenerate is needed.
 *
 * @param {string[]} argv  process.argv slice (typically process.argv.slice(2))
 * @returns {{ force: boolean }}
 */
export function parseArgs(argv) {
  return { force: argv.includes("--force") };
}

/**
 * Build the ordered list of steps for the seed:all pipeline.
 *
 * Each step has:
 *   name        Human-readable label used in banner output.
 *   script      The npm script name as defined in package.json.
 *   skipReason  When non-null the step is skipped and this string is printed.
 *               Currently used to gate the TTS step on GOOGLE_CLOUD_TTS_API_KEY.
 *   forceFlag   Whether --force is forwarded to this step's underlying script
 *               when the orchestrator was invoked with --force.
 *
 * Correct order (enforced here, tested in unit tests):
 *   seed -> seed:sprites -> seed:tts -> seed:split
 *   -> generate:scope-lookup -> generate:pseudo-locale
 *
 * @param {{ force: boolean, hasTtsKey: boolean }} opts
 * @returns {Array<{ name: string, script: string, skipReason: string|null, forceFlag: boolean }>}
 */
export function buildStepList({ force, hasTtsKey }) {
  const ttsSkip = hasTtsKey
    ? null
    : "GOOGLE_CLOUD_TTS_API_KEY is not set - skipping TTS audio generation.\n" +
      "  Set the key and re-run `npm run seed:tts` (or `npm run seed:all`) to produce MP3s.\n" +
      "  The remaining steps will complete normally.";

  return [
    {
      name: "Fetch species from PokéAPI",
      script: "seed",
      skipReason: null,
      forceFlag: false, // seed-pokemon.mjs does not accept --force; it is always additive
    },
    {
      name: "Optimise sprites (PNG -> WebP)",
      script: "seed:sprites",
      skipReason: null,
      forceFlag: force, // optimise-sprites.mjs supports --force
    },
    {
      name: "Generate TTS audio",
      script: "seed:tts",
      skipReason: ttsSkip,
      forceFlag: false, // seed-tts-audio.mjs skips existing files by default; --force TBD
    },
    {
      name: "Split generated.json into shards",
      script: "seed:split",
      skipReason: null,
      forceFlag: false, // split-seed.mjs is always deterministic; no --force needed
    },
    {
      name: "Regenerate scope lookup table",
      script: "generate:scope-lookup",
      skipReason: null,
      forceFlag: false,
    },
    {
      name: "Regenerate pseudo-locale catalogue",
      script: "generate:pseudo-locale",
      skipReason: null,
      forceFlag: false,
    },
  ];
}

/**
 * Return the names of all steps in their run order.
 * Convenience for tests and banner output.
 *
 * @param {ReturnType<typeof buildStepList>} steps
 * @returns {string[]}
 */
export function stepScriptNames(steps) {
  return steps.map((s) => s.script);
}

/**
 * Format a step banner for console output.
 *
 * @param {number} index  Zero-based step index.
 * @param {number} total  Total number of steps.
 * @param {string} name   Step name.
 * @returns {string}
 */
export function formatStepBanner(index, total, name) {
  const pad = String(index + 1).padStart(String(total).length, "0");
  return `\n${"=".repeat(60)}\n[${pad}/${total}] ${name}\n${"=".repeat(60)}`;
}

/**
 * Format a failure message for a step that returned a non-zero exit code.
 *
 * @param {string} script  npm script name that failed.
 * @param {number} code    Exit code.
 * @returns {string}
 */
export function formatStepFailure(script, code) {
  return (
    `\nERROR: Step "npm run ${script}" failed with exit code ${code}.\n` +
    `  Fix the error above, then re-run:\n` +
    `    npm run seed:all\n` +
    `  Re-runs are safe: the orchestrator is additive by default.`
  );
}

/**
 * Format the final success summary.
 *
 * @param {number} skipped  Number of skipped steps.
 * @returns {string}
 */
export function formatSuccess(skipped) {
  const note =
    skipped > 0
      ? ` (${skipped} step${skipped === 1 ? "" : "s"} skipped - see warnings above)`
      : "";
  return `\nAll seed steps completed successfully${note}.\nReview the git diff, then commit the result.`;
}
