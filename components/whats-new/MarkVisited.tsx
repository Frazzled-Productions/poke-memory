"use client";

import { useEffect } from "react";
import { writeLastSeenVersion } from "@/lib/version/lastSeen";

export function MarkVisited({ version }: { version: string }) {
  useEffect(() => {
    writeLastSeenVersion(version);
  }, [version]);
  return null;
}
