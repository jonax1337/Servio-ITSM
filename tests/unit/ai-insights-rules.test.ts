import { describe, expect, it } from "vitest";
import {
  INSIGHT_DEFAULTS, articleSkeletonMarkdown, articleTitleFromGap, clipNote, clusterDedupeKey, clusterInsightText,
  isMostlyCovered, kbGapDedupeKey, kbGapInsightText, normalizeInsightConfig, parseClusterPayload, parseKbGapPayload,
  problemFromCluster, problemTraits, serializeClusterPayload, serializeKbGapPayload, type ClusterTicket,
} from "@/lib/ai-insights-rules";

describe("normalizeInsightConfig", () => {
  it("keeps valid values", () => {
    const config = { clusterMinTickets: 5, clusterWindowHours: 6, similarityThreshold: 0.5, kbGapMinTickets: 4, kbGapWindowDays: 14 };
    expect(normalizeInsightConfig(config)).toEqual(config);
  });

  it("falls back to the defaults for nonsense", () => {
    const config = { clusterMinTickets: 0, clusterWindowHours: -3, similarityThreshold: Number.NaN, kbGapMinTickets: 1, kbGapWindowDays: 0 };
    expect(normalizeInsightConfig(config)).toEqual(INSIGHT_DEFAULTS);
  });

  it("clamps the threshold into the open range and rounds ticket counts down", () => {
    const high = normalizeInsightConfig({ ...INSIGHT_DEFAULTS, similarityThreshold: 4, clusterMinTickets: 3.9 });
    expect(high.similarityThreshold).toBe(0.95);
    expect(high.clusterMinTickets).toBe(3);
    expect(normalizeInsightConfig({ ...INSIGHT_DEFAULTS, similarityThreshold: 0 }).similarityThreshold).toBe(0.05);
  });
});

describe("dedupe keys", () => {
  it("are stable per seed and distinct per kind", () => {
    expect(clusterDedupeKey(12)).toBe("cluster:12");
    expect(kbGapDedupeKey(12)).toBe("kb-gap:12");
  });
});

describe("isMostlyCovered", () => {
  it("is true once half of the tickets belong to an earlier insight", () => {
    expect(isMostlyCovered([1, 2, 3, 4], new Set([1, 2]))).toBe(true);
  });

  it("is false when fewer than half are covered", () => {
    expect(isMostlyCovered([1, 2, 3, 4], new Set([1]))).toBe(false);
    expect(isMostlyCovered([1, 2, 3], new Set())).toBe(false);
  });
});

describe("payloads", () => {
  it("round-trip", () => {
    const cluster = { terms: ["vpn"], windowHours: 24 };
    expect(parseClusterPayload(serializeClusterPayload(cluster))).toEqual(cluster);
    const gap = { terms: ["cache"], resolutions: [{ ticketId: 4, ref: "INC-0004", title: "Slow", note: "Cleared cache" }] };
    expect(parseKbGapPayload(serializeKbGapPayload(gap))).toEqual(gap);
  });

  it("yield an empty payload for malformed JSON or the wrong shape", () => {
    expect(parseClusterPayload("not json")).toEqual({ terms: [], windowHours: 0 });
    expect(parseKbGapPayload('{"terms": 5}')).toEqual({ terms: [], resolutions: [] });
  });
});

describe("insight texts", () => {
  it("name the topic when terms are known", () => {
    expect(clusterInsightText(4, ["vpn", "tunnel"], 24).title).toBe("4 open incidents look alike: vpn, tunnel");
    expect(kbGapInsightText(3, ["cache"], 30).title).toBe("3 resolved tickets share a fix: cache");
  });

  it("omit the topic otherwise", () => {
    expect(clusterInsightText(3, [], 24).title).toBe("3 open incidents look alike");
  });

  it("state the window in the summary", () => {
    expect(clusterInsightText(3, [], 6).summary).toContain("within 6 hours");
    expect(kbGapInsightText(3, [], 14).summary).toContain("last 14 days");
  });
});

describe("clipNote", () => {
  it("collapses whitespace and truncates long notes", () => {
    expect(clipNote("  a \n\n b ")).toBe("a b");
    const clipped = clipNote("x".repeat(500));
    expect(clipped).toHaveLength(400);
    expect(clipped.endsWith("…")).toBe(true);
  });
});

describe("problemTraits", () => {
  it("inherits the worst severity and the most common routing of the tickets", () => {
    const traits = problemTraits([
      { id: 1, prefix: "INC", title: "a", priority: "LOW", impact: "HIGH", categoryId: "c", groupId: null },
      { id: 2, prefix: "INC", title: "b", priority: "HIGH", impact: "LOW", categoryId: "c", groupId: "g" },
    ]);
    expect(traits).toEqual({ priority: "HIGH", impact: "HIGH", categoryId: "c", groupId: "g" });
  });
});

describe("problemFromCluster", () => {
  const ticket = (id: number, extra: Partial<ClusterTicket> = {}): ClusterTicket => ({
    id, prefix: "INC", title: `Ticket ${id}`, priority: "MEDIUM", impact: "LOW", categoryId: null, groupId: null, ...extra,
  });

  it("is named after the lowest-id ticket and lists every member", () => {
    const problem = problemFromCluster([ticket(9), ticket(3), ticket(5)]);
    expect(problem.title).toBe("Recurring: Ticket 3");
    expect(problem.description).toContain("3 similar incidents");
    expect(problem.description).toContain("INC-0009: Ticket 9");
  });

  it("takes the highest priority and impact", () => {
    const problem = problemFromCluster([
      ticket(1, { priority: "LOW", impact: "HIGH" }),
      ticket(2, { priority: "CRITICAL", impact: "LOW" }),
      ticket(3, { priority: "HIGH", impact: "MEDIUM" }),
    ]);
    expect(problem.priority).toBe("CRITICAL");
    expect(problem.impact).toBe("HIGH");
  });

  it("takes the most common category and group, ignoring tickets without one", () => {
    const problem = problemFromCluster([
      ticket(1, { categoryId: "a", groupId: null }),
      ticket(2, { categoryId: "b", groupId: "g" }),
      ticket(3, { categoryId: "b", groupId: null }),
    ]);
    expect(problem.categoryId).toBe("b");
    expect(problem.groupId).toBe("g");
  });

  it("leaves category and group empty when no ticket has one", () => {
    const problem = problemFromCluster([ticket(1), ticket(2)]);
    expect(problem.categoryId).toBeNull();
    expect(problem.groupId).toBeNull();
  });

  it("clips a very long title", () => {
    expect(problemFromCluster([ticket(1, { title: "x".repeat(300) })]).title.length).toBeLessThanOrEqual(120);
  });
});

describe("article drafts", () => {
  const resolutions = [
    { ticketId: 8, ref: "INC-0008", title: "Mail is slow", note: "Rebuilt the index" },
    { ticketId: 2, ref: "INC-0002", title: "Outlook search broken", note: "Reset the profile" },
  ];

  it("titles the draft after the lowest-id ticket", () => {
    expect(articleTitleFromGap(resolutions)).toBe("How to resolve: Outlook search broken");
    expect(articleTitleFromGap([])).toBe("How to resolve: recurring issue");
  });

  it("builds a skeleton citing each resolution and its ticket", () => {
    const markdown = articleSkeletonMarkdown(resolutions);
    expect(markdown).toContain("## Symptoms");
    expect(markdown).toContain("- Mail is slow (INC-0008)");
    expect(markdown).toContain("- Reset the profile (INC-0002)");
    expect(markdown).toContain("2 resolved tickets");
  });
});
