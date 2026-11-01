# pwa-and-whats-new Specification

## Purpose
How Poké Memory installs and updates as a PWA, what its service worker caches, how the offline
sprite and cry pack is downloaded and served, the icon and tab due counts, and how a release reaches
players through changelog fragments, the What's new page and its nav pill. This is the baseline:
current behaviour on `qa` at d2456f44, written from code and tests, not what it should be. A
requirement that records behaviour which looks wrong says so and names the issue. Line references
are to that commit. The server side of reminders belongs to `push-notifications` and the grade
replay rules to `cloud-sync`; this spec covers only their service worker and Settings surface.

## Requirements

### Requirement: Web app manifest (baseline)

The manifest SHALL declare the name "Poké Memory", `start_url` `/?source=pwa`, `display` `standalone`,
a white background and theme colour `#DC0A2D`. It SHALL list three icons: `/apple-icon` at 180x180,
and `/icon2` at 192x192 twice, once as `any` and once as `maskable`. It lists no 512x512 icon (#2322).

#### Scenario: Manifest requested

- **WHEN** a browser reads the manifest
- **THEN** the largest icon offered is 192x192 and the app opens at `/?source=pwa` in a standalone window

Source: `app/manifest.ts:5`, `app/manifest.ts:9`, `app/manifest.ts:10`, `app/manifest.ts:13`, `app/icon2.tsx:3`.

### Requirement: iOS launch images (baseline)

`SPLASH_DEVICES` SHALL be the one table for iOS launch images. `splashStartupImages` SHALL give each
device one portrait and one landscape entry at `/splash/<label>-<orientation>.png`, with a media query
of exact device width, height and pixel ratio, and the root layout SHALL pass them to
`appleWebApp.startupImage`.

#### Scenario: A listed device launches

- **WHEN** `splashStartupImages` runs
- **THEN** it returns two entries per device, one for each orientation

#### Scenario: A device not in the table

- **WHEN** an iPad or any device with no matching media query launches the installed app
- **THEN** no launch image entry applies to it

Source: `lib/pwa/splashDevices.ts:29`, `lib/pwa/splashDevices.ts:55`, `lib/pwa/splashDevices.ts:58`, `app/layout.tsx:55`, `lib/pwa/splashDevices.test.ts:1`.

### Requirement: Install state detection (baseline)

`useInstallPrompt` SHALL report `already-installed` when the display mode is standalone, `navigator.standalone`
is true, or the URL has `source=pwa`. Otherwise it SHALL report `android` with a prompt when the head
script has captured `beforeinstallprompt`, `ios` on iPhone, iPad, iPod or a touch-capable Macintosh
user agent that is not Chrome or CriOS, and `unsupported` for anything else. An `appinstalled` event
SHALL move it to `already-installed`.

#### Scenario: Browser tab with the marker

- **WHEN** an ordinary browser tab opens a URL carrying `?source=pwa`
- **THEN** the state is `already-installed`

#### Scenario: Prompt dismissed

- **WHEN** the player dismisses the browser prompt
- **THEN** the state stays `android` with `canPrompt` true and the same event, as only an accepted
  prompt clears it, although an event may only be prompted once (#2325)

Source: `app/layout.tsx:122`, `lib/pwa/useInstallPrompt.ts:28`, `lib/pwa/useInstallPrompt.ts:37`, `lib/pwa/useInstallPrompt.ts:46`, `lib/pwa/useInstallPrompt.ts:58`, `lib/pwa/useInstallPrompt.ts:62`, `lib/pwa/useInstallPrompt.ts:84`.

### Requirement: Install nudge (baseline)

`PwaInstallNudge` SHALL count one visit per browser session in `appVisitCount` and render only from
the third visit, when not dismissed, and on `android` or `ios`. Android SHALL show an install button;
iOS SHALL show translated manual steps. Dismissing, or accepting the prompt, SHALL set
`onboarding.installNudgeDismissed`. A rejected prompt SHALL be swallowed and leave the nudge in place.

#### Scenario: Second visit

- **WHEN** `appVisitCount` is 2
- **THEN** the nudge renders nothing

#### Scenario: Install tapped again after a dismissal

- **WHEN** the same event's `prompt()` rejects
- **THEN** nothing visible happens and the nudge stays (#2325)

Source: `components/onboarding/PwaInstallNudge.tsx:12`, `components/onboarding/PwaInstallNudge.tsx:13`, `components/onboarding/PwaInstallNudge.tsx:27`, `components/onboarding/PwaInstallNudge.tsx:45`, `components/onboarding/PwaInstallNudge.tsx:55`, `components/onboarding/PwaInstallNudge.tsx:62`, `components/onboarding/PwaInstallNudge.tsx:68`, `components/onboarding/PwaInstallNudge.i18n.test.tsx:1`.

### Requirement: Service worker registration (baseline)

`ServiceWorkerProvider` SHALL register `/sw/sw.js` as a module worker with scope `/`, only in a production
build in a browser with service workers, and SHALL be mounted once in the root layout. Every failure
it can meet SHALL go to `console.debug`, never to Sentry or an unhandled rejection, and the app SHALL
carry on as an online-only page.

#### Scenario: Development build

- **WHEN** `NODE_ENV` is not `production`
- **THEN** no worker is registered

#### Scenario: Registration rejects

- **WHEN** `register()` rejects, as under the GoogleOther crawler
- **THEN** one `console.debug` line is written and the page keeps working

Source: `components/pwa/ServiceWorkerProvider.tsx:66`, `components/pwa/ServiceWorkerProvider.tsx:91`, `components/pwa/ServiceWorkerProvider.tsx:101`, `components/pwa/ServiceWorkerProvider.tsx:197`, `app/layout.tsx:258`, `components/pwa/ServiceWorkerProvider.test.tsx:1`.

### Requirement: Service worker build (baseline)

`scripts/build-sw.mjs` SHALL run after `next build` and write `public/sw/sw.js` as a static file, baking
in the precache manifest, the `package.json` version and the public VAPID key. It SHALL fail the build
when the manifest is empty or the emitted worker has no `/_next/` URL. `next.config.ts` SHALL serve
`/sw/sw.js` with `Cache-Control: no-cache` and `Service-Worker-Allowed: /`.

#### Scenario: Run without a Next build

- **WHEN** the script finds no build output
- **THEN** it throws and the process exits 1

Source: `scripts/build-sw.mjs:25`, `scripts/build-sw.mjs:147`, `scripts/build-sw.mjs:162`, `scripts/build-sw.mjs:181`, `scripts/build-sw.mjs:186`, `scripts/build-sw.mjs:206`, `scripts/build-sw.mjs:230`, `scripts/build-sw.mjs:240`, `next.config.ts:63`.

### Requirement: Silent update at a safe moment (baseline)

A new worker SHALL wait (`skipWaiting: false`) and `clientsClaim` SHALL be on. There is no refresh banner.
When a worker is waiting, seen by the `waiting` event or by probing the registration on mount, and the
tab goes hidden with no review session active, the client SHALL post `REQUEST_SKIP_WAITING` to it. The
worker SHALL activate only when at most one window client exists, counting uncontrolled clients.

#### Scenario: Review session running

- **WHEN** the tab hides during an active review session with a worker waiting
- **THEN** nothing is posted and the worker keeps waiting

#### Scenario: Two tabs open

- **WHEN** one of two tabs hides with a worker waiting
- **THEN** the message is posted, the worker declines, neither tab reloads and the next hide tries again

#### Scenario: Serwist's own message

- **WHEN** the client asks a waiting worker to activate
- **THEN** it sends `REQUEST_SKIP_WAITING`, not `SKIP_WAITING`, which would bypass the client count

Source: `app/sw.ts:395`, `app/sw.ts:396`, `app/sw.ts:426`, `app/sw.ts:432`, `app/sw.ts:433`, `components/pwa/ServiceWorkerProvider.tsx:105`, `components/pwa/ServiceWorkerProvider.tsx:114`, `components/pwa/ServiceWorkerProvider.tsx:150`, `components/pwa/ServiceWorkerProvider.tsx:154`, `components/pwa/ServiceWorkerProvider.tsx:165`.

### Requirement: One reload after an accepted update (baseline)

On `controllerchange` the page SHALL reload once, and only if this tab had posted `REQUEST_SKIP_WAITING`.
The reload happens straight away while the tab is hidden, not on return as the file's header comment
says.

#### Scenario: First-ever install

- **WHEN** `clientsClaim` causes a `controllerchange` on a first install
- **THEN** the page does not reload

#### Scenario: Update accepted

- **WHEN** the tab posted the request and the worker takes control
- **THEN** `location.reload()` runs once, and a later `controllerchange` does nothing

Source: `components/pwa/ServiceWorkerProvider.tsx:34`, `components/pwa/ServiceWorkerProvider.tsx:125`, `components/pwa/ServiceWorkerProvider.tsx:156`, `components/pwa/ServiceWorkerProvider.test.tsx:1`.

### Requirement: Update checks (baseline)

The client SHALL call `update()` when a tab returns after at least 90 seconds hidden and at least 2
minutes since the last visibility check, and every hour regardless of visibility.

#### Scenario: Short tab switch

- **WHEN** a tab returns after 30 seconds hidden
- **THEN** no update check runs

#### Scenario: Flipping at the threshold

- **WHEN** a tab returns after 100 seconds hidden, 60 seconds after the last check
- **THEN** no update check runs

Source: `components/pwa/ServiceWorkerProvider.tsx:178`, `components/pwa/ServiceWorkerProvider.tsx:181`, `components/pwa/ServiceWorkerProvider.tsx:192`, `components/pwa/ServiceWorkerProvider.tsx:217`, `components/pwa/ServiceWorkerProvider.tsx:227`, `components/pwa/ServiceWorkerProvider.tsx:235`.

### Requirement: Service worker version in Settings (baseline)

The worker SHALL answer `GET_SW_VERSION` on the supplied port with `SW_VERSION` and its frozen version.
`useServiceWorkerVersion` SHALL report `loading`, then `no-controller`, `ready` or, after 2 seconds with
no reply, `timeout`. Settings About SHALL show that state and an amber mismatch notice when a ready
version differs from `NEXT_PUBLIC_APP_VERSION`. Both versions come from `package.json`.

#### Scenario: Old worker still in control

- **WHEN** the worker reports 0.11.14 and the app is 0.11.15
- **THEN** Settings shows `v0.11.14` and the mismatch notice

#### Scenario: Worker silent

- **WHEN** no reply arrives within 2 seconds
- **THEN** the state is `timeout`

Source: `app/sw.ts:441`, `lib/pwa/useServiceWorkerVersion.ts:34`, `lib/pwa/useServiceWorkerVersion.ts:49`, `lib/pwa/useServiceWorkerVersion.ts:58`, `app/settings/page.tsx:474`, `app/settings/page.tsx:2017`, `app/settings/page.tsx:2024`, `next.config.ts:34`, `components/pwa/useServiceWorkerVersion.test.tsx:73`, `components/pwa/useServiceWorkerVersion.test.tsx:128`.

### Requirement: Request classification (baseline)

`classifyRequest` SHALL treat an unparseable URL, any cross-origin URL and any same-origin `/api/` path as
`network-only`. `/sprites/` and `/cries/` SHALL be `idb-first`, `/_next/static/` `cache-first` in the
static bucket, font files stale-while-revalidate in the fonts bucket, and everything else same-origin,
navigations and `/pokemon-data/` included, stale-while-revalidate in the pages bucket.

#### Scenario: Authenticated API response

- **WHEN** a same-origin `/api/export` request is classified
- **THEN** it is `network-only`

#### Scenario: Optimised image of an external source

- **WHEN** `/_next/image` carries a cross-origin `url`
- **THEN** it goes to the pages bucket

#### Scenario: Optimised image of a sprite

- **WHEN** `/_next/image` carries a same-origin `url` under `/sprites/`
- **THEN** it is classified once by that decoded path, as `idb-first`

Source: `lib/pwa/cacheStrategy.ts:128`, `lib/pwa/cacheStrategy.ts:135`, `lib/pwa/cacheStrategy.ts:140`, `lib/pwa/cacheStrategy.ts:145`, `lib/pwa/cacheStrategy.ts:150`, `lib/pwa/cacheStrategy.ts:160`, `lib/pwa/cacheStrategy.ts:196`, `lib/pwa/cacheStrategy.ts:202`, `lib/pwa/cacheStrategy.ts:216`, `lib/pwa/cacheStrategy.ts:260`, `lib/pwa/cacheStrategy.test.ts:1`.

### Requirement: Runtime cache buckets (baseline)

Bucket names SHALL carry the `SW_CACHE_VERSION` suffix, currently `v2`. Static SHALL hold 128 entries for
30 days, fonts 16 for 30 days and pages 64 for 7 days. Requests classified `network-only` match no route
and go straight to the network. Navigation preload SHALL be off.

#### Scenario: Cold launch after a deploy

- **WHEN** the installed app opens with a cached page
- **THEN** the cached page is served at once from the pages bucket and refreshed in the background, so
  the first launch after a deploy can show the previous build's HTML (see What's New requirement,
  #2327)

#### Scenario: Offline navigation never visited

- **WHEN** a route with no cached copy is opened offline
- **THEN** the request fails, as no offline fallback page is configured

Source: `lib/pwa/cacheStrategy.ts:64`, `lib/pwa/cacheStrategy.ts:74`, `lib/pwa/cacheStrategy.ts:84`, `app/sw.ts:326`, `app/sw.ts:341`, `app/sw.ts:374`, `app/sw.ts:401`.

### Requirement: Precache manifest (baseline)

The worker SHALL precache `.next/static` JS and CSS, root `public` PNG, SVG, ICO and webmanifest files, and
`public/pokemon-data/*.json`, excluding sprites and `generated-flavor.json`, with a 2 MiB per-file cap.
Outdated precaches SHALL be cleaned up on update.

#### Scenario: Flavour text

- **WHEN** the manifest is built
- **THEN** `generated-flavor.json` is not in it and is cached only by use

Source: `scripts/build-sw.mjs:63`, `scripts/build-sw.mjs:87`, `scripts/build-sw.mjs:88`, `app/sw.ts:387`, `app/sw.ts:390`.

### Requirement: Legacy cache removal and what stays after sign-out (baseline)

Activating a worker SHALL delete `poke-memory-sprites-v2` and `poke-memory-cries-v2`, and do nothing when
`caches` is absent. Sign-out SHALL NOT clear any cache or the offline pack. No code deletes buckets
orphaned by a future `SW_CACHE_VERSION` bump.

#### Scenario: Sign-out

- **WHEN** a player signs out
- **THEN** only the Supabase session ends; Cache Storage and the `offline-pack` store are unchanged

Source: `app/sw.ts:849`, `app/sw.ts:854`, `lib/pwa/cacheStrategy.ts:102`, `lib/auth/actions.ts:24`.

### Requirement: Sprites and cries served from IndexedDB (baseline)

The `idb-first` route SHALL look up the request's pathname in `offline-pack`, racing a 1.5 second timeout,
and on a miss, timeout or any error SHALL `fetch` the request without storing the response. A
`/_next/image` request reaches this route with the key `/_next/image`, so it always misses; sprites do
not use that endpoint today.

#### Scenario: Pack downloaded, offline

- **WHEN** `/sprites/pokemon/webp/25/320.webp` is in the store
- **THEN** it is served from IndexedDB with no network use

#### Scenario: IndexedDB stalls

- **WHEN** the lookup takes over 1.5 seconds
- **THEN** the handler falls back to the network, and offline that fetch fails

Source: `app/sw.ts:277`, `app/sw.ts:289`, `app/sw.ts:299`, `app/sw.ts:309`, `app/sw.ts:318`, `lib/pwa/swIdb.ts:28`, `lib/pwa/offlineStore.test.ts:293`.

### Requirement: Range requests for pack assets (baseline)

`buildOfflineAssetResponse` SHALL answer a satisfiable single `bytes=` range with 206, `Content-Range` and
the sliced body, and anything else with a full 200. Both SHALL send `Accept-Ranges: bytes`. A multi-range,
unparseable or unsatisfiable header SHALL get the full 200.

#### Scenario: WebKit plays an offline cry

- **WHEN** `<audio>` requests `bytes=0-1` of a pack cry
- **THEN** the response is 206 with `Content-Range: bytes 0-1/<size>`

#### Scenario: Start past the end

- **WHEN** the range starts at or past the blob size
- **THEN** the response is a full 200

Source: `lib/pwa/rangeResponse.ts:42`, `lib/pwa/rangeResponse.ts:58`, `lib/pwa/rangeResponse.ts:72`, `lib/pwa/rangeResponse.ts:83`, `lib/pwa/rangeResponse.ts:95`, `lib/pwa/rangeResponse.test.ts:1`.

### Requirement: Shared IndexedDB connection in the worker (baseline)

The worker SHALL open `poke-memory` at version 2 through one cached promise, creating `kv` on a fresh
install and `offline-pack` when absent. If the upgrade is blocked it SHALL reject after 1.5 seconds, and any
failure or `versionchange` SHALL clear the cached promise so the next caller retries.

#### Scenario: Concurrent sprite requests

- **WHEN** many sprites load during a grid render
- **THEN** one `open` runs and all share it

#### Scenario: A stale connection blocks the upgrade

- **WHEN** `onblocked` fires
- **THEN** the promise rejects after 1.5 seconds and the next call opens again

Source: `app/sw.ts:69`, `app/sw.ts:466`, `lib/pwa/swIdb.ts:98`, `lib/pwa/swIdb.ts:132`, `lib/pwa/swIdb.ts:139`, `lib/pwa/swIdb.ts:156`, `lib/idb/db.ts:21`, `lib/pwa/swIdb.test.ts:1`.

### Requirement: Offline pack contents (baseline)

The pack SHALL hold, for each default-form species, WebP sprites at widths 32, 40, 48, 56, 64, 120, 150, 192
and 320 plus `/cries/<id>.ogg`. Width 180 and raw PNGs SHALL be left out. Entries SHALL live in the
IndexedDB `offline-pack` store, keyed by relative URL, as a blob and content type, never in Cache Storage.

#### Scenario: Building the list for one species

- **WHEN** `buildPrecacheUrls([25])` runs
- **THEN** it returns nine sprite URLs and one cry URL

Source: `lib/pwa/precache.ts:101`, `lib/pwa/precache.ts:157`, `lib/pwa/offlineStore.ts:190`, `components/settings/OfflineSection.tsx:191`, `lib/pwa/precache.test.ts:1`.

### Requirement: Download run (baseline)

`precacheAll` SHALL run six workers, skip a URL already stored, count a non-ok response or failed store as
`failed`, report progress after each URL, and stop starting URLs once aborted. When IndexedDB cannot be
opened `offlinePut` SHALL resolve without storing, so that URL counts as downloaded.

#### Scenario: Resume

- **WHEN** a download is started with half the URLs stored
- **THEN** those count as `skipped` and are not fetched

#### Scenario: IndexedDB unavailable

- **WHEN** `openOfflineDb` returns null during a run
- **THEN** each fetched URL counts as `downloaded` and nothing is stored (#2323)

Source: `lib/pwa/precache.ts:36`, `lib/pwa/precache.ts:202`, `lib/pwa/precache.ts:217`, `lib/pwa/precache.ts:241`, `lib/pwa/precache.ts:289`, `lib/pwa/precache.ts:319`, `lib/pwa/offlineStore.ts:192`, `lib/pwa/precache.test.ts:199`, `lib/pwa/precache.test.ts:211`.

### Requirement: Download survives navigation (baseline)

`downloadController` SHALL hold the state and abort controller at module level, so unmounting Settings does
not stop a run. `subscribe` SHALL emit the current state at once, a second `startDownload` during a run
SHALL do nothing, and Stop SHALL return to `idle`. A full page unload during a run SHALL trigger the
browser's leave warning. On load, a stored timestamp SHALL seed `done`.

#### Scenario: Leaving Settings mid-download

- **WHEN** the player navigates within the app and comes back
- **THEN** the run continues and progress shows on return

#### Scenario: Stop

- **WHEN** Stop is tapped
- **THEN** the phase returns to `idle` and stored entries remain for a later resume

Source: `lib/pwa/downloadController.ts:50`, `lib/pwa/downloadController.ts:76`, `lib/pwa/downloadController.ts:222`, `lib/pwa/downloadController.ts:237`, `lib/pwa/downloadController.ts:258`, `lib/pwa/downloadController.ts:310`, `components/settings/OfflineSection.tsx:131`, `components/settings/OfflineSection.test.tsx:266`, `components/settings/OfflineSection.test.tsx:1006`.

### Requirement: When a download counts as finished (baseline)

The run SHALL end in `error`, writing no timestamp, only when nothing was downloaded and at least one URL
failed. Every other finished run SHALL write the timestamp and current manifest and end in `done`, whatever
the failure count, which is not shown to the player (#2323). The controller's failure text is
hard-coded English, and any other thrown error's raw message is shown as is.

#### Scenario: Total failure

- **WHEN** `downloaded` is 0 and `failed` is above 0
- **THEN** an error shows and no timestamp is written

#### Scenario: Connection lost part way

- **WHEN** a run ends with `downloaded` 10 and `failed` 90
- **THEN** the phase is `done`, Settings says up to date and Update is disabled (#2323)

Source: `lib/pwa/downloadController.ts:267`, `lib/pwa/downloadController.ts:270`, `lib/pwa/downloadController.ts:279`, `lib/pwa/downloadController.ts:289`, `lib/pwa/downloadController.ts:297`, `components/settings/OfflineSection.tsx:320`, `components/settings/OfflineSection.tsx:334`, `components/settings/OfflineSection.test.tsx:326`.

### Requirement: Storage headroom check (baseline)

Before starting, Settings SHALL compare free quota with 186 MB (166 MB pack plus 20 MB buffer). With too
little, it SHALL show a warning dialog offering cancel or proceed. When the estimate is unavailable or throws,
the download SHALL start without a check.

#### Scenario: Exactly enough

- **WHEN** free space equals the required bytes
- **THEN** `hasHeadroom` is true

#### Scenario: Too little, proceed

- **WHEN** the player chooses to download anyway
- **THEN** the run starts with the same ids

Source: `lib/pwa/precache.ts:51`, `lib/pwa/precache.ts:63`, `lib/pwa/downloadController.ts:168`, `lib/pwa/downloadController.ts:186`, `components/settings/OfflineSection.tsx:195`, `components/settings/OfflineSection.tsx:211`, `lib/pwa/downloadController.quota.test.ts:114`, `components/settings/OfflineSection.test.tsx:790`.

### Requirement: Download state matches the store (baseline)

On mounting Settings, `reconcileWithStorage` SHALL clear the stored timestamp and manifest and return to
`idle` when the phase is `done` and the store is confirmed empty. It SHALL leave the state alone when the
store has any entry, when IndexedDB errors, or in any other phase.

#### Scenario: Migrated device

- **WHEN** localStorage says done and the store is empty
- **THEN** the Download button shows

#### Scenario: Transient error

- **WHEN** `offlineCount` throws
- **THEN** `done` and the localStorage keys are kept

Source: `lib/pwa/downloadController.ts:356`, `lib/pwa/downloadController.ts:361`, `lib/pwa/downloadController.ts:372`, `lib/pwa/downloadController.ts:381`, `components/settings/OfflineSection.tsx:102`, `lib/pwa/downloadController.reconcile.test.ts:110`, `lib/pwa/downloadController.reconcile.test.ts:215`.

### Requirement: Knowing when the pack is out of date (baseline)

A manifest SHALL be an FNV-1a signature over the sorted URLs and `SW_CACHE_VERSION`, plus the species count.
In `done`, Settings SHALL show up to date and disable Update when the signatures match, and otherwise show
update available, with a count only when the species count rose.

#### Scenario: New species ship

- **WHEN** the current count is above the persisted count
- **THEN** Settings shows the count of new species and Update is enabled

#### Scenario: Settings opens before the seed loads

- **WHEN** the state is `done` and `getSeedIfLoaded` returns null
- **THEN** the current manifest has an empty signature and Settings shows update available even for a
  current pack, until the download state next changes, as the seed's arrival does not recompute it (#2324)

#### Scenario: Download tapped before the seed loads

- **WHEN** the seed is null and Download is tapped
- **THEN** a run starts with no ids and ends in `done` with nothing stored (#2324)

Source: `lib/pwa/manifestSignature.ts:48`, `lib/pwa/manifestSignature.ts:75`, `lib/pwa/downloadController.ts:111`, `lib/pwa/downloadController.ts:114`, `components/settings/OfflineSection.tsx:74`, `components/settings/OfflineSection.tsx:85`, `components/settings/OfflineSection.tsx:191`, `lib/pwa/manifestSignature.test.ts:1`, `components/settings/OfflineSection.test.tsx:362`.

### Requirement: Deleting the pack (baseline)

After a confirm dialog, delete SHALL clear `offline-pack`, delete the legacy buckets, remove the timestamp and
manifest and return to `idle`. The button SHALL show only in `done`. The dialog's size is the origin's whole
storage use, not the pack's.

#### Scenario: Confirmed

- **WHEN** the player confirms
- **THEN** the store and keys are cleared and the Download button shows

#### Scenario: Cancelled

- **WHEN** the dialog is cancelled or Escape is pressed
- **THEN** nothing changes

Source: `components/settings/OfflineSection.tsx:236`, `components/settings/OfflineSection.tsx:242`, `components/settings/OfflineSection.tsx:256`, `components/settings/OfflineSection.tsx:268`, `components/settings/OfflineSection.tsx:340`, `components/settings/OfflineSection.tsx:420`, `lib/pwa/offlineStore.ts:274`, `components/settings/OfflineSection.test.tsx:461`, `components/settings/OfflineSection.test.tsx:484`.

### Requirement: App icon due count (baseline)

Where `setAppBadge` exists, `usePwaBadge` SHALL set the badge to `computeQueueCount`'s total and clear it at
zero, with no session, and on unmount. It SHALL resync on session and settings changes, swallow badge API
errors, and ignore superuser flags. Elsewhere it SHALL do nothing. The incomplete-chains preset matches
nothing here. A Favourites scope counts nothing (#2253).

#### Scenario: Cards due

- **WHEN** 12 cards are due and a settings save fires
- **THEN** the badge shows 12

#### Scenario: No session

- **WHEN** `loadSession` returns null
- **THEN** the badge is cleared

Source: `components/pwa/usePwaBadge.ts:40`, `components/pwa/usePwaBadge.ts:50`, `components/pwa/usePwaBadge.ts:68`, `components/pwa/usePwaBadge.ts:83`, `components/pwa/usePwaBadge.ts:99`, `components/pwa/usePwaBadge.ts:104`, `components/pwa/usePwaBadge.ts:116`, `components/pwa/usePwaBadge.test.tsx:1`.

### Requirement: Tab title due count (baseline)

`useDocumentTitleBadge` SHALL prefix the title with `(N)` from the same count, strip it at zero and on unmount,
and reapply it when a route changes the `<title>`.

#### Scenario: Route change

- **WHEN** a navigation replaces the title with 8 cards due
- **THEN** the title becomes `(8) <route title>`

#### Scenario: Nothing due

- **WHEN** the count is 0
- **THEN** the title has no prefix

Source: `components/pwa/useDocumentTitleBadge.ts:46`, `components/pwa/useDocumentTitleBadge.ts:50`, `components/pwa/useDocumentTitleBadge.ts:74`, `components/pwa/useDocumentTitleBadge.ts:110`, `components/pwa/useDocumentTitleBadge.ts:132`, `components/pwa/useDocumentTitleBadge.test.tsx:1`.

### Requirement: Persistent storage request (baseline)

On layout mount, where the API exists, the app SHALL request persistent storage unless a stored marker says
it was already granted. The marker SHALL be written only on a grant or when already persisted, so a refusal
retries on the next mount. Rejections SHALL be ignored.

#### Scenario: Refused

- **WHEN** `persist()` resolves false
- **THEN** no marker is written and the next mount asks again

Source: `lib/pwa/usePersistentStorage.ts:26`, `lib/pwa/usePersistentStorage.ts:37`, `lib/pwa/usePersistentStorage.ts:44`, `lib/pwa/usePersistentStorage.ts:49`, `lib/pwa/usePersistentStorage.ts:57`, `components/pwa/StoragePersistenceRequester.tsx:15`.

### Requirement: Background Sync in the worker (baseline)

On `poke-memory:grade-sync` the worker SHALL post `BACKGROUND_SYNC_REPLAY` to controlled windows and wait 3
seconds for an ACK. On an ACK it SHALL stop. With no client or no ACK it SHALL POST the IndexedDB queue to
`/api/sync`, clearing it on success or 401 or 403, and throwing on a network error or other status so the
browser retries. Retrying 400 and 409 is #2209, and the handler has no test that runs it.

#### Scenario: App closed, reconnect

- **WHEN** the event fires with no windows and a queued grade
- **THEN** the worker POSTs the queue and clears it on 200

#### Scenario: Signed out meanwhile

- **WHEN** the POST returns 401
- **THEN** the queue is cleared and the event resolves

Source: `app/sw.ts:595`, `app/sw.ts:627`, `app/sw.ts:636`, `app/sw.ts:663`, `app/sw.ts:667`, `app/sw.ts:678`, `app/sw.ts:687`, `app/sw.ts:699`, `app/sw.ts:709`, `app/sw.ts:716`, `lib/sync/swReplay.test.ts:18`.

### Requirement: Showing a push and opening it (baseline)

A `push` event SHALL always show a notification, using payload title, body and url where they are non-empty
strings, and the defaults otherwise, including for malformed JSON. The tag is fixed (#2267). A click SHALL close
the notification, focus a window already at the URL, else navigate and focus the first window, else open a
new one.

#### Scenario: Malformed payload

- **WHEN** the payload is not JSON
- **THEN** the default title and body show, with url `/`

#### Scenario: App open elsewhere

- **WHEN** the tapped URL matches no window but one exists
- **THEN** that window navigates there and takes focus

Source: `app/sw.ts:739`, `app/sw.ts:751`, `app/sw.ts:760`, `app/sw.ts:775`, `app/sw.ts:787`, `app/sw.ts:808`, `app/sw.ts:818`, `app/sw.ts:830`.

### Requirement: Rotated push subscriptions (baseline)

On `pushsubscriptionchange` the worker SHALL use the new subscription or create one with the baked VAPID key,
then POST it to `/api/push/resubscribe`. With no key, or on any failure, it SHALL resolve without retrying.

#### Scenario: Build with no key

- **WHEN** the baked key is empty
- **THEN** the handler returns without a request

Source: `app/sw.ts:880`, `app/sw.ts:884`, `app/sw.ts:905`, `app/sw.ts:921`, `app/sw.ts:931`.

### Requirement: Reminder toggle in Settings (baseline)

`PushOptIn` SHALL render only when push is supported and the app is installed, and a local subscription SHALL
be reconciled with the server on mount, turning the toggle off when reconciliation returns `disabled`. The
toggle SHALL be disabled when permission is denied, and the streak toggle SHALL need the daily toggle on.
Some of the card's copy is hard-coded English (#2269).

#### Scenario: Browser tab

- **WHEN** Settings opens outside an installed app
- **THEN** the card renders nothing

#### Scenario: Daily reminder turned off

- **WHEN** unsubscribing succeeds with the streak toggle on
- **THEN** `streakNudgeEnabled` is saved false

#### Scenario: Superuser flag on

- **WHEN** any superuser flag is on
- **THEN** the toggle is replaced by a disabled button and subscribing does nothing

Source: `components/pwa/PushOptIn.tsx:86`, `components/pwa/PushOptIn.tsx:103`, `components/pwa/PushOptIn.tsx:107`, `components/pwa/PushOptIn.tsx:126`, `components/pwa/PushOptIn.tsx:158`, `components/pwa/PushOptIn.tsx:166`, `components/pwa/PushOptIn.tsx:185`, `components/pwa/PushOptIn.tsx:201`, `components/pwa/PushOptIn.test.tsx:1`.

### Requirement: What's New page (baseline)

`/whats-new` SHALL show a translated heading, the running version, and the 20 newest releases with at least one
bullet, each with its version, a locale-formatted date and translated section labels. Bullet text stays in
English in every locale. With no releases it SHALL show the empty message. Rendering SHALL write the running
version to the last-seen marker.

#### Scenario: Normal visit

- **WHEN** the page loads
- **THEN** release headings appear as `v<version>`, newest first, and at most 20 show

#### Scenario: Non-English locale

- **WHEN** the locale is `ja`
- **THEN** headings, labels and dates are localised and the bullets are English

#### Scenario: Cached copy after an update

- **WHEN** the worker serves a stale-while-revalidate copy from before an update
- **THEN** the copy carries the previous build's version and notes; expected from the code, not
  reproduced (#2327)

Source: `app/whats-new/page.tsx:15`, `app/whats-new/page.tsx:16`, `app/whats-new/page.tsx:21`, `app/whats-new/page.tsx:25`, `app/whats-new/page.tsx:43`, `app/whats-new/page.tsx:63`, `app/whats-new/page.tsx:70`, `components/whats-new/MarkVisited.tsx:7`, `e2e/whats-new.spec.ts:9`.

### Requirement: Reading CHANGELOG.md (baseline)

`parseChangelog` SHALL accept `## [X.Y.Z] - YYYY-MM-DD`, with a hyphen or a legacy em dash, and SHALL end a
release at any other `## ` heading. It SHALL keep only the six known `###` kinds, in canonical order, merge
repeated kinds, drop `Internal:` bullets, and drop releases with no bullets left. `getChangelog` SHALL read
`CHANGELOG.md`, cache the result outside development, and return an empty list when the file is missing.

#### Scenario: Wrapped bullet

- **WHEN** an indented line follows a bullet
- **THEN** it extends the bullet, a blank line ends it, and an unindented prose line does not end it,
  contrary to the comment (#2326)

#### Scenario: Internal-only release

- **WHEN** a release has only `Internal:` bullets
- **THEN** it does not appear

#### Scenario: File missing

- **WHEN** `CHANGELOG.md` cannot be read
- **THEN** the page shows its empty message, not a 500

Source: `lib/changelog/parse.ts:33`, `lib/changelog/parse.ts:52`, `lib/changelog/parse.ts:74`, `lib/changelog/parse.ts:92`, `lib/changelog/parse.ts:105`, `lib/changelog/parse.ts:110`, `lib/changelog/parse.ts:114`, `lib/changelog/parse.ts:139`, `lib/changelog/parse.ts:145`, `lib/changelog/parse.ts:150`, `next.config.ts:47`, `lib/changelog/parse.test.ts:99`, `lib/changelog/parse.test.ts:255`.

### Requirement: Bullet formatting (baseline)

`BulletText` SHALL render backtick spans as code, `http(s)` Markdown links as links opening a new tab, a link
with any other scheme as its plain label, and `(#N)` as a link to
`github.com/fraserbrookhouse/poke-memory/issues/N`. That address answers 404, as the repo is now under
Frazzled-Productions (#2321). Everything else SHALL be plain text.

#### Scenario: Unsafe link

- **WHEN** a bullet has `[x](javascript:alert(1))`
- **THEN** only the text `x` renders

#### Scenario: Issue reference

- **WHEN** a bullet ends `(#2000)`
- **THEN** it links to the old owner's path, which is a 404 (#2321)

Source: `components/whats-new/BulletText.tsx:14`, `components/whats-new/BulletText.tsx:24`, `components/whats-new/BulletText.tsx:37`, `components/whats-new/BulletText.tsx:58`, `components/whats-new/BulletText.test.tsx:1`.

### Requirement: What's new pill (baseline)

`WhatsNewIndicator` SHALL show a link in the nav when the build is newer than the last-seen marker, and never on
`/whats-new`. A device with no marker SHALL be seeded with the running version and see no pill. It SHALL follow
`storage` events for the marker, treating a removed marker as nothing unseen. The marker is per device, stored
raw and never synced. Footer, Settings About and the privacy page link to the page at all times.

#### Scenario: First visit

- **WHEN** no marker exists
- **THEN** it is set to the running version and no pill shows

#### Scenario: New release

- **WHEN** the marker is 0.11.14 and the build 0.11.15
- **THEN** the pill shows until the page writes 0.11.15

#### Scenario: Non-semver version

- **WHEN** either version is not `X.Y.Z`, such as `dev`
- **THEN** `compareSemver` returns 0 and no pill shows

Source: `components/whats-new/WhatsNewIndicator.tsx:26`, `components/whats-new/WhatsNewIndicator.tsx:28`, `components/whats-new/WhatsNewIndicator.tsx:33`, `components/whats-new/WhatsNewIndicator.tsx:37`, `components/whats-new/WhatsNewIndicator.tsx:50`, `components/NavLinks.tsx:67`, `components/MobileNavSlot.tsx:53`, `components/NavDrawer.tsx:287`, `components/Footer.tsx:42`, `app/settings/page.tsx:2046`, `lib/version/compare.ts:2`, `lib/version/compare.ts:10`, `lib/version/lastSeen.ts:13`, `lib/storage/keys.ts:90`, `components/whats-new/WhatsNewIndicator.test.tsx:1`, `lib/version/compare.test.ts:1`, `lib/version/lastSeen.test.ts:1`, `e2e/whats-new.spec.ts:21`.

### Requirement: Changelog fragments (baseline)

A fragment in `changelog.d/unreleased/` SHALL have front-matter with a `kind` from `added`, `changed`, `removed`,
`deprecated`, `fixed`, `security` or `minor-bump`, other keys being ignored, and at least one `- ` bullet unless
it is `minor-bump`. The PR lint and the release cut SHALL share one parser. That parser keeps only the `- ` lines,
so a bullet's wrapped lines are dropped (#2326).

#### Scenario: Extra key

- **WHEN** a fragment has `issue: 2187`
- **THEN** it parses

#### Scenario: No bullet

- **WHEN** a `fixed` fragment has no bullet
- **THEN** `npm run lint:changelog` fails

Source: `scripts/lib/changelog-fragment.mjs:20`, `scripts/lib/changelog-fragment.mjs:43`, `scripts/lib/changelog-fragment.mjs:69`, `scripts/lib/changelog-fragment.mjs:75`, `scripts/lib/changelog-fragment.mjs:84`, `scripts/lint-changelog-fragments.mjs:17`, `scripts/lint-changelog-fragments.mjs:59`, `scripts/lib/changelog-fragment.test.mjs:1`, `changelog.d/README.md:9`.

### Requirement: Cutting a release (baseline)

`cut-release.mjs` SHALL do nothing with no fragments, or none with content and no minor bump. Otherwise it SHALL
bump the minor version for any `minor-bump` and the patch version if not, insert the section after `[Unreleased]`
in canonical kind order, and update `package.json`; `auto-release.yml` SHALL remove the fragments. A `minor-bump`
with no other fragment cuts an empty section, which What's New omits while the version still rises and the
pill shows.

#### Scenario: Patch release

- **WHEN** only `fixed` fragments exist at 0.11.15
- **THEN** the version becomes 0.11.16 with a dated section

#### Scenario: Malformed fragment at cut time

- **WHEN** a fragment fails to parse
- **THEN** the cut exits with an error

Source: `.github/scripts/cut-release.mjs:49`, `.github/scripts/cut-release.mjs:68`, `.github/scripts/cut-release.mjs:93`, `.github/scripts/cut-release.mjs:100`, `.github/scripts/cut-release.mjs:114`, `.github/scripts/cut-release.mjs:141`, `.github/scripts/cut-release.mjs:168`, `.github/workflows/auto-release.yml:133`, `.github/workflows/auto-release.yml:143`.

### Requirement: Release gates on PRs (baseline)

`changelog-gate` SHALL fail a non-fork PR touching a user-facing path with no added fragment, unless it has the
`no-changelog` label. `version-bump-gate` SHALL fail a PR with a `minor-bump` or `major-bump` fragment unless it
has `version-bump:approved`. `major-bump` passes that gate's recognition, but the shared parser rejects it.

#### Scenario: Minor bump without the label

- **WHEN** a PR adds `kind: minor-bump` with no approval label
- **THEN** `version-bump-gate` fails

#### Scenario: Major bump

- **WHEN** a fragment has `kind: major-bump`
- **THEN** the lint and the release cut reject it

Source: `.github/workflows/changelog-gate.yml:6`, `.github/workflows/changelog-gate.yml:12`, `.github/workflows/version-bump-gate.yml:3`, `.github/workflows/version-bump-gate.yml:40`, `scripts/lib/changelog-fragment.mjs:75`.
