import type { Metadata } from "next";
import { getChangelog } from "@/lib/changelog/parse";
import { BulletText } from "@/components/whats-new/BulletText";
import { MarkVisited } from "@/components/whats-new/MarkVisited";

export const metadata: Metadata = {
  title: "What's New — Poké Memory",
  description:
    "Recent updates to Poké Memory: new features, improvements, and bug fixes.",
};

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
const RELEASES_TO_SHOW = 20;

export default function WhatsNewPage() {
  const releases = getChangelog().slice(0, RELEASES_TO_SHOW);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <MarkVisited version={APP_VERSION} />
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">What&apos;s new</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Recent changes to poke-memory. You&apos;re on version{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
            {APP_VERSION}
          </code>
          .
        </p>
      </header>

      {releases.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No release notes available.
        </p>
      ) : (
        <ol className="space-y-8">
          {releases.map((release) => (
            <li key={release.version}>
              <div className="mb-3 flex items-baseline justify-between gap-4 border-b border-zinc-200 pb-2 dark:border-zinc-800">
                <h2 className="text-lg font-semibold">v{release.version}</h2>
                <time
                  dateTime={release.date}
                  className="text-xs text-zinc-500 dark:text-zinc-400"
                >
                  {release.date}
                </time>
              </div>
              <div className="space-y-4">
                {release.sections.map((section) => (
                  <section key={section.kind}>
                    <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      {section.kind}
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
    </main>
  );
}
