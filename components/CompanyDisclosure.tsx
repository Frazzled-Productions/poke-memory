/**
 * Statutory trading disclosure required by the Companies Act 2006 / the Company,
 * LLP and Business (Names and Trading Disclosures) Regulations 2015.
 *
 * Single source of truth for the registered-name, company number, and registered
 * office shown on every reachable surface (Footer for desktop/hamburger-nav;
 * Settings -> About for bottom-nav mobile). #1565 Part A.
 */

import { mutedTextXs } from "@/lib/utils/class-names";
import { cn } from "@/lib/utils/cn";

/**
 * Company number as a constant so tests can import it without coupling to the
 * rendered string.
 */
export const COMPANY_NUMBER = "17258540";

/**
 * Renders the statutory disclosure line in muted XS text.
 * Accepts an optional `className` for per-site spacing adjustments.
 */
export function CompanyDisclosure({ className }: { className?: string }) {
  return (
    <p className={cn(mutedTextXs, className)}>
      Frazzled Productions Ltd, a company registered in England and Wales
      (company number {COMPANY_NUMBER}). Registered office: 71-75 Shelton
      Street, Covent Garden, London, WC2H 9JQ.
    </p>
  );
}
