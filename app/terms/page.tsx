import type { Metadata } from "next";
import { resolveLocale } from "@/i18n/request";
import { inlineLink } from "@/lib/utils/class-names";

export const metadata: Metadata = {
  title: "Terms of Use - Poké Memory",
  description:
    "The terms under which Poké Memory is provided at pokememory.com.",
};

export default async function TermsPage() {
  const locale = await resolveLocale();
  const showEnglishOnlyNotice = locale !== "en";

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      {showEnglishOnlyNotice && (
        <p
          lang="en"
          className="mb-6 rounded border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-relaxed text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100"
        >
          These Terms are written in English only. They are the authoritative
          version. If you need help understanding them, please contact{" "}
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
        <h1 className="text-2xl font-bold tracking-tight">Terms of Use</h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Last updated: 16 May 2026
        </p>
      </header>

      <div className="space-y-10 text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">

        {/* 1. About this document */}
        <section aria-labelledby="section-about">
          <h2
            id="section-about"
            className="mb-3 text-base font-semibold"
          >
            1. About this document
          </h2>
          <p>
            These Terms of Use (&ldquo;Terms&rdquo;) govern your use of the
            Poké Memory web application hosted at{" "}
            <a
              href="https://pokememory.com"
              className={inlineLink}
            >
              pokememory.com
            </a>{" "}
            (&ldquo;the Service&rdquo;). The Service is operated by Frazzled
            Productions Ltd (company no. 17258540), registered in England and
            Wales. By using the Service you agree to these Terms. If you
            do not agree, please do not use the Service.
          </p>
          <p className="mt-3">
            These Terms govern use of the hosted service only. The underlying
            source code is separately licensed under the MIT Licence; see the{" "}
            <a
              href="https://github.com/frasercl/poke-memory/blob/main/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
              className={inlineLink}
            >
              LICENSE
            </a>{" "}
            file in the repository for those rights and obligations.
          </p>
        </section>

        {/* 2. Service provided as is */}
        <section aria-labelledby="section-asis">
          <h2
            id="section-asis"
            className="mb-3 text-base font-semibold"
          >
            2. Service provided &ldquo;as is&rdquo;
          </h2>
          <p className="mb-3">
            The Service is a free, hobby project. It is provided{" "}
            <strong>&ldquo;as is&rdquo;</strong> and{" "}
            <strong>&ldquo;as available&rdquo;</strong>, without warranty of
            any kind, express or implied, including but not limited to
            warranties of merchantability, fitness for a particular purpose,
            or non-infringement.
          </p>
          <p>
            We do not warrant that the Service will be uninterrupted,
            error-free, or free from harmful components. We make no guarantee
            that any particular feature will remain available. You use the
            Service entirely at your own risk.
          </p>
        </section>

        {/* 3. Data and backups */}
        <section aria-labelledby="section-data">
          <h2
            id="section-data"
            className="mb-3 text-base font-semibold"
          >
            3. Data availability and the risk of data loss
          </h2>
          <p className="mb-3">
            Review progress stored in your browser&rsquo;s local storage (guest
            mode) is your responsibility to back up. We provide an export
            function on the Settings page, but we do not guarantee that local
            storage will persist across browser updates, device changes, or
            storage-quota evictions.
          </p>
          <p className="mb-3">
            For signed-in users, your review history is stored in Supabase
            Postgres. We make reasonable efforts to maintain that data, but we
            do not provide any guarantee of availability or durability. In
            particular, <strong>there is currently no point-in-time backup
            (PITR) in place for this project</strong>: a destructive operation
            or database failure could result in permanent data loss. We will not
            be liable for any such loss.
          </p>
          <p>
            The Service may be suspended, terminated, or have features removed
            at any time without notice.
          </p>
        </section>

        {/* 4. Limitation of liability */}
        <section aria-labelledby="section-liability">
          <h2
            id="section-liability"
            className="mb-3 text-base font-semibold"
          >
            4. Limitation of liability
          </h2>
          <p>
            To the fullest extent permitted by law, Frazzled Productions Ltd shall
            not be liable for any indirect, incidental, special, consequential,
            or punitive damages arising from your use of, or inability to use,
            the Service, including but not limited to loss of data, loss of
            progress, or loss of access. Our total aggregate liability to you
            for any claim arising out of these Terms or your use of the Service
            shall not exceed the maximum extent permitted by applicable law.
          </p>
        </section>

        {/* 5. Acceptable use */}
        <section aria-labelledby="section-acceptable">
          <h2
            id="section-acceptable"
            className="mb-3 text-base font-semibold"
          >
            5. Acceptable use
          </h2>
          <p className="mb-3">You agree not to:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Use the Service for any unlawful purpose or in violation of any
              applicable laws or regulations.
            </li>
            <li>
              Attempt to gain unauthorised access to any part of the Service,
              its infrastructure, or any other user&rsquo;s data.
            </li>
            <li>
              Conduct automated scraping, crawling, or bulk-downloading of
              Pokémon sprite or species data from the Service. The data is
              already publicly available via{" "}
              <a
                href="https://pokeapi.co"
                target="_blank"
                rel="noopener noreferrer"
                className={inlineLink}
              >
                PokéAPI
              </a>
              {" "}- please use that source directly.
            </li>
            <li>
              Deliberately overload, disrupt, or degrade the performance of the
              Service or its underlying infrastructure.
            </li>
            <li>
              Intentionally corrupt, falsify, or tamper with your synced review
              history, or attempt to interfere with the service for other users.
            </li>
          </ul>
        </section>

        {/* 6. Intellectual property */}
        <section aria-labelledby="section-ip">
          <h2
            id="section-ip"
            className="mb-3 text-base font-semibold"
          >
            6. Intellectual property and third-party content
          </h2>
          <p className="mb-3">
            Poké Memory is an unofficial fan project. It is not affiliated
            with, endorsed by, or in any way connected to Nintendo, Game
            Freak, or The Pokémon Company.
          </p>
          <p className="mb-3">
            Pokémon and all related names, characters, sprites, cries, and
            other creative assets are trademarks and/or copyrights of
            Nintendo / Creatures Inc. / GAME FREAK inc. All rights remain
            with their respective owners. These assets are reproduced here
            for fan and educational purposes only.
          </p>
          <p>
            The source code for this project is available on GitHub under the
            MIT Licence. The MIT Licence grants you rights over the code, not
            over the Pokémon intellectual property reproduced through it.
          </p>
        </section>

        {/* 7. Changes to the Service */}
        <section aria-labelledby="section-changes-service">
          <h2
            id="section-changes-service"
            className="mb-3 text-base font-semibold"
          >
            7. Changes to the Service
          </h2>
          <p>
            We may modify, suspend, or discontinue the Service (or any part
            of it) at any time without notice or liability. We may also update
            these Terms at any time. The &ldquo;last updated&rdquo; date at the
            top of this page will reflect the most recent revision. Continued
            use of the Service after any update constitutes acceptance of the
            revised Terms.
          </p>
        </section>

        {/* 8. Governing law */}
        <section aria-labelledby="section-law">
          <h2
            id="section-law"
            className="mb-3 text-base font-semibold"
          >
            8. Governing law and jurisdiction
          </h2>
          <p>
            These Terms are governed by the laws of England and Wales. Any
            dispute arising out of or in connection with these Terms or your
            use of the Service shall be subject to the exclusive jurisdiction
            of the courts of England and Wales, unless applicable consumer
            protection laws in your country of residence provide otherwise.
          </p>
        </section>

        {/* 9. Contact */}
        <section aria-labelledby="section-contact">
          <h2
            id="section-contact"
            className="mb-3 text-base font-semibold"
          >
            9. Contact
          </h2>
          <p>
            For questions about these Terms, contact{" "}
            <a
              href="mailto:privacy@pokememory.com"
              className={inlineLink}
            >
              privacy@pokememory.com
            </a>
            . For questions about how we handle your personal data, see our{" "}
            <a
              href="/privacy"
              className={inlineLink}
            >
              Privacy Notice
            </a>
            .
          </p>
        </section>

      </div>
    </main>
  );
}
