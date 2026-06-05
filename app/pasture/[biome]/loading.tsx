/**
 * Suspense boundary for the /pasture/[biome] segment.
 *
 * With Cache Components enabled (`cacheComponents: true`), accessing
 * `params` - a runtime API - in a page component requires the component
 * to sit inside a <Suspense> boundary. This file provides that boundary
 * automatically for the entire segment (page + children).
 *
 * The fallback renders the same fixed-viewport shell the page uses,
 * so the chrome (bg-background) is consistent during the brief hydration gap.
 */
export default function Loading() {
  return <div className="fixed inset-0 bg-background" aria-hidden="true" />;
}
