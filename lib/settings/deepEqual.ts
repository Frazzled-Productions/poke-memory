/**
 * Recursive, order-insensitive deep equality check.
 *
 * Compares two arbitrary values for structural equality, treating object keys
 * in any insertion order as equivalent (i.e. `{ a: 1, b: 2 }` equals
 * `{ b: 2, a: 1 }`). This is the property that `JSON.stringify` does NOT
 * guarantee - key order in serialised output is engine-dependent and will
 * diverge when a validator reconstructs a sub-object via `Object.entries`
 * spread (which is the pattern used by `validateStreakProtection`,
 * `validateOnboarding`, and similar helpers in `lib/settings/persistence.ts`).
 *
 * Rules:
 *   - Primitives (string, number, boolean, null, undefined): strict equality.
 *   - Arrays: same length + element-wise recursive equality (order matters for
 *     arrays; `[1, 2]` is NOT equal to `[2, 1]`).
 *   - Plain objects: same key set + recursive equality for each value.
 *   - Other types (Date, Map, Set, functions, class instances) fall back to
 *     `Object.is` - this file only needs to compare plain JSON-serialisable
 *     settings sub-objects, so that edge is fine to leave as-is.
 *
 * Kept minimal - not exported for general use outside `lib/settings/`.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (
    a !== null &&
    b !== null &&
    typeof a === "object" &&
    typeof b === "object" &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const keysA = Object.keys(a as Record<string, unknown>);
    const keysB = Object.keys(b as Record<string, unknown>);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (
        !deepEqual(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
        )
      )
        return false;
    }
    return true;
  }

  return false;
}
