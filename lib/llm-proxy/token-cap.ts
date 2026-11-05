/**
 * Output-token caps of OpenAI-compatible upstreams. Claude Code asks for the
 * model's full Anthropic output budget (32k+), which smaller upstreams reject
 * with a 400; the proxy learns the cap from that error and clamps afterwards.
 */

/** Used when the upstream's error names the limit but states no number. */
export const FALLBACK_TOKEN_CAP = 8192;

const MENTIONS_TOKEN_LIMIT = /max_tokens|max_completion_tokens/i;
const CAP_PHRASE =
  /(?:at most|no more than|less than or equal to|<=|maximum(?:[^0-9]{0,60}?)(?:is|of|:|=)?|limit(?: is| of)?|supports? up to)\s*(\d{3,7})/gi;

/** True when an upstream 400 body complains about the requested output tokens. */
export function isTokenLimitError(errorText: string): boolean {
  return MENTIONS_TOKEN_LIMIT.test(errorText);
}

/**
 * The cap an upstream error states ("at most 16384", "less than or equal to
 * 16384", "maximum ... 16384"), or undefined. Only a number below `requested`
 * counts: the requested value itself often appears in the message too.
 */
export function parseTokenCap(errorText: string, requested: number): number | undefined {
  for (const match of errorText.matchAll(CAP_PHRASE)) {
    const cap = Number(match[1]);
    if (cap > 0 && cap < requested) return cap;
  }
  return undefined;
}

/** Smaller stated caps are treated as misparses: remembering one would cripple every later turn. */
export const MIN_LEARNED_TOKEN_CAP = 1024;
const LEARNED_CAP_TTL_MS = 60 * 60_000;

/**
 * Caps learned per upstream (URL + model), forgotten after an hour so a raised
 * limit or a one-off misparse doesn't stick for the life of the process.
 */
export class LearnedTokenCaps {
  private readonly caps = new Map<string, { cap: number; expires: number }>();

  get(key: string, now = Date.now()): number | undefined {
    const entry = this.caps.get(key);
    if (!entry) return undefined;
    if (entry.expires > now) return entry.cap;
    this.caps.delete(key);
    return undefined;
  }

  /** Remembers `cap` unless it is below MIN_LEARNED_TOKEN_CAP. */
  learn(key: string, cap: number, now = Date.now()): void {
    if (cap >= MIN_LEARNED_TOKEN_CAP) this.caps.set(key, { cap, expires: now + LEARNED_CAP_TTL_MS });
  }
}

/** `max_tokens` to send: the learned cap when it is lower than the request. */
export function clampMaxTokens(requested: number, learnedCap: number | undefined): number {
  return learnedCap === undefined ? requested : Math.min(requested, learnedCap);
}
