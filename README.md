# car-log (Tankovanie)

Car-log is a personal and family vehicle expense tracker with a Slovak user interface. It records refueling, EV charging, maintenance, and other vehicle costs, with statistics and service reminders. The application is developed with AI assistance.

## For developers

### npm scripts

Run scripts with `npm run <script>` from the repository root.

| Script                | Description                                      |
| --------------------- | ------------------------------------------------ |
| `dev`                 | Generate Prisma client; start development server |
| `build`               | Generate Prisma client; build application        |
| `start`               | Start production build                           |
| `lint`                | Check ESLint rules                               |
| `lint:fix`            | Fix ESLint issues                                |
| `prettier`            | Check source formatting                          |
| `prettier:fix`        | Format source files                              |
| `prepare`             | Configure Husky hooks                            |
| `db:generate`         | Generate Prisma client                           |
| `db:validate`         | Validate Prisma schema                           |
| `db:migrate`          | Create/apply development migrations              |
| `db:deploy`           | Apply committed migrations                       |
| `test:db`             | Run Vitest tests                                 |
| `test:e2e`            | Run development browser tests                    |
| `test:e2e:ui`         | Open Playwright test UI                          |
| `test:e2e:production` | Build; run production browser tests              |

### Main technologies

- **Application:** TypeScript, React, TanStack Start/Router, Vite, and Nitro.
- **Data and forms:** TanStack Query, TanStack Form, and Zod.
- **Database:** PostgreSQL 18 and Prisma with the PostgreSQL adapter.
- **Interface:** `@tfilo/tope-ui`, Tailwind CSS, and i18next; Slovak translations, English source and documentation.
- **Charts and maps:** Recharts, Leaflet, Leaflet.markercluster, and OpenStreetMap tiles.
- **Server utilities:** Node.js native Argon2id, Sharp images, Nodemailer/Handlebars email, and CSV/ZIP libraries.
- **Tooling:** Vitest, Playwright, ESLint, Prettier, Docker Compose, and GitHub Actions.

### Environment variables

Copy [.env.example](.env.example) to an ignored `.env`. The examples below are development values or placeholders, not production credentials. Server secrets must never use a `VITE_` prefix.

**Dev** covers local development, testing, and the optional development Compose frontend. **Prod** covers variables consumed by the final application Docker image. `yes` means applicable, not necessarily mandatory: optional settings and image defaults are noted in the description. Compose-only settings are not application-container variables; Docker Hub CI secrets are marked `no` in both columns.

