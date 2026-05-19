"use client";

import { useRef } from "react";
import { supportsSwitchHaptic } from "@/lib/review/haptic";

/**
 * Returns a ref for the hidden iOS haptic label and a trigger function.
 *
 * The caller must render:
 *
 * ```tsx
 * <>
 *   <input
 *     ref={switchRef}
 *     type="checkbox"
 *     {...({ switch: "" } as unknown as React.InputHTMLAttributes<HTMLInputElement>)}
 *     aria-hidden="true"
 *     tabIndex={-1}
 *     className="sr-only pointer-events-none"
 *   />
 *   <label ref={labelRef} htmlFor={switchId} aria-hidden="true" className="sr-only pointer-events-none" />
 * </>
 * ```
 *
 * Toggling the label programmatically via `triggerIosHaptic()` makes iOS 17.4+
 * play a system haptic. When the `switch` attribute is not supported the
 * function is a no-op.
 */
export function useHapticSwitch() {
  const labelRef = useRef<HTMLLabelElement>(null);
  const supported = typeof window !== "undefined" && supportsSwitchHaptic();

  function triggerIosHaptic() {
    if (!supported) return;
    labelRef.current?.click();
  }

  return { labelRef, triggerIosHaptic: supported ? triggerIosHaptic : null };
}
