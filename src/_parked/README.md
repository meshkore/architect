# Parked components (not in the live build)

These are preserved-but-inactive components. They carry the `.tsx.bak`
extension so TypeScript + Vite skip them (same convention as the
`*.legacy.tsx.bak` files in `src/components/`). Nothing imports them, so
they're out of the running cockpit — but the work is NOT lost.

## Parked 2026-06-19 — workspace sub-tabs (Tasks / Context / Diagrams)

Operator decision: the roadmap column's sub-tab nav
(Roadmap · Tasks · Context · Diagrams) was hidden and the column is now
roadmap-only. Reasons + restore plan are in the context decision
`.meshkore/context/decisions/parked-workspace-subtabs.md`.

- **RoadmapList.tsx.bak** — the per-module Tasks view (select a module in
  the MODULES column → see its tasks). Its purpose can be folded into the
  roadmap itself as a module filter; kept for the future "independent
  tasks view".
- **ContextPanel.tsx.bak** — the Context tab (`.meshkore/context/` tree
  viewer; used the daemon `/context` endpoint).
- **DiagramsPanel.tsx.bak** — the Diagrams tab.

### To restore one

1. `git mv src/_parked/<Name>.tsx.bak src/components/<Name>.tsx`.
2. Re-add its import + a host (a sub-tab or a dedicated zone) in
   `Cockpit.tsx`.
3. Re-check the daemon endpoints it relied on still exist
   (`/context` for ContextPanel, `/state` for RoadmapList).
