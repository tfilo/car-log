# car-log implementation plan

This is a planning baseline, not authorization to implement all phases. Discuss and agree on one small step at a time. Database setup, authentication models, registration, login, sliding sessions, current-user lookup, and logout are implemented. Administrator operations, self-deletion, profile changes, email verification, and verified-email password recovery are implemented. Phase 3 authentication GUI, Phase 4 vehicles, Phase 5 fuel/charging, Phase 6 other expenses/categories, and Phase 7 statistics/charts are implemented; operator recovery procedures remain a separate operational step.

## Current foundation

- React/TanStack Start, Router, Query, Vite, TypeScript, and Tailwind are configured.
- The custom server entry exports a request handler. Devtools load lazily in the browser during development.
- Lint, formatting, TypeScript, production build, and development/production HTTP smoke checks passed after the HTTP 500 fix.
- Development PostgreSQL 18 is configured in `compose.yaml`, with persistent storage, a health check, loopback-only port publishing, and ignored local configuration. See `README.md` for commands.
- Prisma 7 is wired with a PostgreSQL datasource, an ignored generated client, and a server-only client module. Engine access, client generation, schema validation, TypeScript, lint, formatting, and the production build are verified.
- Authentication, registration, sliding sessions, administrator user management, and self-deletion are implemented. The authentication and account-management tests pass, including permission checks, pagination/redaction, approval, block/unblock revocation, role changes, typed-username confirmation, last-active-admin protection under concurrent mutations, and regular-user self-only deletion. Development and production RPC checks passed for both authentication and account management. User-facing codes/keys have Slovak resources; the authentication GUI is implemented in Phase 3, while operator recovery remains future work. Verified-email password recovery is implemented.

## Agreed authentication design

Database-backed sessions with an HttpOnly cookie are implemented as agreed. The browser receives a random opaque session token in the cookie; PostgreSQL stores a hash of the token, the user reference, expiry, and revocation/lifecycle information. Look up the session and current account status on authenticated requests. Use the implemented TanStack Start cookie helpers and revalidate authoritative session/account state on every protected operation.

TanStack's session utilities and JWT are not interchangeable concepts. A framework session helper may store encrypted data in a cookie rather than provide a database session store. Verify that distinction before selecting the implementation. A signed/encrypted cookie alone does not provide immediate revocation; the server must still check authoritative account/session state.

Database sessions fit approval and blocking particularly well: logout, blocking, deletion, and session revocation can take effect immediately. JWTs add refresh/revocation complexity here without a current requirement for independently verified tokens or external API clients. Reconsider if mobile applications or third-party API integrations become a requirement.

Account states are `PENDING`, `ACTIVE`, and `BLOCKED`, separate from roles `USER` and `ADMIN`. Agreed registration policy: the first successful registration becomes an `ACTIVE` `ADMIN`; subsequent registrations start as `PENDING` `USER` accounts and require approval before login. Registration implements this policy. Login rejects pending/blocked accounts with the same generic response used for unknown identifiers and incorrect passwords.

The first-registration exception is implemented in a server transaction, never via client-supplied role/status. It locks the `RegistrationState` singleton and records bootstrap completion, preventing simultaneous administrators or reopening after user deletion. The migration closes bootstrap for existing users. Last-active-admin protection and typed-username deletion confirmation are agreed and implemented. Verified-email password recovery is implemented without any privilege or approval bypass. Operator recovery for accounts without a usable verified email remains separate.

## Phase 1: PostgreSQL and Prisma foundation

Agreed development database: PostgreSQL 18 running in Docker Compose. The database-only Compose setup is implemented with persistent storage, a health check, and local environment configuration. Prisma foundation work is authorized and configured without application models. Packaging the application in Compose remains a later phase.

Scope: add compatible pinned Prisma packages, configuration, a server-only database client, a non-secret environment example, and documented generate/connect/migration commands. Keep this step independent of registration endpoints and UI. Introduce only the initial schema necessary for the agreed scope; do not model all future expenses yet.

