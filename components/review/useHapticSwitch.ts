"use client";

import { useMemo, useRef } from "react";
import { supportsSwitchHaptic } from "@/lib/review/haptic";

/**
 * Provides the wiring needed to trigger iOS-style haptic feedback via the
 * hidden-switch technique (iOS 17.4+, Mobile Safari).
 *
 * The caller must render a hidden `<input type="checkbox" switch>` and
 * `<label>`, attaching `labelRef` to the label. For example:
 *
 * ```tsx
 * const { labelRef, triggerIosHaptic } = useHapticSwitch();
 * const switchId = useId();
 *
 * // In JSX:
 * <>
 *   <input
 *     id={switchId}
 *     type="checkbox"
 *     {...({ switch: "" } as unknown as React.InputHTMLAttributes<HTMLInputElement>)}
 *     aria-hidden="true"
 *     tabIndex={-1}
 *     readOnly
 *     className="absolute -left-[9999px] pointer-events-none opacity-0"
 *   />
 *   <label
 *     ref={labelRef}
 *     htmlFor={switchId}
 *     aria-hidden="true"
 *     className="absolute -left-[9999px] pointer-events-none opacity-0"
 *   />
 * </>
 * ```
 *
 * Pass `triggerIosHaptic` to `triggerHaptic(grade, triggerIosHaptic)`.
 * When the `switch` attribute is not supported, `triggerIosHaptic` is `null`
 * and `triggerHaptic` will silently skip the iOS path.
 *
 * `supported` is memoised - `supportsSwitchHaptic()` (which allocates a DOM
 * element) runs only once per component mount.
 */
export function useHapticSwitch() {
  const labelRef = useRef<HTMLLabelElement>(null);
  // Memoised so supportsSwitchHaptic() (which creates a temporary DOM element)
  // runs only once per component mount, not on every render.
  const supported = useMemo(
    () => typeof window !== "undefined" && supportsSwitchHaptic(),
    [],
  );

  function triggerIosHaptic() {
    if (!supported) return;
    labelRef.current?.click();
  }

  return { labelRef, triggerIosHaptic: supported ? triggerIosHaptic : null, supported };
}
