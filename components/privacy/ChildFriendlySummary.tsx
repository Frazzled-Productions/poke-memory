import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { inlineLink } from "@/lib/utils/class-names";

export default async function ChildFriendlySummary() {
  const t = await getTranslations("privacy.childFriendlySummary");

  const strong = (chunks: React.ReactNode) => <strong>{chunks}</strong>;

  return (
    <section
      aria-labelledby="plain-language-heading"
      className="rounded-xl border border-blue-200 bg-blue-50 px-6 py-5 dark:border-blue-900 dark:bg-blue-950/40"
    >
      <h2
        id="plain-language-heading"
        className="mb-4 text-lg font-semibold"
      >
        {t("heading")}
      </h2>
      <ol className="list-decimal space-y-3 pl-5 leading-relaxed text-zinc-800 dark:text-zinc-200">
        <li>
          {t.rich("item1", { s: strong })}
        </li>
        <li>
          {t.rich("item2", { s: strong })}
        </li>
        <li>
          {t.rich("item3", { s: strong })}
        </li>
        <li>
          {t.rich("item4", { s: strong })}
        </li>
        <li>
          {t.rich("item5", {
            s: strong,
            export: (chunks) => (
              <Link href="/settings#backup-heading" className={inlineLink}>
                {chunks}
              </Link>
            ),
            reset: (chunks) => (
              <Link href="/settings#danger-zone-heading" className={inlineLink}>
                {chunks}
              </Link>
            ),
          })}
        </li>
        <li>
          {t.rich("item6", { s: strong })}
        </li>
      </ol>
    </section>
  );
}