Done when: Prisma generation and a real PostgreSQL connection work, the agreed initial migration (if any) applies to a fresh development database, no secrets/client-side database code are exposed, and existing application checks still pass.

## Phase 2: Authentication data and server operations

Steps 1–4 below are implemented at the backend level:

1. Agree on user/session fields, role and status rules, email normalization, password policy, and safe first-admin provisioning; then add the schema/migration.
2. Add Zod validation, password hashing, and registration without UI. Public registration cannot select role/status.
3. Add login, session creation, current-user lookup, logout, expiry, revocation, and reusable authentication/authorization checks.
4. Add administrator user listing, approval, blocking, and deletion using the agreed retention policy. Blocking/deletion must invalidate access from existing sessions.

Completed: user/session models and server-side registration (steps 1–2 above). `User` has required unique email/username, optional firstName/lastName, password hash, role/status, and timestamps. `Session` has a unique token hash, owner, expiry, and creation time. Both use PostgreSQL UUID v7. Registration lowercases/trims email; usernames are 3–30 lowercase ASCII letters/digits, preventing email ambiguity. Passwords are 10–128 ASCII characters with lowercase, uppercase, and a digit; agreed special characters are optional, and whitespace is rejected. Hashing uses Node crypto Argon2id with no hashing dependency. Optional names are trimmed and limited to 100 characters. Registration does not issue sessions or log users in.

Request middleware in `src/start.ts` applies TanStack CSRF protection, an 8 KiB actual body-size limit, a body-read deadline, and method/content-type validation before RPC deserialization. Production traffic limits belong in Traefik; application request quotas, work-capacity caps, resend cooldowns, and client-IP resolution have been removed. The generated client receives typed results with stable error codes and validation translation keys. Slovak user-facing copy lives in the i18next-compatible `auth` bundle. The browser module/bundle excludes database and hashing code. First-admin provisioning remains atomic and permanent. Tests use disposable databases for account workflows and rolled-back records for model checks. CI runs the tests with PostgreSQL.

Vitest is configured for model integration tests. Extend coverage as server operations are implemented: duplicate-registration races, rejected credentials, pending/blocked-account restrictions, session expiry/logout, admin-only operations, and ownership rules. Include CSRF and login/registration abuse protection in the authentication scope rather than postponing them until deployment.

Password verification/upgrade groundwork is complete: new hashes use `.env` targets (`ARGON2_MEMORY`, `ARGON2_PASSES`, `ARGON2_PARALLELISM`; recommended defaults 65536 KiB/3/1). Verification uses stored PHC settings within stable supported bounds (19456–262144 KiB, 2–10 passes, 1–4 lanes), so target changes do not invalidate older supported hashes. `passwordNeedsRehash` detects policy differences; `verifyUserPassword` verifies first, then conditionally replaces the original database hash using a fresh salt. It refuses to overwrite concurrent password changes. Passwords are compared exactly, and the same pepper remains required. Malformed/out-of-range hashes return false; invalid hashing configuration throws. Login uses the verified/upgraded hash as proof, then locks/rechecks the account status and hash before session creation. Sessions, login/logout, administrator account management, and self-deletion are implemented. The corresponding GUI is implemented in Phase 3.

Done when: the agreed server operations and failure cases are exercised without needing a GUI, and the existing checks pass.

Sessions use 14-day sliding inactivity with no absolute lifetime cap while active. Successful session checks renew both database and cookie expiry; login rotates the token. Logout revokes the current device only. Blocking or any status change away from ACTIVE deletes all sessions via a database trigger; unblocking does not resurrect tokens. Account deletion cascades. Login uses generic INVALID_CREDENTIALS for unknown identifiers, wrong passwords, and inactive accounts, with Argon2 work on each failure path. Exact wall-clock equality is not guaranteed.

