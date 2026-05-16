// scripts/seed-tts-audio.mjs
// Pre-generates Google Cloud TTS MP3 files for every Pokémon in
// lib/pokemon/generated.json and writes them to public/audio/names/<id>.mp3.
//
// Run with: npm run seed:tts
// Node 20+ — uses global fetch, node:fs/promises, node:path, node:url.
//
// Prerequisites:
//   GOOGLE_CLOUD_TTS_API_KEY must be set in the environment (or .env.local).
//   The key only needs Text-to-Speech API access.

import { writeFile, mkdir, rename, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// The stable en-GB Chirp 3 HD voice used for all audio files.
// To swap voices: change this constant and re-run the script (existing files
// will be skipped; delete the output directory first for a full regeneration).
const TTS_VOICE_NAME = "en-GB-Chirp3-HD-Aoede";

const TTS_API_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";
// Concurrency is kept modest: the Cloud TTS per-minute quota is easily
// overshot by a fast burst, and 429s then dominate the run.
const CONCURRENCY = 6;
const MAX_RETRIES = 3;
const BACKOFF_MS = [500, 1000, 2000];
// 429 (rate limit) is transient and retryable — back off generously so a
// one-off full run completes rather than silently skipping names.
const RATE_LIMIT_MAX_RETRIES = 6;
const RATE_LIMIT_BACKOFF_MS = [2000, 5000, 10000, 20000, 30000, 60000];
const PROGRESS_INTERVAL = 50;

// ---------------------------------------------------------------------------
// IMPORTANT: inlined copy of pronunciations logic from lib/audio/pronunciations.ts
//
// This .mjs script cannot import the .ts module directly. This copy MUST be
// kept in sync with:
//   - stripDecorativeSymbols() in lib/audio/pronunciations.ts
//   - the OVERRIDES dictionary in lib/audio/pronunciations.ts
//
// When adding or modifying overrides, update BOTH places.
// ---------------------------------------------------------------------------

/**
 * Remove the ♀ (U+2640) and ♂ (U+2642) decorative gender symbols from a
 * Pokémon display name and collapse any resulting extra whitespace.
 */
function stripDecorativeSymbols(name) {
  return name.replace(/[♀♂]/g, "").replace(/\s+/g, " ").trim();
}

/** @type {Record<string, string>} */
const OVERRIDES = {
  // Orthographic curveballs: hyphens, apostrophes, accents, special glyphs,
  // missing letters. The synth otherwise parses these as separators / errors.
  "farfetch'd": "farfetched",
  "farfetch’d": "farfetched",
  "sirfetch'd": "sir fetched",
  "sirfetch’d": "sir fetched",
  "type: null": "type null",
  "flabébé": "flah bay bay",
  feraligatr: "feral i gay tor",
  qwilfish: "kwill fish",
  overqwil: "oh ver kwil",
  porygon2: "porygon two",
  "porygon-z": "porygon zee",
  "ho-oh": "ho oh",
  "jangmo-o": "jang mo oh",
  "hakamo-o": "ha ka mo oh",
  "kommo-o": "kom mo oh",
  "tapu koko": "tah poo koh koh",
  "tapu lele": "tah poo lay lay",
  "tapu bulu": "tah poo boo loo",
  "tapu fini": "tah poo fee nee",

  // The "tw" digraph trips most synths.
  mewtwo: "mew two",

  // "qua" → /kw/ is consistently mangled.
  rayquaza: "ray kwah zuh",
  araquanid: "uh rak wah nid",

  // Eeveelutions: the "-eon" suffix routinely gets read as a single syllable.
  vaporeon: "vay por ee on",
  jolteon: "jolt ee on",
  flareon: "flair ee on",
  espeon: "es pee on",
  umbreon: "um bree on",
  leafeon: "leaf ee on",
  glaceon: "glay see on",
  sylveon: "sil vee on",

  // Kanto.
  caterpie: "ca ter pee",
  pidgeotto: "pid jee ot oh",
  pidgeot: "pid jee ot",
  rattata: "rat tat ah",
  dugtrio: "dug tree oh",
  growlithe: "growl ith",
  machop: "ma chop",
  machoke: "ma choke",
  machamp: "ma champ",
  victreebel: "vic tree bell",
  geodude: "jee oh dude",
  doduo: "doh doo oh",
  dodrio: "doh dree oh",
  exeggcute: "egg ze cute",
  exeggutor: "egg ze cu tor",
  lickitung: "lick ee tung",
  kangaskhan: "kang us kahn",
  gyarados: "gah ruh dose",
  porygon: "por ih gon",
  omanyte: "oh ma nite",
  omastar: "oh ma star",
  kabutops: "kab oo tops",
  aerodactyl: "air oh dac til",
  articuno: "ar ti koo no",
  zapdos: "zap dose",
  moltres: "mole tres",

  // Johto.
  cyndaquil: "sin duh kwill",
  typhlosion: "tie flow zhun",
  ariados: "air ee a dose",
  xatu: "zah too",
  ampharos: "am fa ros",
  sudowoodo: "soo doh woo doh",
  politoed: "pol ee toad",
  quagsire: "kwag sire",
  misdreavus: "miss dree vus",
  unown: "un own",
  wobbuffet: "wob buh fay",
  girafarig: "ji raf uh rig",
  teddiursa: "teh dee ur sa",
  mantine: "man teen",
  phanpy: "fan pee",
  tyrogue: "tie rog",
  raikou: "rye koo",
  entei: "en tay",
  suicune: "swee koon",
  tyranitar: "tie ran i tar",
  lugia: "loo gee uh",
  celebi: "sel uh bee",

  // Hoenn.
  sceptile: "sep tile",
  poochyena: "pooch yee nah",
  mightyena: "might yee nah",
  linoone: "li noon",
  sableye: "say bul eye",
  mawile: "may while",
  gardevoir: "gar duh vwar",
  electrike: "ee lek trike",
  plusle: "ploo sul",
  minun: "my nun",
  carvanha: "car vah nuh",
  altaria: "al tar ee uh",
  kecleon: "kek lee on",
  chimecho: "chime eh ko",
  regirock: "reh jee rock",
  regice: "reh jice",
  registeel: "reh jee steel",
  latias: "la tee us",
  latios: "la tee os",
  kyogre: "kai oh ger",
  groudon: "grow don",
  deoxys: "dee ox iss",

  // Sinnoh.
  budew: "boo dew",
  pachirisu: "pa chee ree soo",
  buizel: "bwee zul",
  mismagius: "miss may jus",
  electivire: "ee lek ti vire",
  gallade: "guh lade",
  dusknoir: "dusk nwar",
  uxie: "yook see",
  regigigas: "reh jee gie gus",
  giratina: "geer uh tee nuh",
  cresselia: "cress eh lee uh",
  phione: "fee oh nee",
  darkrai: "dark rye",
  arceus: "ar see us",
  lucario: "loo car ee oh",

  // Unova.
  sigilyph: "sig il iff",
  cofagrigus: "kof uh gree gus",
  tirtouga: "tir too gah",
  zorua: "zoh roo ah",
  zoroark: "zoh roh ark",
  reuniclus: "ree yoo nih klus",
  alomomola: "al oh moh moh lah",
  elgyem: "el jee em",
  beheeyem: "be hee em",
  chandelure: "chan del yoor",
  bouffalant: "boo fuh lahnt",
  hydreigon: "hi dry gon",
  volcarona: "vol kuh roh nuh",
  cobalion: "co bay lee on",
  terrakion: "ter ah kee on",
  virizion: "vi riz ee on",
  kyurem: "kyur em",
  genesect: "jen eh sect",

  // Kalos.
  braixen: "brake sen",
  furfrou: "fur froo",
  xerneas: "zur nee us",
  yveltal: "ee vell tahl",
  zygarde: "zy gard",
  diancie: "die an see",

  // Alola.
  mareanie: "mar ee nee",
  tsareena: "zar ee nah",
  pyukumuku: "pyoo koo moo koo",
  togedemaru: "to geh de ma roo",
  mimikyu: "mee mee kyoo",
  dhelmise: "del mize",
  nihilego: "ni hil eh go",
  pheromosa: "fer uh moh sah",
  xurkitree: "zur ki tree",
  necrozma: "neh kroz muh",
  magearna: "muh gear nah",
  naganadel: "na ga nay del",
  blacephalon: "blay sef uh lon",
  zeraora: "zer ay or ah",

  // Galar / Hisui.
  sinistea: "sin is tay ah",
  polteageist: "polt ur geist",
  perrserker: "per sur ker",
  runerigus: "roon er ih gus",
  eiscue: "ice kyoo",
  zacian: "zah shee an",
  zamazenta: "zah muh zen tuh",
  regieleki: "reh jee eh lek ee",
  regidrago: "reh jee dray go",
  wyrdeer: "wur deer",
  basculegion: "bas kyu lee jun",

  // Paldea.
  fuecoco: "fway co co",
  fidough: "fye doh",
  armarouge: "ar muh rooj",
  ceruledge: "ser u lej",
  grafaiai: "gruh fie eye",
  toedscool: "toad skool",
  toedscruel: "toad skroo el",
  gimmighoul: "gim ee gool",
};

/**
 * Resolve the spoken text for a Pokémon display name.
 * 1. Strip ♀/♂ symbols.
 * 2. Lowercase and check OVERRIDES.
 * 3. If no override, use the stripped display name.
 */
function spokenTextFor(displayName) {
  const stripped = stripDecorativeSymbols(displayName);
  const override = OVERRIDES[stripped.toLowerCase()];
  return override ?? stripped;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sleep for `ms` milliseconds. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Write `buffer` to `destPath` atomically: write to a unique sibling temp
 * file first, then rename it into place. rename() on the same filesystem is
 * atomic, so a concurrent reader sees either the old file or the fully-written
 * new one — never a partial write.
 */
async function writeFileAtomic(destPath, buffer) {
  const tmpPath = `${destPath}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tmpPath, buffer);
    await rename(tmpPath, destPath);
  } catch (err) {
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(tmpPath);
    } catch {
      // ignore — temp file may not exist
    }
    throw err;
  }
}

/** Returns true if `filePath` already exists (for skip-if-exists logic). */
async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * POST to the Google Cloud TTS API with retry on 429 / 5xx / network errors.
 * On HTTP 429: retries with generous backoff (honouring Retry-After); if still
 *   rate-limited after RATE_LIMIT_MAX_RETRIES, returns { ok: false, skip: false }
 *   so the entry counts as a real failure (re-run to retry).
 * On network error / 5xx after retries: returns { ok: false, reason, skip: false }.
 * On 4xx (non-429): warns and returns { ok: false, reason, skip: true }.
 * On success: returns { ok: true, audioContent } (base64 string).
 */
async function synthesize(text, apiKey) {
  const url = `${TTS_API_URL}?key=${apiKey}`;
  const body = JSON.stringify({
    input: { text },
    voice: { languageCode: "en-GB", name: TTS_VOICE_NAME },
    audioConfig: { audioEncoding: "MP3" },
  });

  let attempt = 0;
  let rateLimitAttempt = 0;
  while (true) {
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    } catch (networkErr) {
      if (attempt < MAX_RETRIES) {
        const delay = BACKOFF_MS[attempt];
        process.stderr.write(
          `[tts] WARN: network error for "${text}" (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms: ${networkErr.message}\n`,
        );
        await sleep(delay);
        attempt++;
        continue;
      }
      return { ok: false, reason: networkErr.message, skip: false };
    }

    if (res.status === 429) {
      if (rateLimitAttempt < RATE_LIMIT_MAX_RETRIES) {
        const retryAfterSec = Number(res.headers.get("retry-after"));
        const base = RATE_LIMIT_BACKOFF_MS[Math.min(rateLimitAttempt, RATE_LIMIT_BACKOFF_MS.length - 1)];
        // Honour Retry-After when given; add jitter to avoid a thundering herd.
        const delay =
          (Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : base) +
          Math.floor(Math.random() * 1000);
        process.stderr.write(
          `[tts] WARN: rate-limited for "${text}" (attempt ${rateLimitAttempt + 1}/${RATE_LIMIT_MAX_RETRIES + 1}), retrying in ${delay}ms\n`,
        );
        await sleep(delay);
        rateLimitAttempt++;
        continue;
      }
      process.stderr.write(`[tts] WARN: still rate-limited for "${text}" after ${RATE_LIMIT_MAX_RETRIES + 1} attempts\n`);
      return { ok: false, reason: "rate-limited", skip: false };
    }

    if (res.status >= 500) {
      if (attempt < MAX_RETRIES) {
        const delay = BACKOFF_MS[attempt];
        process.stderr.write(
          `[tts] WARN: HTTP ${res.status} for "${text}" (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms\n`,
        );
        await sleep(delay);
        attempt++;
        continue;
      }
      return { ok: false, reason: `HTTP ${res.status}`, skip: false };
    }

    if (!res.ok) {
      // 4xx other than 429 — non-retryable
      let errDetail = "";
      try {
        const errBody = await res.json();
        errDetail = errBody?.error?.message ?? "";
      } catch {
        // ignore
      }
      process.stderr.write(
        `[tts] WARN: HTTP ${res.status} for "${text}"${errDetail ? `: ${errDetail}` : ""}, skipping\n`,
      );
      return { ok: false, reason: `HTTP ${res.status}`, skip: true };
    }

    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      process.stderr.write(
        `[tts] WARN: JSON parse error for "${text}": ${parseErr.message}, skipping\n`,
      );
      return { ok: false, reason: "json-parse", skip: true };
    }

    if (!data.audioContent) {
      process.stderr.write(`[tts] WARN: empty audioContent for "${text}", skipping\n`);
      return { ok: false, reason: "empty-audio-content", skip: true };
    }

    return { ok: true, audioContent: data.audioContent };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const apiKey = process.env.GOOGLE_CLOUD_TTS_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      "[tts] ERROR: GOOGLE_CLOUD_TTS_API_KEY is not set.\n" +
        "  Set it in your environment or in .env.local and re-run npm run seed:tts\n" +
        "  This key is only needed to regenerate audio files — it is never used at runtime.\n",
    );
    process.exit(1);
  }

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const generatedPath = resolve(__dirname, "../lib/pokemon/generated.json");
  const outputDir = resolve(__dirname, "../public/audio/names");

  // Load generated.json.
  let pokemon;
  try {
    const raw = await import(generatedPath, { assert: { type: "json" } }).catch(async () => {
      // Fallback: read and parse manually (import assertions may not be
      // available in all Node 20 builds).
      const { readFile } = await import("node:fs/promises");
      return { default: JSON.parse(await readFile(generatedPath, "utf-8")) };
    });
    pokemon = raw.default;
  } catch (err) {
    process.stderr.write(`[tts] ERROR: could not read lib/pokemon/generated.json: ${err.message}\n`);
    process.exit(1);
  }

  if (!Array.isArray(pokemon) || pokemon.length === 0) {
    process.stderr.write("[tts] ERROR: lib/pokemon/generated.json is empty or not an array\n");
    process.exit(1);
  }

  await mkdir(outputDir, { recursive: true });

  const total = pokemon.length;
  let written = 0;
  let skipped = 0;
  let failed = 0;
  let done = 0;

  process.stderr.write(
    `[tts] Generating audio for ${total} Pokémon using voice ${TTS_VOICE_NAME}\n`,
  );

  for (let i = 0; i < pokemon.length; i += CONCURRENCY) {
    const batch = pokemon.slice(i, i + CONCURRENCY);

    await Promise.all(
      batch.map(async (entry) => {
        const { id, displayName } = entry;
        const destPath = resolve(outputDir, `${id}.mp3`);

        // Skip-if-exists: resumable.
        if (await fileExists(destPath)) {
          skipped++;
          done++;
          return;
        }

        const text = spokenTextFor(displayName);
        const result = await synthesize(text, apiKey);

        if (!result.ok) {
          if (result.skip) {
            skipped++;
          } else {
            failed++;
            process.stderr.write(
              `[tts] FAIL: ${id} (${displayName}) — ${result.reason}\n`,
            );
          }
          done++;
          return;
        }

        try {
          const buffer = Buffer.from(result.audioContent, "base64");
          await writeFileAtomic(destPath, buffer);
          written++;
        } catch (writeErr) {
          failed++;
          process.stderr.write(
            `[tts] FAIL: could not write ${destPath}: ${writeErr.message}\n`,
          );
        }
        done++;
      }),
    );

    if (done % PROGRESS_INTERVAL === 0 || done === total) {
      process.stderr.write(`[tts] [${done}/${total}] written=${written} skipped=${skipped} failed=${failed}\n`);
    }
  }

  process.stderr.write(
    `\n[tts] Done. total=${total} written=${written} skipped=${skipped} failed=${failed}\n`,
  );

  if (failed > 0) {
    process.stderr.write(
      `[tts] ${failed} file(s) failed — re-run to retry (already-written files will be skipped).\n`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`[tts] FATAL: ${err.message}\n${err.stack ?? ""}\n`);
  process.exit(1);
});
