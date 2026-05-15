import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Notice — Poké Memory",
  description:
    "How Poké Memory collects, uses, and protects your data under UK GDPR / GDPR.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Privacy Notice</h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Last updated: 15 May 2026
        </p>
      </header>

      <div className="space-y-10 text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">

        {/* 1. Controller */}
        <section aria-labelledby="section-controller">
          <h2
            id="section-controller"
            className="mb-3 text-base font-semibold"
          >
            1. Who is the data controller?
          </h2>
          <p>
            Poké Memory is operated by Frazzled Productions. For questions
            about this notice or your personal data, contact{" "}
            <a
              href="mailto:fbrookhouse@gmail.com"
              className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 rounded"
            >
              fbrookhouse@gmail.com
            </a>
            .
          </p>
        </section>

        {/* 2. Two paths */}
        <section aria-labelledby="section-paths">
          <h2
            id="section-paths"
            className="mb-3 text-base font-semibold"
          >
            2. Guest use vs. signed-in use
          </h2>
          <p className="mb-3">
            Poké Memory works in two modes and the data flows are very
            different.
          </p>

          <h3 className="mb-1 mt-4 font-semibold text-zinc-700 dark:text-zinc-300">
            Guest mode
          </h3>
          <p>
            All card progress and review history stays in your browser&rsquo;s
            local storage. Nothing is transmitted to any server we operate.
            Pokémon sprites are served as static files from the same Vercel
            infrastructure that hosts the app — no third-party image CDN is
            involved.
          </p>

          <h3 className="mb-1 mt-4 font-semibold text-zinc-700 dark:text-zinc-300">
            Signed-in mode (GitHub OAuth)
          </h3>
          <p>
            When you sign in with GitHub, your per-card review history is
            synchronised to a Supabase Postgres database so you can continue
            across devices. This is where personal data processing begins and
            this notice applies in full.
          </p>
        </section>

        {/* 3. Data categories */}
        <section aria-labelledby="section-data">
          <h2
            id="section-data"
            className="mb-3 text-base font-semibold"
          >
            3. What data do we collect?
          </h2>
          <p className="mb-3">
            We collect only what is necessary to provide the spaced-repetition
            service. No payment data, no advertising identifiers, no precise
            location.
          </p>

          <h3 className="mb-1 mt-4 font-semibold text-zinc-700 dark:text-zinc-300">
            Per-card review state (authenticated users)
          </h3>
          <p className="mb-2">
            For each Pokémon flashcard you review, we store the FSRS
            spaced-repetition parameters needed to schedule your next review:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Card type and subject identifier (e.g. which Pokémon)</li>
            <li>Stability and difficulty (FSRS algorithm parameters)</li>
            <li>Scheduled interval in days</li>
            <li>Repetition count and lapse count</li>
            <li>FSRS state (new / learning / review / relearning)</li>
            <li>Due date, date of last review, date first seen</li>
          </ul>
          <p className="mt-2">
            This data is keyed by your GitHub user identifier. It does not
            include your GitHub username, email address, or any profile
            information beyond the opaque identifier required to associate
            rows with your account.
          </p>

          <h3 className="mb-1 mt-4 font-semibold text-zinc-700 dark:text-zinc-300">
            Settings and preferences
          </h3>
          <p>
            If you sign in, your application preferences (daily review limits,
            practice scope, theme, timezone, etc.) are also synchronised so
            they persist across devices.
          </p>

          <h3 className="mb-1 mt-4 font-semibold text-zinc-700 dark:text-zinc-300">
            Daily review activity (authenticated users)
          </h3>
          <p>
            We record which calendar dates you completed at least one review.
            This is stored in a <code>streak_days</code> table and used to
            calculate your review streak. It is an append-only log — dates are
            never removed except by a full progress reset.
          </p>

          <h3 className="mb-1 mt-4 font-semibold text-zinc-700 dark:text-zinc-300">
            Grade event log (authenticated users)
          </h3>
          <p>
            Each time you grade a card we append a row to a{" "}
            <code>grade_log</code> table recording the card type, subject
            identifier, the grade you chose, the entry date, and the precise
            timestamp it occurred (<code>occurred_at</code>). This log is used
            to compute per-user FSRS optimiser weights and review statistics. It
            is append-only — individual entries are never mutated or deleted
            except by a full progress reset.
          </p>

          <h3 className="mb-1 mt-4 font-semibold text-zinc-700 dark:text-zinc-300">
            Aggregate analytics (all users)
          </h3>
          <p>
            Vercel Analytics and Speed Insights collect anonymous, aggregate
            metrics: page path, referrer, country, device type, and Core Web
            Vitals. This data does not include card progress, review history, or
            any personally identifying information. It goes to Vercel&rsquo;s
            infrastructure, not ours.
          </p>

          <h3 className="mb-1 mt-4 font-semibold text-zinc-700 dark:text-zinc-300">
            Authentication cookie (signed-in users only)
          </h3>
          <p>
            When you sign in, Supabase Auth sets an HTTP-only session cookie
            containing a signed JWT that keeps you authenticated across requests.
            This cookie is strictly necessary for the signed-in service to
            function — it is not used for tracking or advertising, and it is not
            set in guest mode. No consent banner is required for a
            strictly-necessary cookie, but we disclose it here for transparency.
          </p>
        </section>

        {/* 4. Purposes and lawful basis */}
        <section aria-labelledby="section-basis">
          <h2
            id="section-basis"
            className="mb-3 text-base font-semibold"
          >
            4. Why do we process your data and on what lawful basis?
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-700">
                  <th className="pb-2 pr-4 font-semibold text-zinc-600 dark:text-zinc-400">
                    Purpose
                  </th>
                  <th className="pb-2 pr-4 font-semibold text-zinc-600 dark:text-zinc-400">
                    Lawful basis
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                <tr>
                  <td className="py-2 pr-4">
                    Store and synchronise your review history across devices
                  </td>
                  <td className="py-2">
                    Contract performance — this is the core service you signed
                    up for
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">
                    Optimise the FSRS scheduler parameters for your retention
                    target
                  </td>
                  <td className="py-2">
                    Contract performance / legitimate interest in improving the
                    service
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">
                    Aggregate, anonymous page-view analytics
                  </td>
                  <td className="py-2">
                    Legitimate interest in understanding usage patterns (no
                    cookie, no individual tracking)
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* 5. Sub-processors */}
        <section aria-labelledby="section-subprocessors">
          <h2
            id="section-subprocessors"
            className="mb-3 text-base font-semibold"
          >
            5. Sub-processors
          </h2>
          <p className="mb-3">
            We use the following third-party sub-processors. We have a data
            processing agreement in place with each.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-700">
                  <th className="pb-2 pr-4 font-semibold text-zinc-600 dark:text-zinc-400">
                    Sub-processor
                  </th>
                  <th className="pb-2 pr-4 font-semibold text-zinc-600 dark:text-zinc-400">
                    Role
                  </th>
                  <th className="pb-2 font-semibold text-zinc-600 dark:text-zinc-400">
                    Data transferred
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                <tr>
                  <td className="py-2 pr-4 font-medium">Vercel</td>
                  <td className="py-2 pr-4">
                    Hosting and static asset delivery
                  </td>
                  <td className="py-2">
                    Aggregate, anonymous analytics only — no card data
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-medium">Supabase</td>
                  <td className="py-2 pr-4">
                    Postgres database for authenticated users
                  </td>
                  <td className="py-2">
                    Per-card review state, daily activity dates, grade event
                    log, settings, and auth session (authenticated users only)
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-medium">GitHub (OAuth)</td>
                  <td className="py-2 pr-4">Sign-in provider</td>
                  <td className="py-2">
                    The OAuth token exchange is handled server-side by Supabase
                    Auth — the app itself never sees the OAuth token. We receive
                    only the opaque user identifier; we do not store your GitHub
                    username or email
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3">
            Row-Level Security in Supabase ensures each user can only read and
            write their own rows.
          </p>
        </section>

        {/* 6. Cross-border transfers */}
        <section aria-labelledby="section-transfers">
          <h2
            id="section-transfers"
            className="mb-3 text-base font-semibold"
          >
            6. International transfers
          </h2>
          <p>
            Vercel and Supabase may process data outside the UK / EEA. Both
            operate under the EU Standard Contractual Clauses (SCCs) as the
            transfer mechanism, providing equivalent safeguards to those
            required under UK GDPR via the UK International Data Transfer
            Agreement (IDTA) addendum.
          </p>
        </section>

        {/* 7. Retention */}
        <section aria-labelledby="section-retention">
          <h2
            id="section-retention"
            className="mb-3 text-base font-semibold"
          >
            7. How long do we keep your data?
          </h2>
          <p>
            Your review history, daily activity log, grade event log, and
            settings are retained for as long as your account is active. If you
            delete your account or request erasure (see{" "}
            <a
              href="#section-rights"
              className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 rounded"
            >
              Your rights
            </a>
            ), all rows associated with your user identifier are permanently
            deleted from Supabase via a cascading delete. There is currently no
            separate point-in-time backup retained for this project, so deletion
            is effectively immediate and permanent.
          </p>
        </section>

        {/* 8. Data-subject rights */}
        <section aria-labelledby="section-rights">
          <h2
            id="section-rights"
            className="mb-3 text-base font-semibold"
          >
            8. Your rights
          </h2>
          <p className="mb-3">
            Under UK GDPR and GDPR, you have the following rights where they
            apply:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Access</strong> — request a copy of the personal data we
              hold about you.
            </li>
            <li>
              <strong>Rectification</strong> — ask us to correct inaccurate
              data.
            </li>
            <li>
              <strong>Erasure</strong> — ask us to delete your data (&ldquo;right to
              be forgotten&rdquo;). You can also use the <em>Reset all progress</em>{" "}
              option on the Settings page to delete your review history
              immediately.
            </li>
            <li>
              <strong>Data portability</strong> — receive your data in a
              structured, machine-readable format. The{" "}
              <em>Export progress</em> option on the Settings page downloads
              your locally-cached review history as JSON. Note that this export
              reflects the data held in your browser&rsquo;s local storage, not
              necessarily the full authoritative copy in the cloud. If you are
              signed in and require a complete copy of the data we hold for you
              in Supabase, please contact us at{" "}
              <a
                href="mailto:fbrookhouse@gmail.com"
                className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 rounded"
              >
                fbrookhouse@gmail.com
              </a>{" "}
              and we will provide a full export.
            </li>
            <li>
              <strong>Objection</strong> — object to processing carried out
              under legitimate interest.
            </li>
            <li>
              <strong>Restriction</strong> — ask us to restrict processing
              while a dispute is resolved.
            </li>
          </ul>
          <p className="mt-3">
            To exercise any of these rights, email{" "}
            <a
              href="mailto:fbrookhouse@gmail.com"
              className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 rounded"
            >
              fbrookhouse@gmail.com
            </a>{" "}
            from the email address associated with your GitHub account. We will
            respond within one month.
          </p>
        </section>

        {/* 9. ICO complaint route */}
        <section aria-labelledby="section-ico">
          <h2
            id="section-ico"
            className="mb-3 text-base font-semibold"
          >
            9. Right to complain to the ICO
          </h2>
          <p>
            If you are in the UK and are unhappy with how we handle your
            personal data, you have the right to lodge a complaint with the
            Information Commissioner&rsquo;s Office (ICO):{" "}
            <a
              href="https://ico.org.uk/make-a-complaint"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 rounded"
            >
              ico.org.uk/make-a-complaint
            </a>
            . If you are in the EU, contact your national data protection
            authority.
          </p>
        </section>

        {/* 10. Children */}
        <section aria-labelledby="section-children">
          <h2
            id="section-children"
            className="mb-3 text-base font-semibold"
          >
            10. Children&rsquo;s data
          </h2>
          <p>
            Poké Memory is not directed at children under the age of 13. We do
            not knowingly collect personal data from under-13s. If you are
            under 13, please do not sign in — use guest mode instead, which
            stores nothing outside your own device. If you believe a child
            under 13 has signed in, please contact us at{" "}
            <a
              href="mailto:fbrookhouse@gmail.com"
              className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 rounded"
            >
              fbrookhouse@gmail.com
            </a>{" "}
            and we will delete the data promptly.
          </p>
        </section>

        {/* 11. Changes */}
        <section aria-labelledby="section-changes">
          <h2
            id="section-changes"
            className="mb-3 text-base font-semibold"
          >
            11. Changes to this notice
          </h2>
          <p>
            We may update this notice when the data flows change (for example,
            if we add a new sub-processor or card type). Material changes will
            be announced via the{" "}
            <a
              href="/whats-new"
              className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 rounded"
            >
              What&rsquo;s new
            </a>{" "}
            page. The &ldquo;last updated&rdquo; date at the top of this page will always
            reflect the most recent revision.
          </p>
        </section>

      </div>
    </main>
  );
}
