import type { Metadata } from "next";
import ChildFriendlySummary from "@/components/privacy/ChildFriendlySummary";
import { resolveLocale } from "@/i18n/request";
import { inlineLink, mutedText } from "@/lib/utils/class-names";
import { CompanyDisclosure, COMPANY_NUMBER } from "@/components/CompanyDisclosure";

export const metadata: Metadata = {
  title: "Privacy Notice - Poké Memory",
  description:
    "How Poké Memory collects, uses, and protects your data under UK GDPR / GDPR.",
};

export default async function PrivacyPage() {
  const locale = await resolveLocale();
  const showEnglishOnlyNotice = locale !== "en";

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      {showEnglishOnlyNotice && (
        <p
          lang="en"
          className="mb-6 rounded border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-relaxed text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100"
        >
          This privacy notice is written in English only. It is the authoritative
          version. If you need help understanding it, please contact{" "}
          <a
            href="mailto:privacy@pokememory.com"
            className="underline underline-offset-2 hover:text-blue-700 dark:hover:text-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded"
          >
            privacy@pokememory.com
          </a>
          .
        </p>
      )}
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Privacy Notice</h1>
        <p className={`mt-2 ${mutedText}`}>
          Last updated: 4 June 2026
        </p>
      </header>

      <div className="space-y-10 text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">

        <ChildFriendlySummary />

        {/* 1. Controller */}
        <section aria-labelledby="section-controller">
          <h2
            id="section-controller"
            className="mb-3 text-base font-semibold"
          >
            1. Who is the data controller?
          </h2>
          <p>
            Poké Memory is operated by Frazzled Productions Ltd (company number{" "}
            {COMPANY_NUMBER}), registered in England and Wales. For questions
            about this notice or your personal data, contact{" "}
            <a
              href="mailto:privacy@pokememory.com"
              className={inlineLink}
            >
              privacy@pokememory.com
            </a>
            .
          </p>
          <CompanyDisclosure className="mt-2" />
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
            infrastructure that hosts the app; no third-party image CDN is
            involved.
          </p>

          <h3 className="mb-1 mt-4 font-semibold text-zinc-700 dark:text-zinc-300">
            Signed-in mode (GitHub or Google OAuth)
          </h3>
          <p>
            When you sign in with GitHub or Google, your per-card review
            history is synchronised to a Supabase Postgres database so you can
            continue across devices. This is where personal data processing
            begins and this notice applies in full.
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
            Our review-history, settings, streak, and grade-log tables are
            keyed by your account&rsquo;s opaque user identifier (a UUID issued
            by Supabase Auth). They do not contain your username, email
            address, or any profile information beyond that identifier.
          </p>
          <p className="mt-2">
            Separately, Supabase Auth maintains your account record. When you
            sign in via GitHub or Google, the OAuth provider returns a profile
            to Supabase Auth that typically includes the email address and
            display name associated with the account you signed in with;
            Supabase Auth stores this on the account record so it can identify
            you on your next sign-in. We use it only for authentication; it is
            never written into our review-history tables and is never used for
            marketing or tracking.
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
            calculate your review streak. It is an append-only log: dates are
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
            is append-only: individual entries are never mutated or deleted
            except by a full progress reset.
          </p>

          <h3 className="mb-1 mt-4 font-semibold text-zinc-700 dark:text-zinc-300">
            Web Push subscriptions (opt-in, signed-in PWA users only)
          </h3>
          <p>
            If you install the app to your Home Screen and opt in to daily
            review reminders, we store the Web Push subscription details your
            browser issues for that device: the push service endpoint URL,
            and the two cryptographic keys (<code>p256dh</code> and{" "}
            <code>auth</code>) the standard requires to deliver an encrypted
            notification. These are kept in a <code>push_subscriptions</code>
            {" "}
            table, scoped to your account.
          </p>
          <p className="mt-2">
            We use these values for one purpose only: to send a single daily
            notification when you have Pokémon cards due for review. The
            subscription is deleted as soon as you turn the toggle off, when
            you delete your account, or when your browser or operating system
            invalidates the endpoint. No notification content includes
            personal data beyond the count of cards waiting for review.
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
            function; it is not used for tracking or advertising, and it is not
            set in guest mode. See §4 below for our PECR position on this cookie.
          </p>

          <h3 className="mb-1 mt-4 font-semibold text-zinc-700 dark:text-zinc-300">
            Feedback submissions (all users)
          </h3>
          <p className="mb-2">
            If you use the in-app feedback form, we collect:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Feedback category (e.g. bug report, suggestion)</li>
            <li>
              Free-text message (up to 2,000 characters). This message may
              contain personal data you choose to include; please do not include
              your name, email address, or other personal information in your
              message.
            </li>
            <li>The page pathname from which the feedback was submitted</li>
            <li>App version at the time of submission</li>
            <li>
              If you are signed in: an opaque user identifier (UUID) so we can
              follow up if needed. If you are a guest, no user identifier is
              included and your feedback is not linked to any identifiable account.
            </li>
          </ul>
          <p className="mt-2">
            Feedback is used only to improve the service and to investigate
            reported issues. It is not shared with third parties, and it is not
            used for profiling or marketing.
          </p>
        </section>

        {/* 4. Cookies and similar technologies (PECR) */}
        <section aria-labelledby="section-cookies">
          <h2
            id="section-cookies"
            className="mb-3 text-base font-semibold"
          >
            4. Cookies and similar technologies
          </h2>
          <p className="mb-3">
            This section sets out our position under the UK Privacy and
            Electronic Communications Regulations 2003 (PECR), which governs
            the use of cookies and similar client-side storage.
          </p>

          <h3 className="mb-1 mt-4 font-semibold text-zinc-700 dark:text-zinc-300">
            What we use
          </h3>
          <ul className="list-disc space-y-2 pl-5 mb-3">
            <li>
              <strong>Browser local storage (guest path).</strong> We store
              your card review state, application settings, and temporary
              superuser QA flags in <code>localStorage</code>. This storage
              never leaves your device; nothing is transmitted to any server
              we operate. It is strictly necessary for the app to function
              in guest mode.
            </li>
            <li>
              <strong>Supabase Auth session cookie (signed-in path only).</strong>{" "}
              When you sign in with GitHub or Google, Supabase Auth sets an
              HTTP-only session cookie containing a signed JWT. This cookie is strictly
              necessary to keep you authenticated across requests. It is not
              set in guest mode and is not used for advertising or tracking.
            </li>
          </ul>

          <h3 className="mb-1 mt-4 font-semibold text-zinc-700 dark:text-zinc-300">
            What we do not use
          </h3>
          <p className="mb-3">
            We do not use tracking cookies, advertising cookies, or
            third-party profiling cookies of any kind. Vercel Analytics and
            Speed Insights are client-side scripts that collect aggregate,
            anonymous metrics (page path, referrer, country, device type, Core
            Web Vitals). They set no cookie and write nothing to{" "}
            <code>localStorage</code> or any other terminal-equipment storage,
            so PECR Regulation 6 is not engaged, and they do not identify
            individual users.
          </p>

          <h3 className="mb-1 mt-4 font-semibold text-zinc-700 dark:text-zinc-300">
            PECR position: no consent banner required
          </h3>
          <p>
            Under PECR, consent is only required for cookies and similar
            storage that are not strictly necessary. Every item of client-side
            storage used by this app is strictly necessary for the service to
            function (the auth cookie and SRS state in local storage). Vercel
            Analytics and Speed Insights are client-side scripts that set no
            cookie and write nothing to terminal-equipment storage, so PECR
            Regulation 6 is not engaged by them at all. No consent banner is
            required. We disclose this position here for transparency.
          </p>
        </section>

        {/* 5. Purposes and lawful basis */}
        <section aria-labelledby="section-basis">
          <h2
            id="section-basis"
            className="mb-3 text-base font-semibold"
          >
            5. Why do we process your data and on what lawful basis?
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
                    Contract performance: this is the core service you signed
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
                <tr>
                  <td className="py-2 pr-4">
                    Receive and act on feedback you submit voluntarily
                  </td>
                  <td className="py-2">
                    Legitimate interest in improving the service and resolving
                    reported issues
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* 6. Sub-processors and third-party sign-in services */}
        <section aria-labelledby="section-subprocessors">
          <h2
            id="section-subprocessors"
            className="mb-3 text-base font-semibold"
          >
            6. Sub-processors and third-party sign-in services
          </h2>

          <h3 className="mb-1 mt-4 font-semibold text-zinc-700 dark:text-zinc-300">
            Sub-processors (DPA in place)
          </h3>
          <p className="mb-3">
            The following companies process personal data on our behalf as data
            processors. We have a data processing agreement in place with each.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-700">
                  <th className="pb-2 pr-4 font-semibold text-zinc-600 dark:text-zinc-400">
                    Processor
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
                    Aggregate, anonymous analytics only; no card data
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
              </tbody>
            </table>
          </div>
          <p className="mt-3">
            Row-Level Security in Supabase ensures each user can only read and
            write their own rows.
          </p>

          <h3 className="mb-1 mt-6 font-semibold text-zinc-700 dark:text-zinc-300">
            Third-party sign-in services
          </h3>
          <p className="mb-3">
            When you sign in via GitHub or Google, that provider processes the
            authentication interaction as an <strong>independent controller</strong> under its own terms of service and privacy
            policy, not as our processor. We do not have a
            controller-to-processor DPA with these providers, and we do not
            instruct or control how they handle their side of the
            authentication flow.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-700">
                  <th className="pb-2 pr-4 font-semibold text-zinc-600 dark:text-zinc-400">
                    Provider
                  </th>
                  <th className="pb-2 pr-4 font-semibold text-zinc-600 dark:text-zinc-400">
                    Role
                  </th>
                  <th className="pb-2 font-semibold text-zinc-600 dark:text-zinc-400">
                    Data shared at sign-in
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                <tr>
                  <td className="py-2 pr-4 font-medium">GitHub (OAuth)</td>
                  <td className="py-2 pr-4">
                    Optional sign-in provider, used only if you choose
                    &ldquo;Continue with GitHub&rdquo;
                  </td>
                  <td className="py-2">
                    The OAuth token exchange is handled server-side by Supabase
                    Auth; the app itself never sees the OAuth token. The
                    provider returns a profile (typically email and display
                    name) to Supabase Auth, which holds it on your account
                    record for authentication. Our own review-history tables
                    store only the opaque user identifier.
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-medium">Google (OAuth)</td>
                  <td className="py-2 pr-4">
                    Optional sign-in provider, used only if you choose
                    &ldquo;Continue with Google&rdquo;
                  </td>
                  <td className="py-2">
                    The OAuth token exchange is handled server-side by Supabase
                    Auth; the app itself never sees the OAuth token. The
                    provider returns a profile (typically email and display
                    name) to Supabase Auth, which holds it on your account
                    record for authentication. Our own review-history tables
                    store only the opaque user identifier.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3">
            For details on how each provider handles the authentication
            interaction, see the{" "}
            <a
              href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement"
              target="_blank"
              rel="noopener noreferrer"
              className={inlineLink}
            >
              GitHub Privacy Statement
            </a>
            {" "}and the{" "}
            <a
              href="https://policies.google.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className={inlineLink}
            >
              Google Privacy Policy
            </a>
            .
          </p>
        </section>

        {/* 7. Cross-border transfers */}
        <section aria-labelledby="section-transfers">
          <h2
            id="section-transfers"
            className="mb-3 text-base font-semibold"
          >
            7. International transfers
          </h2>
          <p>
            The third-party services listed in §6 (Vercel, Supabase, and, if
            you choose to sign in, GitHub or Google) may process data outside
            the UK / EEA. Vercel and Supabase (our sub-processors) operate
            under the EU Standard Contractual Clauses (SCCs), providing
            equivalent safeguards via the UK International Data Transfer
            Agreement (IDTA) addendum. GitHub and Google act as independent
            controllers under their own applicable transfer mechanisms,
            including their own published SCCs with end-users.
          </p>
        </section>

        {/* 8. Retention */}
        <section aria-labelledby="section-retention">
          <h2
            id="section-retention"
            className="mb-3 text-base font-semibold"
          >
            8. How long do we keep your data?
          </h2>
          <p>
            Your review history, daily activity log, grade event log, and
            settings are retained for as long as your account is active. If you
            delete your account or request erasure (see{" "}
            <a
              href="#section-rights"
              className={inlineLink}
            >
              Your rights
            </a>
            ), all rows associated with your user identifier are permanently
            deleted from Supabase via a cascading delete. There is currently no
            separate point-in-time backup retained for this project, so deletion
            is effectively immediate and permanent.
          </p>
          <p className="mt-3">
            Feedback submissions are retained for 12 months from the date of
            submission and then automatically deleted, regardless of account
            status.
          </p>
        </section>

        {/* 9. Data-subject rights */}
        <section aria-labelledby="section-rights">
          <h2
            id="section-rights"
            className="mb-3 text-base font-semibold"
          >
            9. Your rights
          </h2>
          <p className="mb-3">
            Under UK GDPR and GDPR, you have the following rights where they
            apply:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Access</strong>: request a copy of the personal data we
              hold about you.
            </li>
            <li>
              <strong>Rectification</strong>: ask us to correct inaccurate
              data.
            </li>
            <li>
              <strong>Erasure</strong>: ask us to delete your data (&ldquo;right to
              be forgotten&rdquo;). You can also do this yourself from the
              Settings page: <em>Reset all progress</em> deletes your review
              history immediately, and <em>Delete account</em> permanently
              erases your account, all cloud data, and your sign-in identity,
              with no email request needed. Deleting your account also
              permanently deletes any feedback submissions linked to it.
            </li>
            <li>
              <strong>Data portability</strong>: receive your data in a
              structured, machine-readable format. The{" "}
              <em>Export progress</em> option on the Settings page downloads
              your locally-cached review history as JSON. Note that this export
              reflects the data held in your browser&rsquo;s local storage, not
              necessarily the full authoritative copy in the cloud. If you are
              signed in and require a complete copy of the data we hold for you
              in Supabase, please contact us at{" "}
              <a
                href="mailto:privacy@pokememory.com"
                className={inlineLink}
              >
                privacy@pokememory.com
              </a>{" "}
              and we will provide a full export.
            </li>
            <li>
              <strong>Objection</strong>: object to processing carried out
              under legitimate interest.
            </li>
            <li>
              <strong>Restriction</strong>: ask us to restrict processing
              while a dispute is resolved.
            </li>
          </ul>
          <p className="mt-3">
            To exercise any of these rights, email{" "}
            <a
              href="mailto:privacy@pokememory.com"
              className={inlineLink}
            >
              privacy@pokememory.com
            </a>{" "}
            from the email address associated with the GitHub or Google
            account you signed in with, so we can verify the request. We will
            respond within one month.
          </p>
        </section>

        {/* 10. ICO complaint route */}
        <section aria-labelledby="section-ico">
          <h2
            id="section-ico"
            className="mb-3 text-base font-semibold"
          >
            10. Right to complain to the ICO
          </h2>
          <p>
            If you are in the UK and are unhappy with how we handle your
            personal data, you have the right to lodge a complaint with the
            Information Commissioner&rsquo;s Office (ICO):{" "}
            <a
              href="https://ico.org.uk/make-a-complaint"
              target="_blank"
              rel="noopener noreferrer"
              className={inlineLink}
            >
              ico.org.uk/make-a-complaint
            </a>
            . If you are in the EU, contact your national data protection
            authority.
          </p>
        </section>

        {/* 11. Children */}
        <section aria-labelledby="section-children">
          <h2
            id="section-children"
            className="mb-3 text-base font-semibold"
          >
            11. Children&rsquo;s data
          </h2>
          <p>
            Poké Memory is not directed at children under the age of 13. We do
            not knowingly collect personal data from under-13s. If you are
            under 13, please do not sign in; use guest mode instead, which
            stores nothing outside your own device. For a plain-language
            version of this notice suited to younger readers, see the summary
            above. If you believe a child under 13 has signed in, please
            contact us at{" "}
            <a
              href="mailto:privacy@pokememory.com"
              className={inlineLink}
            >
              privacy@pokememory.com
            </a>{" "}
            and we will delete the data promptly.
          </p>
        </section>

        {/* 12. Changes */}
        <section aria-labelledby="section-changes">
          <h2
            id="section-changes"
            className="mb-3 text-base font-semibold"
          >
            12. Changes to this notice
          </h2>
          <p>
            We may update this notice when the data flows change (for example,
            if we add a new sub-processor or card type). Material changes will
            be announced via the{" "}
            <a
              href="/whats-new"
              className={inlineLink}
            >
              What&rsquo;s new
            </a>{" "}
            page. The &ldquo;last updated&rdquo; date at the top of this page will always
            reflect the most recent revision.
          </p>
        </section>

        {/* 13. Third-party content */}
        <section aria-labelledby="section-ip">
          <h2
            id="section-ip"
            className="mb-3 text-base font-semibold"
          >
            13. Third-party content and intellectual property
          </h2>
          <p className="mb-3">
            Poké Memory is an unofficial fan project. It is not
            affiliated with, endorsed by, or in any way connected to Nintendo,
            Game Freak, or The Pokémon Company.
          </p>
          <p className="mb-3">
            Pokémon and all related names, characters, sprites, cries, and
            other creative assets are trademarks and/or copyrights of Nintendo
            / Creatures Inc. / GAME FREAK inc. All rights remain with their
            respective owners. These assets are reproduced here for fan and
            educational purposes.
          </p>
          <p>
            Pokémon species data and sprites are sourced from{" "}
            <a
              href="https://pokeapi.co"
              target="_blank"
              rel="noopener noreferrer"
              className={inlineLink}
            >
              PokéAPI
            </a>
            {" "}(an open Pokémon data API). Sprites are self-hosted and served as
            static files from the same infrastructure as the app; no runtime
            requests are made to PokéAPI or any Nintendo-affiliated server.
          </p>
        </section>

        {/* Cross-link to Terms of Use */}
        <section aria-labelledby="section-terms-link">
          <h2
            id="section-terms-link"
            className="mb-3 text-base font-semibold"
          >
            14. Terms of Use
          </h2>
          <p>
            For the terms that govern use of the hosted service (including
            disclaimers, liability limitations, acceptable use, and governing
            law), see the{" "}
            <a
              href="/terms"
              className={inlineLink}
            >
              Terms of Use
            </a>
            .
          </p>
        </section>

      </div>
    </main>
  );
}