Administrator management and self-deletion are complete: `listUsers` provides bounded pagination and safe account fields; `manageUser` handles approval, block/unblock, role changes, and deletion. Mutations serialize with an advisory transaction lock and revalidate the session/current role. Removing the last ACTIVE ADMIN is forbidden, even under concurrent calls. `deleteMyAccount` derives the target from the session and accepts no user ID. Both deletion paths require the exact current username. Deletion cascades to sessions; blocking revokes sessions through the existing trigger. Account deletion permanently removes all owned vehicles, pictures, and future expenses. Recovery remains recommended for lost passwords/secrets; it is not solved by last-admin protection and no bypass was implemented.

## Phase 3: Authentication GUI

Implemented: Slovak registration/login, protected routes, a temporary account home,
and a shared authenticated layout with tope-ui Header menu/profile/logout actions.
Public forms use Content/Page/Section and Grid/Column inputs. UI translations use
react-i18next; core Zod schemas remain shared with authoritative server validation.

TanStack Query manages current-user state, refreshes it on navigation/focus and
once per minute while visible, and clears private account caches on logout,
deletion, and profile saves. Login failures stay generic. Registration success
explains approval and verification separately. Profile supports name/identifier
updates, optional password changes, verification status/resend, and self-deletion.
Administrator management uses a zero-based paginated tope-ui table, row actions,
and confirmation dialogs; deletion requires the exact username. Server permissions
and last-admin protection remain authoritative.

Playwright browser tests are committed with a visual UI command and CI coverage
for development and production. Tests use a disposable migrated database, synthetic
accounts, and MailDev. Unit/backend tests cover validation, permissions, and account
lifecycle rules. Phase 5 replaces the temporary account home with the fuel/charging table as the
post-login destination.

Done when: registration/approval/login and account-management flows pass browser
checks, errors render as Slovak messages, and unauthorized routes/data stay protected.

## Phase 4: Vehicles

Implemented: ownership-scoped vehicle CRUD, paginated listing, Slovak GUI, optional pictures, and confirmed permanent deletion. Manufacturer, model, and a nonempty fuel/energy list are required. License plate, VIN, color, first-registration day, and one picture are optional. First registration uses PostgreSQL DATE. IDs use UUID v7; picture filenames use UUID v4.

Generated fuel types are petrol, diesel, LPG, CNG, and electricity. A hybrid selects multiple types. Future records choose one supported type; money can be combined in the agreed currency, while consumption remains separate by fuel/energy type.

The GUI uses the shared authenticated Header, tope-ui forms, DateTimeInput for the calendar day, and registered FileInput. Sharp normalizes JPEG/PNG/WebP/HEIC to progressive JPEG quality 90, oriented and fitted inside 2048 pixels. Uploads are limited to 10 MiB with a decoded pixel cap. The private filesystem layout is `<root>/<user UUID>/<random UUID v4>.jpg`; reads and writes enforce ownership, including for administrators. HEIC stays selectable for manual testing with real device photos; automated tests use JPEG/PNG/WebP without custom native builds.

Picture staging and deletion retries are durable. Database triggers queue pictures when detached, replaced, or removed by cascades; the background worker retries filesystem failures. HTTP deletions return after database commit without waiting for filesystem cleanup. Metadata saves and binary uploads are separate, with explicit partial-save feedback and retries.

Deleting a vehicle shows its details and an irreversible warning before an explicit Delete button. User-account deletion permanently removes all account-owned vehicles, pictures, and future expenses. Future expense foreign keys must cascade too. No expense models or initial odometer fields were introduced ahead of Phase 5.

Verification covers validation, ownership, zero-based pagination, multiple fuels, image formats and limits, replacement/concurrency/cleanup, account cascades, and development/production GUI flows.

## Phase 5: Refueling and charging

Implemented: FuelRecord schema/migration, owner-scoped list/read/create/update/delete RPCs, authoritative validation, numeric pricing, cached full-to-full consumption, and Slovak GUI. The fuel/charging table is at `/fuel`, with one-vehicle selection (hidden for a single vehicle), fuel filter, server pagination, Add record button, and rightmost edit/delete actions.

