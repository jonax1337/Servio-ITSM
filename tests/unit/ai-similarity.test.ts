import { describe, expect, it } from "vitest";
import {
  clusterBySimilarity, orderOpenFirst, rankSimilar, similarityReason, tokenize, type SimilarityDoc,
} from "@/lib/ai-similarity";

const doc = (id: number, focus: string, context = "", extra: Partial<SimilarityDoc> = {}): SimilarityDoc => ({
  id, focus, context, ...extra,
});

describe("tokenize", () => {
  it("lower-cases, drops stopwords and short tokens, and folds plurals", () => {
    expect(tokenize("The VPN logins are failing for us")).toEqual(["vpn", "login", "fail"]);
  });

  it("keeps words ending in -ss, -us or -is intact", () => {
    expect(tokenize("access status analysis")).toEqual(["access", "status", "analysis"]);
  });
});

describe("rankSimilar", () => {
  const target = doc(1, "VPN connection drops every hour", "Remote users lose the VPN tunnel");

  it("ranks the matching ticket above an unrelated one", () => {
    const matches = rankSimilar(
      target,
      [doc(2, "Printer on floor 3 jams paper"), doc(3, "VPN tunnel disconnects hourly", "users lose connection")],
      0.1,
    );
    expect(matches.map((m) => m.id)).toEqual([3]);
    expect(matches[0].sharedTerms).toContain("vpn");
  });

  it("returns nothing when no candidate reaches the minimum score", () => {
    expect(rankSimilar(target, [doc(2, "Printer jams paper")], 0.35)).toEqual([]);
  });

  it("scores identical text as 1", () => {
    const [match] = rankSimilar(target, [doc(2, target.focus, target.context)], 0.1);
    expect(match.score).toBeCloseTo(1, 5);
  });

  it("counts focus text for more than context text", () => {
    const inFocus = doc(2, "vpn timeout", "nothing relevant here");
    const inContext = doc(3, "nothing relevant here", "vpn timeout");
    const matches = rankSimilar(doc(1, "vpn timeout"), [inFocus, inContext], 0.01);
    expect(matches.map((m) => m.id)).toEqual([2, 3]);
  });

  it("adds a bonus for a shared service and category, but never to unrelated text", () => {
    const base = rankSimilar(doc(1, "vpn drops"), [doc(2, "vpn drops now")], 0)[0].score;
    const boosted = rankSimilar(
      doc(1, "vpn drops", "", { serviceId: "s", categoryId: "c" }),
      [doc(2, "vpn drops now", "", { serviceId: "s", categoryId: "c" })],
      0,
    )[0];
    expect(boosted.score).toBeGreaterThan(base);
    expect(boosted.sameService && boosted.sameCategory).toBe(true);

    const [unrelated] = rankSimilar(
      doc(1, "vpn drops", "", { serviceId: "s" }),
      [doc(2, "printer jam", "", { serviceId: "s" })],
      0,
    );
    expect(unrelated.score).toBe(0);
  });

  it("handles empty text without dividing by zero", () => {
    expect(rankSimilar(doc(1, ""), [doc(2, "")], 0)[0].score).toBe(0);
  });
});

describe("clusterBySimilarity", () => {
  const vpn = (id: number) => doc(id, "VPN tunnel drops", "remote users disconnected from vpn");
  const options = { threshold: 0.35, minSize: 3 };

  it("groups similar tickets under the lowest id and reports the shared terms", () => {
    const clusters = clusterBySimilarity([vpn(7), vpn(3), vpn(5), doc(9, "Printer jams paper")], options);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].seedId).toBe(3);
    expect(clusters[0].ticketIds.sort()).toEqual([3, 5, 7]);
    expect(clusters[0].sharedTerms).toContain("vpn");
  });

  it("ignores groups smaller than the minimum size", () => {
    expect(clusterBySimilarity([vpn(1), vpn(2), doc(3, "Printer jams paper")], options)).toEqual([]);
  });

  it("does not chain a ticket that only resembles another member", () => {
    const seed = doc(1, "alpha beta gamma delta");
    const near = doc(2, "alpha beta gamma delta");
    const nearer = doc(3, "alpha beta gamma delta");
    const chained = doc(4, "delta epsilon zeta eta theta");
    const [cluster] = clusterBySimilarity([seed, near, nearer, chained], { threshold: 0.6, minSize: 3 });
    expect(cluster.ticketIds).toEqual([1, 2, 3]);
  });

  it("builds separate clusters for separate topics", () => {
    const printer = (id: number) => doc(id, "Printer jams paper", "tray jammed again");
    const clusters = clusterBySimilarity([vpn(1), vpn(2), vpn(3), printer(4), printer(5), printer(6)], options);
    expect(clusters.map((c) => c.seedId)).toEqual([1, 4]);
  });
});

describe("similarityReason", () => {
  it("lists shared terms and matching context", () => {
    expect(similarityReason({ sharedTerms: ["vpn", "tunnel"], sameCategory: true, sameService: true })).toBe(
      "Shares “vpn”, “tunnel” · same service · same category",
    );
  });

  it("falls back when nothing specific is known", () => {
    expect(similarityReason({ sharedTerms: [], sameCategory: false, sameService: false })).toBe("Similar wording");
  });
});

describe("orderOpenFirst", () => {
  it("puts open items first and sorts by score within each group", () => {
    const ordered = orderOpenFirst([
      { id: 1, open: false, score: 0.9 },
      { id: 2, open: true, score: 0.4 },
      { id: 3, open: true, score: 0.6 },
      { id: 4, open: false, score: 0.5 },
    ]);
    expect(ordered.map((i) => i.id)).toEqual([3, 2, 1, 4]);
  });
});
