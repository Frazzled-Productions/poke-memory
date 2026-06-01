# Security Policy

poke-memory is a personal hobby project, but it does accept authenticated user data via Supabase sync. If you've found a security issue, please report it privately rather than opening a public issue.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting:

**[Report a vulnerability](https://github.com/Frazzled-Productions/poke-memory/security/advisories/new)**

Please include:

- A description of the issue and its impact.
- Steps to reproduce, or a proof-of-concept.
- Any affected versions or commits you can identify.

I'll acknowledge reports as time allows — this is a personal project, so there's no formal SLA, but credible reports against the authenticated sync surface (Supabase auth, RLS, `app/api/sync/**`, `app/api/srs/**`, `app/api/auth/**`, `lib/sync/**`, `lib/auth/**`) get priority.

## Scope

In scope:

- Vulnerabilities in code in this repository.
- Configuration issues in workflows, Vercel deployment, or Supabase integration that materially weaken security for authenticated users.

Out of scope:

- Issues in third-party services (Vercel, Supabase, GitHub) — report those to the relevant vendor.
- Bugs that only affect the guest path (no auth, all data in localStorage on the reporter's own machine).
- Best-practice findings without a demonstrable impact.