Agreed units are kilometres, litres for petrol/diesel/LPG, kg for CNG, and kWh for electricity. Currency is EUR. Clients enter quantity and either paid total or unit price; total price is authoritative, rounded half-up to cents when calculated from a unit price. Effective unit price is derived from the saved total. Quantity/odometer precision is three decimals, unit price six decimals, and money two decimals. Form state, calculations, and RPC values use JavaScript numbers; PostgreSQL NUMERIC columns retain their existing storage precision.

Each vehicle/fuel combination has a separate chronological timeline. Vehicle + fuel type + timestamp is unique; odometer must be strictly above the preceding and below the following reading in that same timeline. Different fuels may share timestamp and odometer. Instants include an explicit offset and normalize to UTC at millisecond precision. GUI inputs use Europe/Bratislava conversion.

Non-EV consumption closes at a full fill-up after a known full baseline. Include intermediate partial purchases and exclude the starting purchase. Missing history invalidates an interval until a fresh full baseline exists. Edits, moves, and deletions recalculate affected old/new timelines within the same transaction, updating only changed caches. Stored interval quantities and distances support weighted consumption in later reporting. EV charging records quantity/costs/flags, with no consumption estimate yet.

All operations enforce ownership independently of role and serialize mutations through the existing owner-row lock. Database uniqueness protects duplicate timestamps; cascades remove fuel records with their vehicle/account. Vehicle fuel types cannot be removed while referenced by fuel history. Tests cover pricing, history edits/gaps, separate fuels, concurrency across sessions, ownership, cascades, validation, and real development/production RPC requests.

The `/fuel/new` and `/fuel/$recordId` forms use registered tope-ui fields, shared Zod rules, numeric inputs, a shared numeric price preview/server calculation, full/missing flags, and confirmed deletion. Time input/display uses Europe/Bratislava regardless of device timezone, preserves unchanged milliseconds, rejects spring gaps, and disambiguates autumn repeated times. No EV consumption estimator is applied.

Phase 6 other expenses/categories are now implemented. Charts and reporting are implemented in Phase 7.

## Phase 6: Other expenses and expense-type codelist

Implemented: owner-scoped categories and other-expense CRUD, migrations, server functions, and Slovak GUI. The Header links to `/expenses`; category management is available only from that page at `/expenses/categories`. The post-login home screen is the welcome/vehicle overview; fuel tracking is at `/fuel`.

Categories belong to one user and are shared across their vehicles. Names are trimmed and unique ignoring case, including archived categories. Users may rename, archive, restore, or delete unused categories. Renaming updates existing history. Archived categories remain in history/filtering; an edited expense may retain its original archived category, but new assignments require an active category. Reference checks, composite foreign keys, and the shared owner-row lock protect deletion and ownership under concurrency.

Expense records require vehicle, category, total EUR price, odometer, and timestamp, with an optional 1,000-character comment. Numeric storage/validation and Bratislava date/time handling reuse established fuel helpers. Repeated odometer/timestamp values and retrospective entries are permitted without timeline ordering or consumption recalculation. Vehicle deletion cascades expenses and retains categories; account deletion cascades both.

The GUI includes vehicle/category filters, server pagination, compact mobile rows, sticky desktop row actions, create/edit forms with registered tope-ui fields, and confirmation dialogs. Category management includes a paginated table, create/rename dialogs, archive/restore actions, and deletion only when unused. Single-vehicle selectors and their labels stay hidden.

Verification includes database constraints, ownership (including administrators), archive/rename/deletion rules, concurrency, numeric amounts, bounded inputs, cascades, and browser/RPC flows in development and production.

## Phase 7: Statistics and charts

