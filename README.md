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
| Cloudflare Pages project | `meshkore-architect` |
| Account | `875bd2c5943a18d6c520d894ed12905f` (rjj@proars.com) |
| Build output | `public/` (no build step yet) |
| DNS | CNAME `architect` → `meshkore-architect.pages.dev` |

### First-time setup (one-shot, from the dashboard)

1. Create CF Pages project `meshkore-architect` (Direct Upload mode).
2. Add custom domain `architect.meshkore.com`. CF auto-creates the CNAME
   in the `meshkore.com` zone.
3. From the repo: `cd architect && npm run deploy`.

### Subsequent deploys

```bash
cd architect
npm run deploy
```

Or push to a branch tracked by CF Pages → auto-deploy.

## Local development

```bash
cd architect
npm run dev           # serves public/ on http://localhost:4173
```

Then in another terminal, run the daemon:

```bash
npx meshkore start    # binds localhost:5570
```

The architect will detect the daemon and load state.

## Structure (current — Phase 1, monolithic)

```
architect/
├── public/
│   ├── index.html       ← the entire app (~7k lines, will be split in Phase 3)
│   └── _headers         ← CF Pages security + cache headers
├── package.json
├── wrangler.toml
└── README.md
```

## Roadmap

| Phase | Goal | Status |
|---|---|---|
| 0 — prepare | `architect/` folder, configs | done (2026-05-12) |
| 1 — parallel deploy | `architect.meshkore.com` live next to `meshkore.com/architect` | in progress |
| 2 — cutover | `/architect*` on webapp 301 → `architect.meshkore.com` | pending |
| 3 — modularize | Split `index.html` into `src/{shell,modules,daemon,state,utils}/` with Vite | pending |
| 4 — framework? | Decide vanilla vs Preact vs Svelte after split | future |

Tasks live in `.meshkore/modules/architect/tasks/`.

## What this module is NOT

- Not a public marketing page. Use `webapp/` for that.
- Not a daemon. Use `daemon/` for that.
- Not a hub. Use `api/` for that.

If a feature requires backend logic, it goes into the daemon's HTTP
API, never into a Pages Function here. Keeping this module 100% static
is a design constraint, not an accident.
