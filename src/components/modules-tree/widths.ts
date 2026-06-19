/**
 * Modules-rail width thresholds (px). The rail lives inside the roadmap
 * column and is resized by its `modules-rail` splitter. Three bands:
 *
 *   width <  COLLAPSE   → vertical "Modules" strip (RoadmapColumn swaps
 *                         the list for a label; reclaims width for the
 *                         roadmap)
 *   COLLAPSE..COUNT_MIN → list shown, per-row task counts HIDDEN so the
 *                         module name gets the space
 *   width >= COUNT_MIN  → the normal wide view: list + task counts
 *
 * Read reactively from `uiStore.state.modulesRailWidth`, which the
 * Splitter mirrors on every drag.
 */
export const MODULES_COLLAPSE_PX = 72;
export const MODULES_COUNT_MIN_PX = 180;