| Variable                         | Example value                                               | Dev | Prod | Description                                                                                |
| -------------------------------- | ----------------------------------------------------------- | --- | ---- | ------------------------------------------------------------------------------------------ |
| `POSTGRES_DB`                    | `car_log`                                                   | yes | no   | Compose database name                                                                      |
| `POSTGRES_USER`                  | `car_log`                                                   | yes | no   | Compose database user                                                                      |
| `POSTGRES_PASSWORD`              | `replace-with-local-password`                               | yes | no   | Initial Compose database password                                                          |
| `POSTGRES_PORT`                  | `5432`                                                      | yes | no   | Host PostgreSQL port                                                                       |
| `DATABASE_URL`                   | `postgresql://car_log:YOUR_PASSWORD@127.0.0.1:5432/car_log` | yes | yes  | Application/Prisma connection; URL-encode credentials; use the database hostname in Docker |
| `DISABLE_REGISTRATION`           | `false`                                                     | yes | yes  | `true` blocks all new registrations, including first admin                                 |
| `PASSWORD_PEPPER`                | `<64 random hexadecimal characters>`                        | yes | yes  | Required server-only password secret; preserve across deployments                          |
| `ARGON2_MEMORY`                  | `65536`                                                     | yes | yes  | Hash memory in KiB; supported: 19456–262144                                                |
| `ARGON2_PASSES`                  | `3`                                                         | yes | yes  | Hash passes; supported: 2–10                                                               |
| `ARGON2_PARALLELISM`             | `1`                                                         | yes | yes  | Hash parallelism; supported: 1–4                                                           |
| `APP_URL`                        | `http://localhost:3000`                                     | yes | yes  | Trusted browser origin and email-link base; HTTPS in production                            |
| `SMTP_HOST`                      | `127.0.0.1`                                                 | yes | yes  | SMTP host; use `maildev` from the Compose frontend                                         |
| `SMTP_PORT`                      | `1025`                                                      | yes | yes  | SMTP port; commonly 587/465 in production                                                  |
| `SMTP_SECURE`                    | `false`                                                     | yes | yes  | `true` enables implicit TLS, normally port 465                                             |
| `SMTP_USER`                      | `smtp-user`                                                 | yes | yes  | Optional SMTP username; leave blank for MailDev                                            |
| `SMTP_PASSWORD`                  | `<SMTP password>`                                           | yes | yes  | Optional SMTP password; pair with username                                                 |
| `MAIL_FROM`                      | `no-reply@example.test`                                     | yes | yes  | Sender address                                                                             |
| `VEHICLE_IMAGE_DIR`              | `.data/vehicle-images`                                      | yes | yes  | Private pictures/exports; Docker image default: /data/vehicle-images                       |
| `FRONTEND_IMAGE`                 | `tfilo/car-log:latest`                                      | yes | no   | Optional Compose application image                                                         |
| `FRONTEND_PORT`                  | `3000`                                                      | yes | no   | Optional Compose application host port                                                     |
| `FRONTEND_DATABASE_URL`          | `postgresql://car_log:YOUR_PASSWORD@postgres:5432/car_log`  | yes | no   | Compose application connection; overrides its `DATABASE_URL`                               |
| `NODE_AUTH_TOKEN`                | `<GitHub token with read:packages>`                         | yes | no   | Install private tope-ui package; Docker builds use a BuildKit secret                       |
| `NODE_ENV`                       | `production`                                                | no  | yes  | Runtime mode; Docker image already sets production                                         |
| `HOST`                           | `0.0.0.0`                                                   | no  | yes  | Server bind address; Docker image default: 0.0.0.0                                         |
| `PORT`                           | `3000`                                                      | no  | yes  | Server port; Docker image default: 3000                                                    |
| `E2E_PORT`                       | `4370`                                                      | yes | no   | Browser-test application port                                                              |
| `E2E_PRODUCTION`                 | `true`                                                      | yes | no   | Test the existing production build                                                         |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | `/usr/bin/chromium`                                         | yes | no   | Optional existing Chromium executable                                                      |
| `DOCKER_USER`                    | `example-account`                                           | no  | no   | GitHub Actions secret: Docker Hub account                                                  |
| `DOCKER_PASSWORD`                | `<Docker Hub access token>`                                 | no  | no   | GitHub Actions secret: Docker Hub publication credential                                   |

Generate a pepper with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and set `PASSWORD_PEPPER` locally. Keep a secure backup: changing or losing it prevents existing password hashes from being verified.

### Development with Compose

Requirements: **Node.js 24.7+** (Node 24 in CI), npm, and Docker Compose v2. The usual setup runs PostgreSQL and MailDev in containers, and the application on the host.

1. Copy `.env.example` to `.env` without overwriting existing settings: `cp -n .env.example .env`.
2. Set `POSTGRES_PASSWORD`, update `DATABASE_URL` to match, and generate `PASSWORD_PEPPER`. Set `NODE_AUTH_TOKEN` in your shell for access to the private `@tfilo/tope-ui` package on GitHub Packages.
3. Start the services and application:

    ```sh
    docker compose up -d --wait postgres maildev
    npm ci
    npm run db:deploy
    npm run dev
    ```

The app is at **http://localhost:3000** and the captured email inbox at **http://localhost:1080**. MailDev uses SMTP port 1025 without credentials. Match `APP_URL` to the address used in your browser. The `dev` and `build` scripts generate the Prisma client automatically.

Useful Compose commands:

```sh
docker compose ps
docker compose logs --tail=100 postgres
docker compose stop
docker compose down
```

`postgres_data` retains the database across container recreation. `down` preserves volumes; adding `--volumes` deletes their data. The `POSTGRES_*` initialization settings apply only to an empty database volume. PostgreSQL's published port is restricted to loopback; change `POSTGRES_PORT` and `DATABASE_URL` together if needed.

For schema changes, use `npm run db:migrate -- --name describe_the_change` and commit the migration with the schema. Use `db:deploy` to apply committed migrations in deployments. Generate the client with `db:generate` before standalone TypeScript checks or tests.

Before browser tests, run `npx playwright install chromium`. Integration/browser tests use PostgreSQL and synthetic fixtures; suites that create disposable databases require database-creation permission. They do not reset the development database. Browser email tests also require MailDev. Test reports are written to `playwright-report/` and `test-results/`.

The optional `frontend` Compose profile runs a published application image:

