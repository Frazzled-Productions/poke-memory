// Without Cache Components (off for the Cloudflare move, decision 0018) this
// route would be prerendered at build time and its deliberate throw would fail
// the build, so it renders per request instead.
export const dynamic = "force-dynamic";

export default function TestErrorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
