import { describe, expect, it } from "vitest";
import {
  checkReplyRate, checkUploadRate, loginRetryAfter, recordLoginFailure, recordLoginSuccess, slidingWindow,
} from "@/lib/rate-limit";

describe("slidingWindow", () => {
  it("allows up to the limit inside a window, then denies", () => {
    const store = new Map();
    let now = 1000;
    for (let i = 0; i < 3; i++) {
      expect(slidingWindow(store, "k", 3, 60_000, now).allowed).toBe(true);
      now += 10;
    }
    const denied = slidingWindow(store, "k", 3, 60_000, now);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets after the window passes", () => {
    const store = new Map();
    slidingWindow(store, "k", 1, 1000, 0);
    expect(slidingWindow(store, "k", 1, 1000, 500).allowed).toBe(false);
    expect(slidingWindow(store, "k", 1, 1000, 1500).allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    const store = new Map();
    expect(slidingWindow(store, "a", 1, 60_000, 0).allowed).toBe(true);
    expect(slidingWindow(store, "a", 1, 60_000, 1).allowed).toBe(false);
    expect(slidingWindow(store, "b", 1, 60_000, 1).allowed).toBe(true);
  });

  it("reports remaining budget", () => {
    const store = new Map();
    expect(slidingWindow(store, "k", 5, 60_000, 0).remaining).toBe(4);
    expect(slidingWindow(store, "k", 5, 60_000, 1).remaining).toBe(3);
  });
});

describe("loginThrottle", () => {
  it("allows the first free attempts without a lock", () => {
    let now = 0;
    for (let i = 0; i < 5; i++) {
      recordLoginFailure("k", now);
      now += 1000;
      if (i < 4) expect(loginRetryAfter("k", now)).toBe(0);
    }
  });

  it("locks with exponential backoff past the free tier", () => {
    let now = 0;
    for (let i = 0; i < 6; i++) {
      recordLoginFailure("k", now);
      now += 1000;
    }
    const wait = loginRetryAfter("k", now);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(15 * 60_000);
  });

  it("grows the backoff with more failures", () => {
    let now = 0;
    for (let i = 0; i < 6; i++) recordLoginFailure("k6", now++);
    for (let i = 0; i < 7; i++) recordLoginFailure("k7", now++);
    for (let i = 0; i < 8; i++) recordLoginFailure("k8", now++);
    const w6 = loginRetryAfter("k6", now);
    const w7 = loginRetryAfter("k7", now);
    const w8 = loginRetryAfter("k8", now);
    expect(w8).toBeGreaterThan(w7);
    expect(w7).toBeGreaterThan(w6);
  });

  it("a success clears the failure state", () => {
    let now = 0;
    for (let i = 0; i < 7; i++) recordLoginFailure("ok", now++);
    expect(loginRetryAfter("ok", now)).toBeGreaterThan(0);
    recordLoginSuccess("ok");
    expect(loginRetryAfter("ok", now)).toBe(0);
  });

  it("decays back to zero after a quiet period", () => {
    let now = 0;
    for (let i = 0; i < 7; i++) recordLoginFailure("decay", now++);
    // LOGIN_DECAY_MS default is 15 min; the lock itself expires by then too.
    expect(loginRetryAfter("decay", now)).toBeGreaterThan(0);
    expect(loginRetryAfter("decay", now + 15 * 60_000 + 1)).toBe(0);
  });
});

describe("portal reply and upload limiters", () => {
  const burst = (check: (id: string, now: number) => unknown, id: string, now: number) => {
    let allowed = 0;
    while (check(id, now) === null) allowed += 1;
    return allowed;
  };

  it("caps replies per user, then reports when to retry", () => {
    expect(burst(checkReplyRate, "reply-user", 0)).toBe(10);
    expect(checkReplyRate("reply-user", 1)?.retryAfterMs).toBeGreaterThan(0);
  });

  it("tracks users and reply vs upload budgets independently", () => {
    burst(checkReplyRate, "shared-user", 0);
    expect(checkReplyRate("other-user", 0)).toBeNull();
    expect(checkUploadRate("shared-user", 0)).toBeNull();
  });

  it("allows 30 uploads per minute and frees the budget after the window", () => {
    expect(burst(checkUploadRate, "upload-user", 0)).toBe(30);
    expect(checkUploadRate("upload-user", 59_000)).not.toBeNull();
    expect(checkUploadRate("upload-user", 60_001)).toBeNull();
  });
});
