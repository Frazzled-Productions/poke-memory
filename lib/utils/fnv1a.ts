export const FNV_PRIME = 16777619;
export const FNV_OFFSET = 2166136261;

export function fnv1a(s: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash;
}
