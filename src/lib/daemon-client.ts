/**
 * daemon-client.ts — compatibility facade over `lib/daemon/`.
 *
 * AX16 split the former ~1600-line monolith into `lib/daemon/`
 * (result / core / types/ / methods/). ~40 modules import
 * `~/lib/daemon-client` for `DaemonClient` and for dozens of wire types,
 * so this file stays as the stable specifier and re-exports the package
 * verbatim. Both import paths resolve to the same symbols — new code may
 * use either; prefer `~/lib/daemon` going forward.
 *
 * Nothing but re-exports belongs here. Add methods and types inside the
 * package.
 */

export * from './daemon';