```sh
docker compose --profile frontend up -d frontend
```

Set `FRONTEND_IMAGE` and `FRONTEND_DATABASE_URL` first, and apply that release's migrations before starting it. Use `SMTP_HOST=maildev` for container-to-container development email. The application image runs as a non-root user and stores pictures/exports in the persistent `vehicle_images` volume at `/data/vehicle-images`; back up that volume together with PostgreSQL. View server logs with `docker compose --profile frontend logs -f frontend` or Portainer's container Logs view.

For production, use HTTPS through Traefik, a real SMTP provider, and persistent database/image storage. Keep the application port private. The reverse proxy must allow the larger import request body (ZIP uploads are Base64-encoded in JSON). Run the release's `-migrations` image once before updating the application; migrations do not run automatically on startup. Background exports assume a single application instance; interrupted exports can be retried after restart.

### Pipeline

- [build.yml](.github/workflows/build.yml): every branch push installs locked dependencies, generates Prisma, applies migrations, checks lint/formatting/types, runs Vitest, builds, and runs Playwright against development and production. PostgreSQL and MailDev are CI services; browser reports are uploaded as artifacts.
- [docker.yml](.github/workflows/docker.yml): every pushed Git tag runs the same checks, builds Linux amd64 application and migration images, verifies repeatable migrations and the non-root runtime, then publishes to Docker Hub. Tags are `<git-tag>`, `latest`, `<git-tag>-migrations`, and `latest-migrations`; prerelease tags also update `latest`.

CI uses `GITHUB_TOKEN` with `packages: read` for tope-ui; the package must grant this repository access. Docker publication requires `DOCKER_USER` and `DOCKER_PASSWORD` secrets. Package credentials enter Docker builds only through the `NODE_AUTH_TOKEN` BuildKit secret.

### Naming conventions

| Item                      | Convention                           | Short example                     |
| ------------------------- | ------------------------------------ | --------------------------------- |
| Files                     | Lowercase kebab-case                 | `fuel-form.tsx`                   |
| Server-only modules       | `.server.ts` suffix                  | `fuel.server.ts`                  |
| Type-only modules         | `.types.ts` suffix                   | `vehicle.types.ts`                |
| Validation schemas        | `*-schema.ts`                        | `vehicle-schema.ts`               |
| Query options             | `*-queries.ts`                       | `vehicle-queries.ts`              |
| Error codes/helpers       | `*-errors.ts`                        | `fuel-errors.ts`                  |
| React components/types    | PascalCase                           | `VehicleForm`, `SessionUser`      |
| Functions/variables       | camelCase                            | `createOwnedVehicle`, `vehicleId` |
| Finite application values | PascalCase object; uppercase members | `ResultKind.CREATED`              |
| Database models           | Singular PascalCase                  | `Vehicle`, `FuelRecord`           |
| Environment variables     | UPPER_SNAKE_CASE                     | `APP_URL`                         |
| Migrations                | Timestamp plus snake_case            | `20261114210000_data_transfer`    |
| Unit/integration tests    | `*.test.ts`                          | `vehicles.test.ts`                |
| Browser tests             | `*.spec.ts`                          | `vehicles.spec.ts`                |

Route files follow TanStack Router conventions, for example `_authenticated` for a layout and `$vehicleId` for a parameter. Source identifiers and documentation are English; Slovak user-facing text belongs in `src/i18n/locales/sk/`. Use the generated Prisma enums for roles, statuses, and fuel types.

See [AGENTS.md](AGENTS.md) for implementation rules and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for development phases.

## Application features

The interface uses Slovak, prices are in euros, distances in kilometres, liquid fuel in litres, and charging energy in kWh. Dates and times use Europe/Bratislava. Each account manages its own records; administrator access to user management does not grant access to another user's vehicles, expenses, or exports. Lists adapt to mobile screens and support pagination.

### Home (Domov)

See your vehicles and open their details or statistics. Service reminders show maintenance that is approaching or overdue based on category intervals and the latest recorded mileage. A reminder opens a new expense with the vehicle and category selected. Missing service history is shown explicitly; reminders do not estimate unrecorded driving or send emails.

### Refueling and charging (Palivo)

Add, edit, or delete purchases for a selected vehicle and fuel type: petrol, diesel, LPG, CNG, or electricity. Record the purchase date/time, odometer, quantity, and either total price or unit price. Mark full tanks/charges and missing preceding records. Filter history by vehicle and fuel; opening a record lets you edit it, and saving returns to the previous list filters/page.

