// Maps a PokéAPI `EvolutionDetail` to a natural-English suffix that fits
// after "What does {name} evolve into ". Returns null for shapes we don't
// recognise so the caller can fall back to the bare prompt.
//
// Multi-condition policy: concatenate, level/core-trigger first, then
// physical/move-known, then context/environment, then party.

export type EvolutionDetail = {
  trigger: string;
  min_level: number | null;
  min_happiness: number | null;
  min_affection: number | null;
  min_beauty: number | null;
  min_move_count: number | null;
  min_steps: number | null;
  min_damage_taken: number | null;
  time_of_day: "day" | "night" | null;
  location: string | null;
  known_move: string | null;
  known_move_type: string | null;
  held_item: string | null;
  needs_overworld_rain: boolean;
  turn_upside_down: boolean;
  relative_physical_stats: -1 | 0 | 1 | null;
  gender: 1 | 2 | null;
  party_species: string | null;
  party_type: string | null;
  item: string | null;
  trade_species: string | null;
  used_move: string | null;
};

function titleCase(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w.length === 0 ? "" : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

function timeOfDayPhrase(tod: "day" | "night" | null): string | null {
  if (tod === "day") return "during the day";
  if (tod === "night") return "at night";
  return null;
}

function relativeStatsPhrase(rel: -1 | 0 | 1 | null): string | null {
  if (rel === 1) return "with Attack > Defense";
  if (rel === -1) return "with Defense > Attack";
  if (rel === 0) return "with Attack = Defense";
  return null;
}

function genderPhrase(g: 1 | 2 | null): string | null {
  if (g === 1) return "(female)";
  if (g === 2) return "(male)";
  return null;
}

// Levels phrase varies by what else is populated. Returns the level fragment
// (e.g. "at level 16") or "at any level" when no min_level is set on a level-up.
function levelPhrase(detail: EvolutionDetail): string {
  if (detail.min_level !== null) return `at level ${detail.min_level}`;
  return "at any level";
}

function levelUpPhrase(detail: EvolutionDetail): string | null {
  const fragments: string[] = [];

  // Friendship / affection / beauty take precedence over a bare level prompt
  // when the level is implicit (PokéAPI may set min_level to null when
  // the condition is friendship-driven).
  if (detail.min_happiness !== null && detail.min_level === null) {
    fragments.push("with high friendship");
  } else if (
    detail.min_affection !== null &&
    detail.min_level === null &&
    detail.known_move_type !== null
  ) {
    fragments.push(
      `with high affection knowing a ${titleCase(detail.known_move_type)} move`,
    );
  } else if (detail.min_beauty !== null) {
    fragments.push("with maxed beauty");
  } else if (detail.min_steps !== null) {
    fragments.push(`after walking ${detail.min_steps} steps with it in the party`);
  } else if (detail.min_damage_taken !== null) {
    fragments.push(`after taking ${detail.min_damage_taken}+ damage in one battle`);
  } else {
    fragments.push(levelPhrase(detail));
    if (detail.min_happiness !== null) fragments.push("with high friendship");
  }

  // Physical / move-known
  const rel = relativeStatsPhrase(detail.relative_physical_stats);
  if (rel !== null) fragments.push(rel);
  if (detail.known_move !== null && detail.known_move_type === null) {
    fragments.push(`while knowing ${titleCase(detail.known_move)}`);
  }
  const gen = genderPhrase(detail.gender);
  if (gen !== null) fragments.push(gen);

  // Context / environment
  const tod = timeOfDayPhrase(detail.time_of_day);
  if (tod !== null) fragments.push(tod);
  if (detail.location !== null) fragments.push(`near ${titleCase(detail.location)}`);
  if (detail.needs_overworld_rain) fragments.push("in the rain");
  if (detail.turn_upside_down) fragments.push("held upside-down");
  if (detail.held_item !== null) {
    fragments.push(`while holding a ${titleCase(detail.held_item)}`);
  }

  // Party
  if (detail.party_species !== null) {
    fragments.push(`with a ${titleCase(detail.party_species)} in the party`);
  }
  if (detail.party_type !== null) {
    fragments.push(`with a ${titleCase(detail.party_type)}-type in the party`);
  }

  return fragments.join(" ");
}

function tradePhrase(detail: EvolutionDetail): string {
  if (detail.trade_species !== null) {
    return `by trading it for a ${titleCase(detail.trade_species)}`;
  }
  if (detail.held_item !== null) {
    return `by trading it while holding a ${titleCase(detail.held_item)}`;
  }
  return "by trading it";
}

function useItemPhrase(detail: EvolutionDetail): string | null {
  if (detail.item === null) return null;
  return `using a ${titleCase(detail.item)}`;
}

function useMovePhrase(detail: EvolutionDetail): string | null {
  if (detail.used_move === null) return null;
  return `by using ${titleCase(detail.used_move)} repeatedly`;
}

function stylePhrase(detail: EvolutionDetail, style: "agile" | "strong"): string | null {
  if (detail.used_move === null) return null;
  const count = detail.min_move_count ?? null;
  const suffix = count !== null ? ` ${count} times` : " enough times";
  return `by using ${titleCase(detail.used_move)} in the ${style} style${suffix}`;
}

function recoilPhrase(detail: EvolutionDetail): string {
  if (detail.min_damage_taken !== null) {
    return `after taking ${detail.min_damage_taken}+ recoil damage in one battle`;
  }
  return "after taking enough recoil damage";
}

export function triggerPhrase(detail: EvolutionDetail | null): string | null {
  if (detail === null) return null;

  switch (detail.trigger) {
    case "level-up":
      return levelUpPhrase(detail);
    case "use-item":
      // `useItemPhrase` is a plain phrase-builder, not a React hook — the
      // `use` prefix is incidental. Disable the false-positive here.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      return useItemPhrase(detail);
    case "trade":
      return tradePhrase(detail);
    case "shed":
      return "with a spare Poké Ball and party slot at level 20";
    case "three-critical-hits":
      return "by landing three critical hits in one battle";
    case "tower-of-darkness":
      return "by completing the Tower of Darkness";
    case "tower-of-waters":
      return "by completing the Tower of Waters";
    case "agile-style-move":
      return stylePhrase(detail, "agile");
    case "strong-style-move":
      return stylePhrase(detail, "strong");
    case "recoil-damage":
      return recoilPhrase(detail);
    case "take-damage":
      return detail.min_damage_taken !== null
        ? `after taking ${detail.min_damage_taken}+ damage`
        : "after taking damage";
    case "three-defeated-bisharp":
      return "by defeating three Bisharp while holding a Leader's Crest";
    case "gimmighoul-coins":
      return "by collecting 999 Gimmighoul Coins";
    case "spin":
      return "by spinning while holding a Sweet";
    case "use-move":
      // `useMovePhrase` is a plain phrase-builder, not a React hook — the
      // `use` prefix is incidental. Disable the false-positive here.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      return useMovePhrase(detail);
    case "other":
      return null;
    default:
      return null;
  }
}
