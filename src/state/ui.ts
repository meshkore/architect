/**
 * state/ui.ts — local-only UI preferences (tab, zone, rail mode,
 * column widths, filters). Persisted to localStorage under the same
 * keys the V80 monolith uses so the cockpit visually feels the same
 * before and after the migration.
 *
 * Every setter writes through to localStorage on the spot. Reload-
 * survival is the contract.
 */

import { createStore } from 'solid-js/store';
import { log } from '~/lib/log';

export type Tab = 'roadmap' | 'manage' | 'history' | 'diagrams';
export type Zone = 'architect' | 'agents' | 'bookmarks' | 'crons' | 'links' | 'protocols' | 'diary' | 'config';
export type RailMode = 'full' | 'short';
export type WsTab = 'tasks' | 'context' | 'diagrams' | 'modules';
export type ModulesPill = 'all' | 'work' | 'stb';

export interface UIStoreState {
  activeTab: Tab;
  activeZone: Zone;
  projectsRailMode: RailMode;
  projectsRailWidth: number;
  chatRailWidth: number;
  navFilter: string;
  wsTab: WsTab;
  /** "Group by phase" toggle on the expanded initiative card (M4.2 spec). */
  initiativeGroupByPhase: boolean;
  /** Modules-tree filter pill (V80 monolith parity). */
  modulesPill: ModulesPill;
  /** Collapse the modules nav column to a vertical rail. */
  modulesCollapsed: boolean;
}

// localStorage keys — KEEP IN SYNC with V80 monolith.
const KEYS = {
  activeTab: 'mc-active-tab',
  activeZone: 'mc-active-zone',
  projectsRailMode: 'mc-projects-rail-mode',
  projectsRailWidth: 'mc-projects-rail-width',
  chatRailWidth: 'mc-chat-rail-width',
  navFilter: 'mc-nav-filter',
  wsTab: 'mc-ws-tab',
  initiativeGroupByPhase: 'mc-initiative-group-by-phase',
  modulesPill: 'mc-modules-pill',
  modulesCollapsed: 'mc-modules-collapsed',
} as const;

function readString<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const v = localStorage.getItem(key);
    if (v && (allowed as readonly string[]).includes(v)) return v as T;
  } catch {
    /* private mode */
  }
  return fallback;
}

function readInt(key: string, fallback: number): number {
  try {
    const v = localStorage.getItem(key);
    const n = v === null ? NaN : Number(v);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === '1' || v === 'true') return true;
    if (v === '0' || v === 'false') return false;
  } catch {
    /* ignore */
  }
  return fallback;
}

function writeStr(key: string, val: string): void {
  try {
    localStorage.setItem(key, val);
  } catch {
    /* quota */
  }
}

const initial: UIStoreState = {
  activeTab: readString<Tab>(KEYS.activeTab, 'roadmap', ['roadmap', 'manage', 'history', 'diagrams']),
  activeZone: readString<Zone>(KEYS.activeZone, 'architect', [
    'architect',
    'agents',
    'bookmarks',
    'crons',
    'links',
    'protocols',
    'diary',
    'config',
  ]),
  projectsRailMode: readString<RailMode>(KEYS.projectsRailMode, 'full', ['full', 'short']),
  projectsRailWidth: readInt(KEYS.projectsRailWidth, 240),
  chatRailWidth: readInt(KEYS.chatRailWidth, 220),
  navFilter: localStorage.getItem(KEYS.navFilter) ?? '',
  wsTab: readString<WsTab>(KEYS.wsTab, 'tasks', ['tasks', 'context', 'diagrams', 'modules']),
  initiativeGroupByPhase: readBool(KEYS.initiativeGroupByPhase, false),
  modulesPill: readString<ModulesPill>(KEYS.modulesPill, 'all', ['all', 'work', 'stb']),
  modulesCollapsed: readBool(KEYS.modulesCollapsed, false),
};

const [state, setState] = createStore<UIStoreState>(initial);

function setActiveTab(t: Tab): void {
  setState('activeTab', t);
  writeStr(KEYS.activeTab, t);
}

function setActiveZone(z: Zone): void {
  setState('activeZone', z);
  writeStr(KEYS.activeZone, z);
}

function setProjectsRailMode(m: RailMode): void {
  setState('projectsRailMode', m);
  writeStr(KEYS.projectsRailMode, m);
}

function setProjectsRailWidth(w: number): void {
  setState('projectsRailWidth', w);
  writeStr(KEYS.projectsRailWidth, String(w));
}

function setChatRailWidth(w: number): void {
  setState('chatRailWidth', w);
  writeStr(KEYS.chatRailWidth, String(w));
}

function setNavFilter(s: string): void {
  setState('navFilter', s);
  writeStr(KEYS.navFilter, s);
}

function setWsTab(t: WsTab): void {
  setState('wsTab', t);
  writeStr(KEYS.wsTab, t);
}

function setInitiativeGroupByPhase(v: boolean): void {
  setState('initiativeGroupByPhase', v);
  writeStr(KEYS.initiativeGroupByPhase, v ? '1' : '0');
}

function setModulesPill(p: ModulesPill): void {
  setState('modulesPill', p);
  writeStr(KEYS.modulesPill, p);
}

function setModulesCollapsed(v: boolean): void {
  setState('modulesCollapsed', v);
  writeStr(KEYS.modulesCollapsed, v ? '1' : '0');
}

function toggleModulesCollapsed(): void {
  setModulesCollapsed(!state.modulesCollapsed);
}

export const uiStore = {
  state,
  setActiveTab,
  setActiveZone,
  setProjectsRailMode,
  setProjectsRailWidth,
  setChatRailWidth,
  setNavFilter,
  setWsTab,
  setInitiativeGroupByPhase,
  setModulesPill,
  setModulesCollapsed,
  toggleModulesCollapsed,
};

log.debug('state/ui loaded', state.activeTab, state.activeZone);
