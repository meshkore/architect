/**
 * quota-error — detect provider rate-limit / out-of-credit failures in
 * finished agent text and extract the reset time when present.
 *
 * Pure functions (no Solid) so they are unit-testable with node:test.
 *
 * Covered shapes (provider-agnostic, present + future):
 *   [muse error] API error 429 [request_id=…]: Subscription quota
 *     exhausted. Your usage window resets at 2026-09-12T17:35:09Z. (rate_limit_error)
 *   … 429, rate_limit / rate-limit / ratelimit, quota exhausted,
 *   out of credit(s), credits exhausted, usage window resets …
 */

export interface QuotaInfo {
  /** e.g. "Muse", "Codex", "Anthropic" — from a "[x error]" prefix, else "". */
  provider: string;
  /** Parsed reset instant, when the text carries one. */
  resetsAt: Date | null;
  /** Raw reset fragment as found in the text (for display fallback). */
  rawReset: string | null;
}

const QUOTA_PATTERNS: RegExp[] = [
  /rate_limit_error/i,
  /rate[\s_-]*limit/i,
  /quota[\s\w-]*exhaust/i,
  /exhaust[\s\w-]*quota/i,
  /subscription[\s\w-]*quota/i,
  /out of (credit|credits|quota)/i,
  /credits?[\s\w-]*exhaust/i,
  /usage window resets?/i,
  /\b429\b/,
];

/** A bare "429" alone is weak evidence — require a quota-ish companion. */
const BARE_429_COMPANIONS: RegExp[] = [
  /quota/i,
  /rate/i,
  /credit/i,
  /window resets?/i,
  /request_id/i,
  /api error/i,
];

const RESET_PATTERNS: RegExp[] = [
  /resets?\s+(?:at|on)\s+([^\s)]+)/i,
  /reset\s*(?:window)?\s*:?\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/i,
  /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/,
];

const PROVIDER_PREFIX = /^\[\s*([a-z0-9_-]+)(?:\s+error)?\s*\]/i;

function parseResetDate(raw: string): Date | null {
  const cleaned = raw.replace(/[.,;)\]]+$/, '');
  const ms = Date.parse(cleaned);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** Null when the text is NOT a quota/rate-limit failure. */
export function detectQuotaError(text: string): QuotaInfo | null {
  if (!text || text.length > 4000) return null;
  const hits = QUOTA_PATTERNS.filter((p) => p.test(text));
  if (hits.length === 0) return null;
  // Only "429" matched → demand a companion so random "error 429"
  // mentions without quota context don't get swallowed.
  const onlyBare429 =
    hits.length === 1 && (hits[0]?.source.includes('429') ?? false) && !/rate|quota|credit|reset/i.test(text.replace(/429/g, ''));
  if (onlyBare429 && !BARE_429_COMPANIONS.some((p) => p.test(text))) return null;

  let rawReset: string | null = null;
  let resetsAt: Date | null = null;
  for (const p of RESET_PATTERNS) {
    const m = text.match(p);
    if (m?.[1]) {
      rawReset = m[1];
      resetsAt = parseResetDate(m[1]);
      break;
    }
  }

  const pm = text.match(PROVIDER_PREFIX);
  const provider = pm?.[1] ? pm[1].charAt(0).toUpperCase() + pm[1].slice(1) : '';

  return { provider, resetsAt, rawReset };
}

/** "en 42 min" / "en 2 h 05 min" — null when unknown or already past. */
export function resetCountdown(resetsAt: Date | null, nowMs = Date.now()): string | null {
  if (!resetsAt) return null;
  const diff = resetsAt.getTime() - nowMs;
  if (!Number.isFinite(diff) || diff <= 0) return null;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'en menos de un minuto';
  if (mins < 60) return `en ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `en ${h} h` : `en ${h} h ${String(m).padStart(2, '0')} min`;
}
