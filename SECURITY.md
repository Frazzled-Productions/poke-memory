# Security Policy

poke-memory is a personal hobby project, but it does accept authenticated user data via cloud sync (Cloudflare Workers and D1). If you've found a security issue, please report it privately rather than opening a public issue.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting:

**[Report a vulnerability](https://github.com/Frazzled-Productions/poke-memory/security/advisories/new)**

Please include:

- A description of the issue and its impact.
- Steps to reproduce, or a proof-of-concept.
- Any affected versions or commits you can identify.

I'll acknowledge reports as time allows - this is a personal project, so there's no formal SLA, but credible reports against the authenticated sync surface (Better Auth sign-in, the per-user scope helper `lib/db/scope.ts`, the data gateway `app/api/db/**` and `lib/db/**`, `app/api/sync/**`, `app/api/auth/**`, `lib/sync/**`, `lib/auth/**`) get priority.

## Scope

In scope:

- Vulnerabilities in code in this repository.
- Configuration issues in workflows, the Cloudflare Worker and D1 deployment (`wrangler.jsonc`, `.github/workflows/deploy.yml`), or the Better Auth set-up that materially weaken security for authenticated users.

Out of scope:

- Issues in third-party services (Cloudflare, GitHub, Google) - report those to the relevant vendor.
- Bugs that only affect the guest path (no auth, all data in localStorage on the reporter's own machine).
- Best-practice findings without a demonstrable impact.
