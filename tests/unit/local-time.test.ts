import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { LocalTime, timeAgo } from "@/components/local-time";

const UPDATED_AT = "2026-11-06T16:00:00.000Z";

describe("LocalTime", () => {
  it("leaves the clock-dependent text out of the server render", () => {
    const html = renderToString(createElement(LocalTime, { date: UPDATED_AT, render: () => "5 minutes ago" }));
    expect(html).toBe(`<time dateTime="${UPDATED_AT}"></time>`);
  });

  it("accepts a Date as well as an ISO string", () => {
    const html = renderToString(createElement(LocalTime, { date: new Date(UPDATED_AT), render: timeAgo }));
    expect(html).toBe(`<time dateTime="${UPDATED_AT}"></time>`);
  });
});

describe("timeAgo", () => {
  it("phrases a past time relative to now", () => {
    expect(timeAgo(new Date(Date.now() - 5 * 60_000))).toBe("5 minutes ago");
  });
});
