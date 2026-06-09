"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";

// global-error.tsx replaces the root layout entirely when the root layout
// itself throws, so it MUST render its own <html> and <body> tags.
// next-intl's provider lives inside the root layout, so it is unavailable
// here. We use plain English strings and add them to the i18n-leak
// allowlist so the English-leak gate stays green (#1405).

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Report the root-layout error to Sentry. app/error.tsx does NOT catch
  // errors thrown in the root layout or template; this boundary does.
  // When the DSN is not configured, captureException is a no-op.
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100svh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#fafafa",
          color: "#171717",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "28rem",
            margin: "0 1rem",
            border: "1px solid #fecaca",
            borderRadius: "0.5rem",
            background: "#fef2f2",
            padding: "2rem 1.5rem",
            textAlign: "center",
          }}
        >
          <h2
            style={{
              margin: "0 0 0.5rem",
              fontSize: "1.125rem",
              fontWeight: 600,
              color: "#991b1b",
            }}
          >
            Something went wrong
          </h2>
          <p
            style={{
              margin: "0 0 1.5rem",
              fontSize: "0.875rem",
              color: "#dc2626",
            }}
          >
            An unexpected error occurred. Please reload the page, or return to
            the home screen.
          </p>
          {process.env.NODE_ENV === "development" && (
            <pre
              style={{
                margin: "0 0 1.5rem",
                padding: "0.75rem",
                borderRadius: "0.25rem",
                background: "#fee2e2",
                color: "#b91c1c",
                fontSize: "0.75rem",
                textAlign: "left",
                overflowX: "auto",
              }}
            >
              {error.message}
              {error.digest ? `\ndigest: ${error.digest}` : ""}
            </pre>
          )}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "0.75rem",
            }}
          >
            <button
              onClick={reset}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "0.5rem",
                border: "none",
                background: "#dc2626",
                color: "#fff",
                fontSize: "0.875rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <Link
              href="/"
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "0.5rem",
                border: "1px solid #dc2626",
                color: "#b91c1c",
                fontSize: "0.875rem",
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              Go to home
            </Link>
          </div>
        </div>
      </body>
    </html>
  );
}