Implemented: the authenticated `/statistics` page and owner-scoped `getStatistics` GET RPC, with summaries, date filters, category totals, fuel summaries, and Recharts charts. The Header links to statistics; the single-vehicle selector and its label stay hidden.

Agreed presets are all history, this/last month, this/last year, and inclusive custom calendar-day ranges. Bratislava midnight boundaries become a half-open UTC interval, including DST days. Costs are attributed to event timestamps. Latest recorded odometer uses all history, explicitly labeled, ordered by timestamp across fuel and other expenses with the higher reading for simultaneous events.

Consumption uses stored valid interval quantities/distances whose ending fill-up is in range, including pre-range baseline/partial purchases. Averages are weighted by valid distance, with interval counts and covered kilometres shown. Missing/invalid intervals are excluded rather than estimated. Petrol/diesel/LPG, CNG, and charging units remain distinct; EV reports purchased energy/costs without a consumption estimator.

Charts use pinned Recharts and matching react-is. Summaries server-render; responsive charts load separately in ClientOnly. Stacked cost bars group calendar months, category bars show the top 10 plus a combined remainder, and the category table retains every category. Fuel price and consumption line charts select one fuel type at a time. Unit prices are quantity-weighted. Server aggregation bounds each time series to 120 buckets, coarsening long histories. All values use JavaScript numbers, including summaries, tooltips, and plot coordinates. Statistics ratios remain unrounded until display. A shared exponent-shifting Math.round helper and Slovak Intl formatting replace the decimal-string/BigInt formatters.

Verification covers sums, weighted consumption, pre-range intervals, archived/current category names, ownership, sessions, DST/range boundaries, bounded long histories, SSR summaries, RPC transport, responsive charts/tooltips, and empty/no-vehicle states.

## Phase 8: Compose deployment and operational readiness

Implemented groundwork: a digest-pinned, multi-stage official Node.js 24 Debian slim non-root production image and a tag-triggered Docker Hub publication workflow. It reuses full application checks, verifies the image's non-root/native modules/storage under a read-only root filesystem, and publishes the Git tag plus latest using DOCKER_USER/DOCKER_PASSWORD. Runtime secrets are supplied when starting the image; GitHub Packages access uses a BuildKit secret. Local validation includes the running production image against a disposable PostgreSQL database.

The user manages production deployment. Compose includes an optional application-image example enabled only with the frontend profile, with persistent pictures and separate container database configuration. Default services remain development PostgreSQL and MailDev. Production TLS/proxy/mail configuration, migrations, backups, and recovery are operator responsibilities; do not implement a deployment platform without a new request.

The release also provides a one-shot -migrations Docker image built from the same locked source, CLI, schema, and migrations. The operator runs it before starting/updating the frontend; it is verified against an empty PostgreSQL 18 database and on repeat. Production proxy configuration, mail delivery, backups, recovery, and execution of migrations remain operator-managed; never run development resets against production.

## Phase 9: Service intervals and home reminders (implemented)

Implemented after approval: optional category intervals, authoritative per-vehicle calculations, category form/list fields, home reminders, and preselected expense creation. The recommended defaults below were adopted; no location features are included.

Agreed requirements:

- Add two optional fields to personal expense categories: service interval in kilometres and service interval in whole calendar months. Categories remain shared across all vehicles belonging to their owner.
- Either field may be set independently; both empty means no service schedule. Configured intervals must be positive, with bounded server-validated input.
- Every expense in a category with intervals counts as completed service and restarts that vehicle/category schedule. Schedules are independent per vehicle and category, never shared between vehicles.
- Calculate both limits when configured; whichever is reached first triggers the reminder. Show separate home-page banners for each vehicle/category needing service, using theme warning colors near the limit and danger colors when due/overdue. Multiple reminders can appear together.
- Warn within the final 5% of either configured interval. A due/overdue criterion takes priority over a warning criterion.

Implemented calculation details:

