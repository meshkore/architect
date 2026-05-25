# MeshKore Architect

The cluster cockpit. Chat-driven, repo-as-database UI. Talks **only**
to the local `meshcore` daemon at `http://localhost:5570` — there is
no backend in the cloud.

## Why it lives in its own module

Until 2026-05-12 the architect was nested inside `webapp/reference/cluster/architect/`,
deployed as part of `meshkore-web`. That meant:

- Every webapp change re-deployed the architect, and vice versa.
- The single HTML (~7k lines) was tangled with public-site routing.
- `meshkore.com/architect` looked like a public page; it isn't.

The architect is a different beast:

- It is a **client of the daemon**, not of any cloud API.
- It is **operator-only** — no SEO, no sitemap, no indexable content.
- It must deploy independently so a architect bugfix doesn't ship a
  half-built directory, and a directory hotfix doesn't break the
  cockpit.

So it now lives at the project root as a peer of `api/`, `daemon/`,
`webapp/`, `worker/`.

## Deployment

| Item | Value |
|---|---|
| Production URL | <https://architect.meshkore.com> |
| Cloudflare Pages project | `meshkore-portal` |
| Account | `875bd2c5943a18d6c520d894ed12905f` (rjj@proars.com) |
| Build output | `dist/` (`vite build`) |
| DNS | CNAME `architect` → `meshkore-portal.pages.dev` |

### Deploy

```bash
cd architect
npm run deploy:prod        # vite build && wrangler pages deploy dist
```

The `deploy:prod` script is the canonical path (see `package.json`).
Previous deployments remain in the CF Pages dashboard; roll back with
`npx wrangler pages deployment rollback <deployment-id>
--project-name meshkore-portal`.

## Local development

```bash
cd architect
npm install
npm run dev           # Vite dev server on http://localhost:4173
```

Then in another terminal, run the daemon from any MeshKore repo:

```bash
python3 .meshkore/scripts/daemon.py
# binds the first free port in 5570–5589
```

The architect will detect the daemon and load state.

## Quality gates (M0.4)

Three commands you should run before pushing:

```bash
npm run typecheck     # tsc --noEmit, strict mode
npm run lint          # eslint . (flat config)
npm run check         # both, in sequence
```

### TypeScript strictness

`tsconfig.json` enables (beyond `strict: true`):

- `noImplicitAny`
- `noUncheckedIndexedAccess`
- `noUnusedLocals`
- `noUnusedParameters`
- `noImplicitOverride`
- `noFallthroughCasesInSwitch`

### ESLint rules

`eslint.config.js` (flat config) is intentionally minimal. The rules
that matter:

- `eqeqeq` — always `===` / `!==`.
- `no-console` — `warn` only for `console.log`/`debug`; `warn`/`error`
  always allowed. The wrapper in `src/lib/log.ts` is exempt — it's the
  abstraction everyone else should call.
- `prefer-const` — error.
- `no-empty` — warn (except `catch {}`).
- `@typescript-eslint/no-explicit-any` — warn (audit-§4 lean code).

TypeScript handles undeclared/unused; ESLint focuses on stylistic
patterns tsc doesn't catch.

### Build

```bash
npm run build         # vite build → dist/, includes dist/health.json
```

`dist/health.json` is generated at build time via the
`healthJsonPlugin` in `vite.config.ts` and exposes
`{name, version, commit, built_at}` (M0.2).

## Structure

```
architect/
├── src/                 ← Solid + TypeScript source
│   ├── components/      ← Header, ChatPanel, Modals, Wizards, zone panels…
│   ├── state/           ← signal/store layer (server, ui, chat, daemon, projects)
│   ├── lib/             ← log, http, ws, agent-types, version, cdn-loaders…
│   └── App.tsx + main.tsx
├── public/              ← static assets copied verbatim into dist/
│   ├── _headers         ← CF Pages security + cache headers
│   └── _redirects       ← SPA fallback (/*  /index.html  200)
├── index.html           ← Vite entry; loads src/main.tsx
├── vite.config.ts       ← Solid plugin + healthJsonPlugin (M0.2)
├── tailwind.config.js
├── package.json
├── wrangler.toml
└── README.md
```

The V80 vanilla monolith (`public/index.html`, ~11k LOC) was retired
on 2026-05-26 in M9.2 after M9.1 promoted the Solid build to prod;
historical source remains in git history.

Tasks live in `.meshkore/modules/portal/tasks/`.

## What this module is NOT

- Not a public marketing page. Use `webapp/` for that.
- Not a daemon. Use `daemon/` for that.
- Not a hub. Use `api/` for that.

If a feature requires backend logic, it goes into the daemon's HTTP
API, never into a Pages Function here. Keeping this module 100% static
is a design constraint, not an accident.
