import type { Metadata } from "next";
import { FsrsOptimiserPanel } from "@/components/settings/FsrsOptimiserPanel";

// Served cross-origin isolated (COOP + COEP headers in next.config.ts) so the
// threaded wasm optimiser can run; see components/settings/FsrsOptimiserPanel.tsx.
export const metadata: Metadata = {
  title: "Personalise my schedule - Poké Memory",
};

export default function OptimiserPage() {
  return <FsrsOptimiserPanel />;
}
