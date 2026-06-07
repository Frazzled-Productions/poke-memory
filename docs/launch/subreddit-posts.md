# Subreddit launch posts

> **Status: DRAFTS.** Do not publish yet. These go out once the v1.0 launch
> blockers close. Hold until then, then publish one community at a time (not all
> in one day) so each post can be tended and replied to properly.

These are tailored launch posts for the public push of [Poké Memory](https://pokememory.com).
One draft per target subreddit, written to that community's tone and rules. The
honest hook is the same everywhere: it is a free, no-sign-in spaced-repetition
app for learning Pokémon names and evolutions, and you can just open it and start.

## Ground truths (keep the copy accurate)

Everything below is verifiable against the live app and the README. Do not
embellish past these.

- **What it is**: an Anki-style spaced-repetition app for learning to recognise
  and name all 1025 Pokémon (gen 1 to gen 9) and their evolutions.
- **Guest mode is fully featured**: no sign-in, no account, no email. Open the
  site and start reviewing. All card and session data stays in your browser
  (localStorage); nothing about your progress is sent to a server.
- **Optional account**: sign in with GitHub or Google only if you want to sync
  progress across devices. Entirely optional. Signing out keeps your local data.
- **Scheduler**: FSRS (the same algorithm Anki has shipped by default since
  23.10), via the open-source [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs)
  library, with Anki-style learning steps wrapped around it.
- **Surfaces**: Practice (the review loop), a 1025-cell Pokédex browser, a Stats
  dashboard, a Journey/badges home, and a Pasture that unlocks on first mastery.
- **PWA**: installable to the home screen on iOS/Android, works offline.
- **Free**: no ads, no paywall, no upsell. It is a hobby project.
- **Unofficial fan project**: not affiliated with Nintendo, Game Freak, or The
  Pokémon Company. Worth a one-line disclaimer where a community expects it.

## Shared assets

- **Link**: https://pokememory.com
- **Social-preview image**: an OpenGraph image now unfurls automatically when the
  bare link is pasted (#672, shipped), so on most subreddits a plain link post
  will show the preview card without a manual upload. Where a subreddit prefers
  or requires an image post, use the same OpenGraph asset.
  - TODO before publishing: confirm the live unfurl renders correctly by pasting
    https://pokememory.com into a Reddit comment draft (or a link-preview tool),
    and grab the rendered image to attach manually if a given subreddit needs an
    image-type post. Do not hardcode an image URL in these drafts; pull the
    current one at posting time.

## Pre-publish checklist (every post)

- [ ] v1.0 launch blockers are closed.
- [ ] Re-read the target subreddit's rules and pinned/sidebar self-promotion
      policy on the day (rules change; the per-post notes below are a starting
      point, not a substitute).
- [ ] Confirm account age and karma meet the subreddit's minimums; some auto-remove
      new or low-karma accounts.
- [ ] Confirm the social-preview unfurl renders (see Shared assets TODO).
- [ ] Post during the community's active hours, then stay around for the first
      few hours to answer replies. Treat replies as the point, not the post.
- [ ] Lead with guest mode (no sign-in) every time; never lead with the account.
- [ ] No marketing-speak. State what it is plainly and let people try it.

---

## r/pokemon

**Rules caveat.** r/pokemon is large and strict on self-promotion. Self-promo /
"my project" posts are heavily restricted and often confined to a specific day,
flair, or a dedicated megathread, and low-effort promo is removed. Before
posting: read the current rules and sidebar, check whether a creations/fan-works
flair or a scheduled self-promotion thread applies, and be ready to post into
that thread instead of as a standalone submission. Engage as a fan first.

**Title**

> I built a free spaced-repetition trainer to actually learn all 1025 Pokémon by sight (no sign-in)

**Body**

> I could never reliably name Pokémon past the ones I grew up with, so I built a
> small web app to fix that for myself, and it ended up worth sharing.
>
> It is a flashcard trainer: you get a sprite, you say the name in your head, you
> flip the card, and you grade how you did. The ones you know drift out to weeks
> and months; the ones you fluff come back tomorrow. It covers all 1025 species,
> gen 1 to gen 9, plus their evolutions, and you can narrow a session to a
> generation, a type, or presets like Starters and Legendaries.
>
> No sign-in. Open it and start. Everything stays in your browser, so there is no
> account to make and nothing to lose by trying it. There is an optional GitHub or
> Google sign-in purely if you want to sync across your phone and laptop, but it
> is entirely optional.
>
> Other bits: a full 1025-cell Pokédex that fills in from silhouette to greyscale
> to full colour as you learn each one, a stats page, gym-badge-style progress,
> and a reverse mode (name shown, you recall the sprite) and a cry-to-name mode if
> you want a harder challenge. It installs to your phone home screen and works
> offline.
>
> It is free, no ads, and an unofficial fan project (not affiliated with Nintendo
> / Game Freak / TPC). Sprites and data come from PokéAPI.
>
> https://pokememory.com
>
> Happy to answer anything, and genuinely keen on feedback on the review feel and
> what is missing.

---

## r/Anki

**Rules caveat.** Technically literate, FSRS-savvy audience. They will ask exactly
how scheduling works and will spot hand-waving, so the explainer leans technical
and honest about what this is (a purpose-built app, not a shared deck). Check
r/Anki's self-promotion rules; tools/apps related to spaced repetition are
generally welcome when shared transparently, but read the current policy first.

**Title**

> Built a standalone FSRS-based trainer for learning all 1025 Pokémon by sight (web, no sign-in)

**Body**

> This community is the reason I trust spaced repetition, so I wanted to share a
> small app I built and be upfront about the scheduling internals.
>
> It is a purpose-built web app (not a shared deck) for recognising and naming all
> 1025 Pokémon and their evolutions. Sprite on the front, name on the back, grade
> Again / Hard / Good / Easy.
>
> Scheduling: it uses FSRS via [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs),
> so it is the same family of algorithm Anki has shipped by default since 23.10. I
> wrap Anki-style learning steps around new cards (a short 1m to 10m ladder, with
> the ladder adapting to FSRS difficulty) so brand-new cards behave familiarly
> before they graduate to the day-scale FSRS schedule. Lapses drop a card back into
> a short relearning step. There is a desired-retention slider (80% to 97%) wired
> straight into FSRS so you can trade review volume against retention, plus the
> usual daily new/review caps.
>
> Each species can generate up to three independently scheduled cards: forward
> (sprite to name), reverse (name to sprite), and cry to name. The stats page
> exposes the things this crowd actually cares about: a retention-vs-target
> indicator, accuracy over time, a due-forecast, a difficulty histogram, and a
> review heatmap.
>
> No sign-in to use it. Everything lives in your browser by default; an optional
> GitHub/Google account only exists if you want cross-device sync. Free, no ads,
> installable as a PWA, works offline.
>
> https://pokememory.com
>
> Keen on scrutiny of the scheduling choices specifically. If something looks off
> versus how you would expect FSRS to behave, I want to hear it.

---

## r/SideProject

**Rules caveat.** "Show what you built" is exactly the point here, so the tone is
the maker story: what it is, why I built it, the stack, what I learned. Self-promo
is welcome by design, but the community rewards substance and an honest "here is
the thing, here is how it works" over a sales pitch.

**Title**

> I built a free, no-sign-in spaced-repetition app to learn all 1025 Pokémon (Next.js + FSRS)

**Body**

> I kept failing to name Pokémon past the originals, so I built a spaced-repetition
> trainer to drill them, and then kept going until it was a proper little app.
>
> What it does: shows you a Pokémon sprite, you recall the name, flip, and grade
> yourself. A spaced-repetition scheduler (FSRS, the algorithm Anki uses) decides
> when each card comes back, so the ones you know stretch out to weeks and months
> and the ones you miss come back soon. All 1025 species, gen 1 to gen 9, plus
> evolutions, plus a full Pokédex browser, stats, and a badge/journey home.
>
> The bit I am most happy with as a product decision: no sign-in. You open the
> link and you are reviewing immediately, with all progress stored locally in your
> browser. An account (GitHub or Google) is optional and only buys you cross-device
> sync. Lowering the barrier to "just click and try" mattered more than capturing
> emails.
>
> Stack, since this sub likes it: Next.js 16 (App Router), React 19, Tailwind 4,
> TypeScript. Sync, when you opt in, is Supabase (Auth + Postgres with row-level
> security). Hosted on Vercel. It is a PWA, so it installs to the home screen and
> works offline. Pokémon data and sprites come from PokéAPI and are self-hosted as
> static files.
>
> It is free, no ads, an unofficial fan project. Built it solo as a hobby.
>
> https://pokememory.com
>
> Feedback welcome, especially on first-run experience: does it make sense within
> the first few cards without any explanation?

---

## r/spacedrepetition

**Rules caveat.** Small, on-topic, method-focused community. Apps and tools that
genuinely use spaced repetition are on-topic and welcome, but frame it around the
method, not the Pokémon novelty. Check the rules; keep it low-key and useful.

**Title**

> A concrete SRS use-case: learning all 1025 Pokémon by sight with FSRS (free, no sign-in)

**Body**

> Sharing this here as a worked example of applying spaced repetition to pure
> visual recognition rather than language or facts.
>
> The task is naming Pokémon from their sprites, which turns out to be a clean SRS
> problem: a large fixed set (1025 items), an unambiguous prompt and answer, and a
> recognition skill that decays without review. The app shows a sprite, you recall
> the name, flip, and grade Again / Hard / Good / Easy.
>
> It uses FSRS (via `ts-fsrs`) with Anki-style learning steps for new cards, a
> desired-retention slider so you can tune the retention/volume trade-off, and
> independent scheduling for forward (sprite to name) and reverse (name to sprite)
> directions. The stats view includes a retention-vs-target readout and a
> due-forecast, which are the metrics I find most useful for sanity-checking that
> the schedule is behaving.
>
> No sign-in and no account needed: progress is stored locally in your browser, so
> it is a zero-friction way to see FSRS in action on a non-language deck. Optional
> account just adds cross-device sync. Free, PWA, works offline.
>
> https://pokememory.com
>
> Interested in whether people here would model the three card directions
> differently, or treat recognition vs recall as separate skills.

---

## A note on r/PokemonGoFriends and similar

**Not a fit. Do not post.** r/PokemonGoFriends and the cluster of Pokémon GO
trading/friend-code subs exist for swapping friend codes and raid invites for the
mobile game Pokémon GO. This app is unrelated to Pokémon GO and posting there
would be off-topic spam and quickly removed. Skip it.

If a broader fan or gaming community is wanted beyond the four above, vet each one
the same way: confirm the topic genuinely overlaps (learning / studying / web
tools / fan projects), read its self-promotion rules, and only post where a
no-sign-in study tool is actually on-topic. Quality of fit beats reach.
