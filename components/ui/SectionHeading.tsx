/**
 * Shared section heading component (added for #1729 / #1735).
 *
 * Emits the REAL semantic heading element for the given level - `<h2>` when
 * `level={2}`, `<h3>` when `level={3}`, and `<h4>` when `level={4}` - so
 * the document outline is correct (a wrong-level element would fail WCAG
 * 1.3.1).
 *
 * Styling follows the convention from `lib/utils/class-names.ts`:
 *   - level 2 → `sectionHeadingLg`  (text-xl  font-semibold text-foreground)
 *   - level 3 → `sectionHeading`    (text-lg  font-semibold text-foreground)
 *   - level 4 → `sectionHeadingSm`  (text-base font-semibold text-foreground)
 *
 * Exception: the version `<h2>` on the What's-new page intentionally stays at
 * `text-lg` (`sectionHeading`) because `text-xl` looks oversized beside the
 * small inline date. That is documented at the call site, not here.
 */

import type { ReactNode } from "react";
import {
  sectionHeading,
  sectionHeadingLg,
  sectionHeadingSm,
} from "@/lib/utils/class-names";

type Level = 2 | 3 | 4;

const CLASS_BY_LEVEL: Record<Level, string> = {
  2: sectionHeadingLg,
  3: sectionHeading,
  4: sectionHeadingSm,
};

interface SectionHeadingProps {
  /**
   * The semantic heading level. Determines both the HTML element emitted
   * (`<h2>`, `<h3>`, or `<h4>`) and the corresponding visual size.
   */
  level: Level;
  /** Accessible heading text (and optional markup). */
  children: ReactNode;
  /**
   * Optional HTML `id` so a sibling `<section aria-labelledby>` can
   * reference this heading.
   */
  id?: string;
  /** Optional extra Tailwind classes (e.g. `mb-4`). */
  className?: string;
}

export function SectionHeading({ level, children, id, className }: SectionHeadingProps) {
  const baseClass = CLASS_BY_LEVEL[level];
  const Tag = `h${level}` as "h2" | "h3" | "h4";
  return (
    <Tag id={id} className={[baseClass, className].filter(Boolean).join(" ")}>
      {children}
    </Tag>
  );
}
