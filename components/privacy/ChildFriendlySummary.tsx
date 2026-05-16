import Link from "next/link";

export default function ChildFriendlySummary() {
  return (
    <section
      aria-labelledby="plain-language-heading"
      className="rounded-xl border border-blue-200 bg-blue-50 px-6 py-5 dark:border-blue-900 dark:bg-blue-950/40"
    >
      <h2
        id="plain-language-heading"
        className="mb-4 text-lg font-semibold"
      >
        In plain language: what does Poké Memory do with your data?
      </h2>
      <ol className="list-decimal space-y-3 pl-5 leading-relaxed text-zinc-800 dark:text-zinc-200">
        <li>
          <strong>Just playing (no sign-in).</strong> When you play without
          signing in, the app saves your Pokémon progress only on your own
          device, and nothing is sent to us or stored anywhere on the internet.
        </li>
        <li>
          <strong>Signing in.</strong> If you sign in with a GitHub or Google
          account, we save your card progress to a secure database so you can
          keep it across different devices. You need to be 13 or older to have
          a GitHub or Google account.
        </li>
        <li>
          <strong>What we save.</strong> We only save which Pokémon cards
          you&rsquo;ve practised, how well you know them, and when you last
          practised, and nothing else. We don&rsquo;t know your name, your
          address, or anything about you as a person.
        </li>
        <li>
          <strong>Who else can see it.</strong> Nobody else can see your
          progress. Only you can see your own cards. We never share your
          progress with anyone else or use it to show you adverts.
        </li>
        <li>
          <strong>You&rsquo;re in control.</strong> You can{" "}
          <Link
            href="/settings#backup-heading"
            className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 rounded"
          >
            export your progress
          </Link>{" "}
          or{" "}
          <Link
            href="/settings#danger-zone-heading"
            className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 rounded"
          >
            reset all progress
          </Link>{" "}
          at any time from the Settings page. You don&rsquo;t need to ask us;
          you can do it yourself, right now.
        </li>
      </ol>
    </section>
  );
}
