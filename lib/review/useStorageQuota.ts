"use client";

import { useState, useCallback } from "react";
import type { SaveResult } from "./persistence";

type UseStorageQuotaReturn = {
  quotaExceeded: boolean;
  dismiss: () => void;
  notifySaveResult: (result: SaveResult) => void;
};

export function useStorageQuota(): UseStorageQuotaReturn {
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  const notifySaveResult = useCallback((result: SaveResult) => {
    if (result.ok) {
      setQuotaExceeded(false);
    } else {
      setQuotaExceeded(true);
    }
  }, []);

  const dismiss = useCallback(() => {
    setQuotaExceeded(false);
  }, []);

  return { quotaExceeded, dismiss, notifySaveResult };
}
