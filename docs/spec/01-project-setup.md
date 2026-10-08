# 01 — Project Setup (M1)

## 1. Requirements

- macOS (primary target). Linux works for development/tests except HEIC conversion and Keychain.
- Node.js **22 LTS or newer** (`"engines": { "node": ">=22" }`).
- npm (bundled with Node). No pnpm/yarn.
- Google Chrome installed (recommended; Playwright uses it via `channel: "chrome"`). Fallback: Playwright's bundled Chromium.

## 2. Directory layout

Create exactly this structure (files are created over the milestones; folders marked † are gitignored and created at runtime):

```text
crosslister/
├── CLAUDE.md
├── README.md
├── IMPLEMENTATION_SUMMARY.md          (M39)
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── drizzle.config.ts
├── .env.example
├── .gitignore
├── .github/workflows/ci.yml
├── docs/
│   ├── MARKETPLACE_RESEARCH.md
│   ├── ARCHITECTURE.md
│   ├── MARKETPLACE_ADAPTERS.md
│   ├── SETUP.md
│   ├── TROUBLESHOOTING.md
│   └── spec/…
├── drizzle/                            (generated migrations, committed)
├── fixtures/
│   └── marketplace-pages/<marketplace>/*.html
├── src/
│   ├── shared/
│   │   ├── constants.ts
│   │   ├── types.ts
│   │   ├── schemas.ts
│   │   ├── taxonomy.ts
│   │   ├── colors.ts
│   │   ├── sizes.ts
│   │   ├── money.ts
│   │   └── text.ts
│   ├── server/
│   │   ├── index.ts                    (entry: loads config, builds app, listens)
│   │   ├── app.ts                      (buildApp(): FastifyInstance — used by tests)
│   │   ├── config.ts
│   │   ├── paths.ts
│   │   ├── errors.ts
│   │   ├── db/
│   │   │   ├── schema.ts
│   │   │   ├── client.ts
│   │   │   └── migrate.ts
│   │   ├── services/
│   │   │   ├── logger.ts
│   │   │   ├── events.ts
│   │   │   ├── settings.ts
│   │   │   ├── listings.ts
│   │   │   ├── listingStatus.ts
│   │   │   ├── photos.ts
│   │   │   ├── imageProcessing.ts
│   │   │   ├── validation.ts
│   │   │   ├── effectiveListing.ts
│   │   │   ├── marketplaceListings.ts
│   │   │   ├── jobs.ts
│   │   │   ├── jobRunner.ts
│   │   │   ├── jobContext.ts
│   │   │   ├── secrets.ts
│   │   │   ├── exporter.ts
│   │   │   ├── backup.ts
│   │   │   └── notify.ts
│   │   ├── routes/
│   │   │   ├── health.ts
│   │   │   ├── settings.ts
│   │   │   ├── listings.ts
│   │   │   ├── photos.ts
│   │   │   ├── marketplaces.ts
│   │   │   ├── jobs.ts
│   │   │   ├── events.ts
│   │   │   ├── logs.ts
│   │   │   ├── export.ts
│   │   │   ├── import.ts               (Phase 4)
│   │   │   └── ai.ts                   (Phase 6)
│   │   ├── browser/
│   │   │   ├── browserManager.ts
│   │   │   ├── locators.ts
│   │   │   ├── actions.ts
│   │   │   ├── match.ts
│   │   │   └── extract.ts              (Phase 4)
│   │   ├── marketplaces/
│   │   │   ├── types.ts
│   │   │   ├── registry.ts
│   │   │   ├── common.ts
│   │   │   ├── manual/index.ts
│   │   │   ├── mercari/{index,mapping,selectors}.ts
│   │   │   ├── poshmark/{index,mapping,selectors}.ts
│   │   │   ├── depop/{index,mapping,selectors}.ts
│   │   │   ├── facebook/{index,mapping,selectors}.ts
│   │   │   ├── grailed/{index,mapping,selectors}.ts
│   │   │   └── ebay/{index,mapping,auth,trading,rest,xml}.ts
│   │   ├── importers/                  (Phase 4)
│   │   │   ├── pipeline.ts
│   │   │   ├── duplicates.ts
│   │   │   ├── hash.ts
│   │   │   └── reverseMapping.ts
│   │   ├── ai/                         (Phase 6)
│   │   │   ├── provider.ts
│   │   │   ├── ollama.ts
│   │   │   ├── openaiCompatible.ts
│   │   │   ├── anthropic.ts
│   │   │   └── prompts.ts
│   │   └── scripts/
│   │       ├── calibrate.ts
│   │       └── fixtureServer.ts
│   └── web/
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       ├── styles.css
│       ├── api/{client,hooks,events}.ts
│       ├── lib/{format,keyboard}.ts
│       ├── components/…
│       └── pages/…
├── tests/
│   ├── helpers/{testApp,fixtures}.ts
│   ├── shared/…
│   ├── listings/…
│   ├── photos/…
│   ├── validation/…
│   ├── jobs/…
│   ├── export/…
│   ├── import/…
│   ├── marketplace/{manual,mercari,poshmark,depop,facebook,ebay,grailed}/…
│   └── browser/…                       (Playwright fixture tests; opt-in)
├── data/ †              (crosslister.db, listings/, backups/, screenshots/, imports/, secrets/)
├── browser-profiles/ †  (<marketplace>/)
└── logs/ †
```