Liquid-fuel consumption is calculated separately for each fuel from valid full-to-full intervals, including intermediate partial fills. Missing records interrupt the calculation. EV records show purchased energy and costs; electricity consumption is not estimated from charging flags.

If location capture is enabled in Profile, a new record requests one browser position. Permission denial or a timeout does not prevent saving. Saved locations appear on a map, and you can drag an existing pin to correct it before saving. Editing never captures a new position automatically. Maps load OpenStreetMap tiles, disclosing the viewed map area and request information to that provider.

### Other expenses and categories (Ostatné výdavky)

Record maintenance, repairs, insurance, and other costs with a vehicle, category, amount, odometer, date/time, and optional comment. Filter the list by vehicle/category, edit or delete records, and return to the previous list position after saving.

Create and rename categories shared across your vehicles. Archive categories to stop using them for new expenses while preserving history; restore them when needed. Categories can be deleted only when no expense uses them.

Optional service intervals use kilometres, calendar months, or both. Each expense starts a new interval for its vehicle/category; whichever limit is reached first determines when service is due. Home warns within the final 5% of an interval and marks reached limits overdue. Archived categories produce no reminders.

### Statistics (Štatistiky)

Choose a vehicle and all history, this/last month, this/last year, or a custom date range. View fuel/charging costs, other expenses, combined totals, category totals, purchased quantities, weighted fuel prices, and valid liquid-fuel consumption. The latest odometer reading comes from the complete history and is labelled with its observation date.

Charts show costs over time, category comparisons, fuel prices, and consumption. A map displays saved refueling/charging locations for the selected period, with clusters, fuel colours, and links back to records. Opening statistics does not request your current GPS position.

### Vehicles (Vozidlá)

Manage multiple vehicles with manufacturer, model, and one or more supported fuel/energy types. Optionally add a license plate, VIN, colour, first-registration date, and picture. JPEG, PNG, WebP, and HEIC uploads are offered, with a 10 MiB input limit; HEIC decoding depends on server codec support. Pictures remain private. Deleting a vehicle also deletes its fuel and other expense records after confirmation.

### Users (Používatelia; administrators only)

Administrators can list accounts, approve pending registrations, block/unblock users, change roles, and delete accounts. Blocking or deleting an account revokes its sessions. Deletion requires the exact username as confirmation. The last active administrator cannot be blocked, deleted, or demoted.

### Profile (Profil)

Update your optional name, username, email, and password. Changes to username, email, or password require the current password and sign out other sessions. Verify your email or resend the verification message; changing the email requires verification again. Verification links expire after 24 hours.

Enable optional location capture for new fuel/charging records. It is off by default and does not continuously track you. Disabling it leaves previously saved locations intact.

**Export:** select **Exportovať** to prepare a ZIP in the background. The button is disabled while it runs; a download link appears when ready. The ZIP contains separate CSVs for vehicles, categories, fuel records, and other expenses, plus binary vehicle pictures. Recorded prices, quantities, odometers, coordinates, comments, and service intervals are included; profile data and calculated consumption caches are excluded. Downloads require your session and expire after 72 hours. A new export replaces the previous file.

**Import:** upload a ZIP in the application's export format. Import is available only when your account has no vehicles, records, or categories; deleting all those items enables it again. The limit is 100 MiB for both the ZIP and unpacked contents. Import assigns fresh IDs, recalculates consumption, and restores all records together or none. The last successful import time or failure reason appears below the button and survives reloads. Restoring saved coordinates does not require enabling future location capture.

You can also permanently delete your account and its associated data by confirming your username, subject to the last-administrator rule.

### Login, password reset, and registration

Sign in with your username or email and password. Only active accounts can sign in. A login session lasts 14 days from its last renewal and is renewed during use; logout ends the current session. Merely opening the login page does not create a session cookie.

Registration requires a unique email, a username of 3–30 lowercase ASCII letters/digits, and a password of 10–128 supported ASCII characters with a lowercase letter, uppercase letter, and digit, without spaces. First/last names are optional. The first registered account becomes an active administrator; subsequent accounts require administrator approval. Registration does not sign you in, and email verification does not replace approval. Operators can disable registration entirely.

For a forgotten password, request a reset link using your username or email. Only active accounts with a verified current email can receive it. The confirmation message is deliberately generic to avoid revealing whether an account exists. Reset links are single-use, expire after one hour, and are replaced by newer requests. A successful reset signs out existing sessions; then sign in with the new password.