- Use the most recent expense by service occurrence date/time for that vehicle/category as the baseline, not its creation/update timestamp. For simultaneous entries, use the highest odometer, then a stable ID tie-breaker.
- Distance limit = baseline odometer + category kilometre interval. Compare against the latest recorded vehicle mileage across fuel and other expenses, using the existing all-history definition. Do not estimate current mileage or add odometer readings together. Display the mileage observation date; distance reminders may lag real driving until a new record is entered. If readings are inconsistent, avoid invented negative travel and keep the time criterion independent.
- Time limit = baseline service calendar date in Europe/Bratislava + the configured calendar months. Clamp month-end dates to the destination month's last day (for example, 31 January + 1 month is 28/29 February). Compare calendar dates rather than fixed 30-day months or server-local time.
- Distance warning starts at 95% of the kilometre interval. Time warning starts when remaining calendar days are at most 5% of the actual calendar-day span between baseline and due date. Calculate without prematurely rounding thresholds; display remaining whole days. Reaching a limit (not just passing it) uses danger styling and wording such as due today/due now versus overdue.
- If no service record exists, show an informational no-service-history state for that vehicle/category and do not invent a baseline from registration date or account creation. An optional manual baseline is a separate future decision.
- Suppress reminders for archived categories while retaining history. Restoring a category or changing intervals recalculates from existing records. Category settings apply to every owned vehicle with service history in that category; per-vehicle interval overrides are outside the first version.
- One banner per vehicle/category identifies the vehicle and category, last service date/mileage, configured next date/mileage, and the criterion that triggered it. Offer navigation to create the next expense with that vehicle/category selected.
- Derive reminder state on server reads instead of persisting counters or adding a background scheduler. Editing, backdating, moving, or deleting expenses and changing/deleting vehicles/categories must refresh affected home data. Time reminders refresh on a new visit/focus; agree on day-boundary refresh if the app stays open overnight. No email/push reminders in this phase.

Implement as a small slice: category schema/migration and validation -> owner-scoped reminder calculation -> category form fields -> home banners -> focused verification. Cover distance-only/time-only/both, exact 95%/due boundaries, month ends/leap years, different vehicles, absent/inconsistent history, archive/restore, retrospective edits/deletion, and ownership. Do not create schema or application code during planning.

## Phase 10a: Optional GPS capture and location map (implemented)

Agreed first slice: profile setting `storeFuelLocation`, disabled by default; new fuel/charging forms automatically request one high-accuracy browser position when enabled. The browser controls permission. Location failure/denial/timeout never gates saving. Coordinates, accuracy, and capture time are saved only with a newly saved record, and only when the current server-side preference permits it. Capture time is independent of purchase time, including backdated entries; the map lets the user review their current position.

Leaflet loads only in the browser and displays an OpenStreetMap tile map with a draggable mouse/touch marker at the bottom of the form. Existing records show their saved map and never request GPS on edit. Users may explicitly drag an existing pin and save the corrected coordinates; ordinary edits preserve them. Turning the preference off affects future capture, not previously saved locations. Manual corrections work even with automatic capture off, preserve original GPS metadata, and mark the point manually adjusted instead of displaying the original accuracy as its accuracy. Records with no saved location cannot gain a location through editing in this slice. No station-name lookup, continuous tracking, map proxy, or station directory is included. OSM attribution remains visible and tile failure leaves coordinates available without preventing save. Browser map requests go to the public tile provider; no secret API key is used.

The migration adds the profile flag and nullable, validated location columns. Existing records remain without location. Existing owner checks cover location reads/writes, and no precise location data is logged. Station lookup remains a separate decision before implementation.

## Statistics extension: saved places map (implemented)

A single client-only Leaflet.markercluster map at the bottom of Statistics uses the existing selected vehicle/date filters and shows saved GPS records only. Fuel colours and a legend distinguish pins; neutral clusters count nearby records and split with zoom, with overlapping points spreading for selection. Popups show timestamp, quantity, total paid and a record link. Existing owner checks, range boundaries and mutation invalidation apply. No new location capture, named-station lookup, public endpoint, or historical backfill is involved.