## 3. Install dependencies

Run these exact commands (latest versions within these majors; commit the lockfile):

```bash
npm init -y
npm install fastify@^5 @fastify/multipart @fastify/static \
  better-sqlite3 drizzle-orm zod nanoid sharp playwright \
  archiver fast-xml-parser node-html-parser dotenv
npm install react@^19 react-dom@^19 react-router@^7 @tanstack/react-query@^5 \
  lucide-react sonner react-dropzone react-easy-crop \
  @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities clsx
npm install -D typescript tsx vite @vitejs/plugin-react tailwindcss@^4 @tailwindcss/vite \
  drizzle-kit vitest concurrently \
  @types/node @types/react @types/react-dom @types/better-sqlite3 @types/archiver
```

Do **not** install `playwright-extra`, stealth plugins, CAPTCHA services, `puppeteer`, `axios` (use `fetch`), `express`, `prisma`, `keytar`, `moment`/`dayjs` (use `Date` + `Intl`).

Playwright browsers: the app uses installed Chrome by default. For tests and the Chromium fallback, run `npx playwright install chromium` (document in SETUP.md).

## 4. `package.json`

Set these fields (keep the dependency versions npm wrote):

```json
{
  "name": "crosslister",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "concurrently -k -n server,web -c blue,magenta \"npm:dev:server\" \"npm:dev:web\"",
    "dev:server": "tsx watch --clear-screen=false src/server/index.ts",
    "dev:web": "vite",
    "build": "vite build",
    "start": "NODE_ENV=production tsx src/server/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:browser": "RUN_BROWSER_TESTS=1 vitest run tests/browser",
    "db:generate": "drizzle-kit generate",
    "calibrate": "tsx src/server/scripts/calibrate.ts",
    "fixtures": "tsx src/server/scripts/fixtureServer.ts"
  }
}
```

## 5. `tsconfig.json`

Single config for server, web and tests. Use **relative imports only** (no path aliases).

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "allowImportingTsExtensions": false,
    "types": ["node", "vite/client"]
  },
  "include": ["src", "tests", "vite.config.ts", "vitest.config.ts", "drizzle.config.ts"]
}
```

Import specifiers omit extensions (`import { x } from './foo'`); both `tsx` and Vite resolve them.

## 6. `vite.config.ts`

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'src/web',
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4317', changeOrigin: false },
    },
  },
  build: { outDir: '../../dist/web', emptyOutDir: true },
});
```

`changeOrigin: false` keeps the browser's `Host: 127.0.0.1:5173` / `localhost:5173` header, which the server's allow-list accepts (03 §3). Note the SSE endpoint also goes through this proxy; it works with Vite's proxy as long as the server flushes headers immediately (03 §6).

## 7. `vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 30_000,
    pool: 'forks',
  },
});
```

## 8. `drizzle.config.ts`

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/server/db/schema.ts',
  out: './drizzle',
});
```

## 9. `.gitignore`

```gitignore
node_modules/
dist/
data/
browser-profiles/
logs/
*.log
.env
.env.*
!.env.example
.DS_Store
coverage/
playwright-report/
test-results/
*.sqlite
*.db
*.db-journal
*.db-wal
*.db-shm
```

## 10. `.env.example`

```dotenv
# Copy to .env and fill in only what you use. Never commit .env.

# Server
PORT=4317
# Where the database, photos, backups live (default ./data)
CROSSLISTER_DATA_DIR=./data
# Where persistent browser profiles live (default ./browser-profiles)
CROSSLISTER_PROFILES_DIR=./browser-profiles

# eBay (optional — see docs/SETUP.md "Connect eBay")
EBAY_ENV=production            # production | sandbox
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=
EBAY_RUNAME=

# AI (optional — local Ollama needs no key)
ANTHROPIC_API_KEY=
OPENAI_COMPATIBLE_API_KEY=
```

## 11. `CLAUDE.md` (repo root)

Already present in the repo (written with this spec). Keep it; update only the "Current milestone" line as you progress.

## 12. CI (`.github/workflows/ci.yml`)

```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npx playwright install --with-deps chromium
      - run: npm run test:browser
```

## 13. M1 placeholder content

- `src/server/index.ts`: per 03 §1 (can start minimal: buildApp + health route).
- `src/web/index.html`: `<div id="root"></div>` + `<script type="module" src="/main.tsx"></script>`, `<title>Crosslister</title>`.
- `src/web/main.tsx`: renders `<App />` into `#root`.
- `src/web/styles.css`: `@import "tailwindcss";`
- `tests/shared/smoke.test.ts`: `expect(1 + 1).toBe(2)`.
