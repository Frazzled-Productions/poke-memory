import type { Metadata } from "next";
import { getTranslations, getFormatter } from "next-intl/server";
import { getChangelog } from "@/lib/changelog/parse";
import { BulletText } from "@/components/whats-new/BulletText";
import { MarkVisited } from "@/components/whats-new/MarkVisited";
import { mutedTextXs, sectionHeading, sectionLabelSm, pageTitle } from "@/lib/utils/class-names";
import { PageShell } from "@/components/ui/PageShell";

export const metadata: Metadata = {
  title: "What's New - Poké Memory",
  description:
    "Recent updates to Poké Memory: new features, improvements, and bug fixes.",
};

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
const RELEASES_TO_SHOW = 20;

export default async function WhatsNewPage() {
  const t = await getTranslations("whatsNew");
  const format = await getFormatter();
  const releases = getChangelog().slice(0, RELEASES_TO_SHOW);

  return (
    <PageShell width="reading">
      <MarkVisited version={APP_VERSION} />
      <header className="mb-8">
        {/* text-foreground token added per #1733 acceptance criteria */}
        <h1 className={pageTitle}>{t("heading")}</h1>
        {/*
          subtitle text ends with "You're on version" (or locale equivalent);
          the <code> element is rendered inline at the call site, not via t.rich,
          per the brief (#1733 / #1729).
        */}
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {t("subtitle")}{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
            {APP_VERSION}
          </code>
          .
        </p>
      </header>

      {releases.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {t("empty")}
        </p>
      ) : (
        <ol className="space-y-8">
          {releases.map((release) => (
            <li key={release.version}>
              <div className="mb-3 flex items-baseline justify-between gap-4 border-b border-zinc-200 pb-2 dark:border-zinc-800">
                {/*
                  Version h2 uses sectionHeading (text-lg) rather than
                  sectionHeadingLg (text-xl): text-xl looks oversized alongside
                  the small inline date. Documented exception to the text-xl h2
                  convention (AGENTS.md / SectionHeading.tsx / #1733).
                */}
                <h2 className={sectionHeading}>v{release.version}</h2>
                <time
                  dateTime={release.date}
                  className={mutedTextXs}
                >
                  {format.dateTime(new Date(release.date), { dateStyle: "medium" })}
                </time>
              </div>
              <div className="space-y-4">
                {release.sections.map((section) => (
                  <section key={section.kind}>
                    <h3 className={`mb-1 ${sectionLabelSm}`}>
                      {t(`sectionKind.${section.kind.toLowerCase() as "added" | "changed" | "removed" | "deprecated" | "fixed" | "security"}`)}
                    </h3>
                    <ul
                      className="list-disc space-y-1 pl-5 text-sm text-zinc-800 dark:text-zinc-200"
                      role="list"
                    >
                      {section.bullets.map((bullet, idx) => (
                        <li key={idx}>
                          <BulletText text={bullet} />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}
    </PageShell>
  );
}