## Phase 10b: Station names and nearby lookup (planned; not implemented)

Goal: optionally attach a confirmed station/place name to a fuel/charging record. Location or provider failure must never prevent saving an otherwise valid record. Provider choice and the interaction below remain proposals, not accepted integration decisions.

Recommended first version:

- Always allow a manually entered place name, including private/home charging. Automatic lookup is optional convenience; GPS permission is not required to name a place.
- On a new record, an explicit Use current location action invokes the browser Geolocation API over HTTPS. Request high accuracy, but explain that the browser/OS may return an approximate position. Handle denial, unavailable location, and timeout with the manual fallback. Never continuously track location or request it on ordinary page loads, edits, or merely opening history.
- Current position describes where the user is now, not where an older purchase occurred. Do not automatically overwrite existing locations or attach today's position to backdated records; capturing/confirming a location is deliberate.
- After permission, offer nearby fuel stations or charging locations appropriate to the record's energy type. Show a small bounded set of nearby candidates and let the user confirm one, edit the label, or keep a custom place. The closest candidate must not be silently treated as certain: nearby businesses, motorway directions, and GPS accuracy can make it wrong.
- If retaining coordinates is agreed, store optional latitude/longitude as a validated pair, plus capture time and reported accuracy. Validate finite ranges, bounded text and request sizes, and ownership independently of the client. Coordinates, browser-captured time, provider identifiers, and purchase time have different meanings. Do not send precise positions to logs, analytics, emails, or other users. The chosen lookup provider receives the queried location; disclose this beside the optional action.
- A provider lookup is authenticated and bounded, uses a fixed configured provider URL, a short timeout, limited search radius/result count, and only required fields. Keep secret keys on the server; never build an arbitrary URL-fetch endpoint or put server credentials in client bundles. All manual names remain untrusted text rendered safely.
- Store a human-confirmed label for display in detail/history, and provider/source metadata only where allowed. Preserve historical station identity when a business later changes its name. Check provider storage/caching terms before deciding which returned fields may be retained. A free request quota does not imply unrestricted permanent storage rights.
- Reuse existing forms, result contracts, i18next, and responsive rows. An embedded interactive map, a station directory, continuous tracking, background lookups, routes, and automatic historical backfilling are outside the first version.

Provider options to decide before implementation:

| Option | Benefits | Constraints |
| --- | --- | --- |
| Manual place name only | No external API, no billing, works for home charging and older records | User types the name; no automatic suggestions |
| OpenStreetMap POIs through an Overpass service | Open map data; public community endpoints generally need no API key or per-request payment | Coverage/names vary; each endpoint has its own fair-use and availability policy, no production SLA; attribution/licensing obligations apply |
| Google Places Nearby Search | Nearby business names and station/charger POIs | API key and billing setup are normally required; usage is metered with SKU-specific free allowances, not an unlimited free service; storage/display terms must fit the saved-record use case |

OpenStreetMap lookup would search nearby `amenity=fuel` and `amenity=charging_station` features, including nodes/ways/relations where relevant. Missing names or incomplete coverage must fall back to manual entry. Reverse geocoding an address alone does not identify which station was visited. Google's Geocoding API likewise is not a substitute for Places POI search.

For this small family app, the recommended starting point is manual entry plus optional OpenStreetMap nearby suggestions with confirmation. Confirm the chosen endpoint's policy and data-retention/attribution requirements before integrating it. If choosing Google, verify current official pricing/free allowances and configure quotas; budget alerts alone do not cap spending. Live Google pricing could not be verified from the current environment (network policy blocked the documentation host), so no numeric quota or price is assumed here.

Reference documentation to verify when implementing:

