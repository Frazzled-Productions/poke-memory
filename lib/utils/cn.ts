/**
 * Lightweight class-name composition helper.
 *
 * Accepts any mix of strings, booleans, null, and undefined - falsy values are
 * silently dropped. Equivalent to the popular `clsx` library for the subset of
 * features this project needs, with no external dependency.
 *
 * Usage:
 *   cn("base-class", condition && "conditional-class", undefined)
 *   // → "base-class conditional-class"
 */
export function cn(
  ...classes: (string | false | null | undefined)[]
): string {
  return classes.filter(Boolean).join(" ");
}
