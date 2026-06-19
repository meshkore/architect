# Parked components (not in the live build)

Preserved-but-inactive components. They carry the `.tsx.bak` extension so
TypeScript + Vite skip them (same convention as the `*.legacy.tsx.bak`
files in `src/components/`). Nothing imports them — they're out of the
running cockpit, but the work is NOT lost.

## Parked 2026-06-19 — per-module Tasks view

- **RoadmapList.tsx.bak** — the per-module Tasks view (select a module in
  the MODULES column → see its tasks). Parked because that filter belongs
  in the roadmap itself (a module filter over the initiatives/tasks list),
  not a separate per-module list. Kept for the future "independent tasks
  view". See `.meshkore/context/decisions/2026-06-19-parked-workspace-subtabs.md`.

> Context + Diagrams were briefly parked the same day, then RESTORED as
> sub-tabs on the Roadmap column (alongside Protocols, moved in from the
> header). Only the Tasks view remains parked.

### To restore

1. `git mv src/_parked/RoadmapList.tsx.bak src/components/RoadmapList.tsx`.
2. Re-add its import + a host (a sub-tab or, preferably, a module filter
   inside the roadmap) in `Cockpit.tsx`.