- Browser Geolocation: https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API
- Google Places Nearby Search: https://developers.google.com/maps/documentation/places/web-service/nearby-search
- Google Maps pricing: https://developers.google.com/maps/billing-and-pricing/pricing
- Google Places policies: https://developers.google.com/maps/documentation/places/web-service/policies
- OpenStreetMap Overpass: https://wiki.openstreetmap.org/wiki/Overpass_API
- OpenStreetMap attribution/licensing: https://www.openstreetmap.org/copyright

Open decisions: provider/endpoint; whether raw coordinates should be retained or only used to suggest a name; whether remembered GPS consent should offer a repeat action (browser permission still controls access); and exact category reminder behavior for missing history/archive and threshold rounding described above. Resolve these before implementing their affected slice.

## Questions to resolve when their phase begins

- Foundation: Prisma generation, migration deployment, model tests, and schema consistency checks are verified. Continue with the next agreed authentication server step.
- Authentication workflow: first registration is an active administrator; later registrations require approval. The last active administrator cannot be blocked/deleted/demoted through application operations. Typed-username deletion confirmation and regular-user self-only deletion are agreed and implemented. Verified-email password recovery is implemented; operator recovery for ineligible accounts remains to be designed.
- Accounts: deletion permanently removes all owned vehicles, pictures, and future expenses. Email verification is implemented; forgotten-password reset is implemented for ACTIVE accounts with a verified current address.
- UI: Slovak with react-i18next, the published tope-ui package, shared authenticated Header, left-aligned public forms, and responsive Grid/Column layout are implemented. Validate future vehicle/expense screens against those conventions.
- Fuel records: EUR, km, litres/kg/kWh, decimal precision, and independent timeline corrections are agreed and implemented in the backend. The combined home table and forms are implemented.
- Expense types: personal across owned vehicles; case-insensitive unique names, rename/archive/restore, delete only when unused are agreed and implemented.
- Reporting: one vehicle, EUR, Bratislava ranges, ending-fill-up interval attribution, weighted averages, Recharts, and incomplete-history explanations are agreed and implemented. Cross-vehicle reports remain outside the agreed scope.

Phases 5–7 backend and GUI are implemented. The requested Phase 8 image/workflow and optional Compose example are prepared; production deployment is managed by the user. Agree on the next product step before further implementation. EV consumption remains deferred. Phase 3 uses the verified tope-ui APIs, TanStack Form/Query, Zod, and react-i18next. Operator recovery for accounts without a usable verified email and handling older unpeppered hashes remain explicit follow-up decisions.

## Profile and email-verification step

Implemented authenticated own-profile updates with optional atomic password changes,
current-password proof for sensitive changes, identifier uniqueness, and session
rotation/revocation. SMTP delivery uses Nodemailer and Handlebars; MailDev captures
local messages. Email verification is single-use and expires after 24 hours, is
reset by an address change, and never gates normal login or approves registrations.
A minimal Slovak i18next confirmation page completes the email-link flow. Profile/authentication forms are implemented in Phase 3.

Forgotten-password recovery is implemented: username/email requests, generic accepted
responses, background SMTP delivery, one-hour hashed single-use tokens,
proxy-managed traffic limits and atomic password reset/session
revocation. Tokens are invalidated by replacement and relevant account changes.
The Slovak request/reset pages use tope-ui `useAppForm` with registered inputs/submit buttons and shared Zod validation.
Only ACTIVE accounts with verified current email are eligible. Reset never logs in
or bypasses approval. A durable email queue remains separate deployment work.

## tope-ui integration

The recovery forms use the published `@tfilo/tope-ui@0.3.6` package and its
TanStack Form peer dependency, pinned in package.json and package-lock.json.
The temporary source build is no longer needed. GitHub Packages access uses
the secure NODE_AUTH_TOKEN binding, with registry and artifact download hosts
allowed by the cloud network policy.

Version 0.3.6 is installed from GitHub Packages with lockfile integrity checks.
TypeScript, lint, formatting, production build, and Chromium flows in development
and production verify its forms, clickable vehicle cards, and Page header back navigation.
