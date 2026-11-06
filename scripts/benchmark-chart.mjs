// Renders the README comparison chart (light + dark SVG) from the measured
// ITSM benchmark data in docs/benchmark/results.json. Run `pnpm benchmark:chart`
// after updating the data; docs/benchmark.md describes the method.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("../docs/benchmark/", import.meta.url));
const COMPARED = ["servio", "glpi", "itop", "znuny"];
const TASK_COUNT = 17;

const THEMES = {
  light: { bg: "#F1F4F8", ink: "#12243A", muted: "#5D6C80", track: "#E1E7EF", rule: "#D5DDE7", servio: "#3559E8", other: "#9DAABA" },
  dark: { bg: "#12243A", ink: "#FFFFFF", muted: "#9DACBF", track: "#1C3350", rule: "#26405F", servio: "#8FAAFF", other: "#5A6D85" },
};

const W = 1600;
const PAD = 72;
const ROW_H = 76;
const FIRST_ROW_Y = 240;
const BAR = { x: 320, maxW: 700, h: 34 };
const COL = { complete: 1180, time: 1430 };
const FONT = "Manrope, Inter, 'Segoe UI', Helvetica, Arial, sans-serif";

function totalsFor(results) {
  const tasks = Object.values(results);
  return {
    clicks: tasks.reduce((sum, t) => sum + t.clicks, 0),
    ms: tasks.reduce((sum, t) => sum + (t.medianMs ?? 0), 0),
    done: tasks.filter((t) => t.status === "done").length,
    partial: tasks.filter((t) => t.status === "partial").length,
    missing: tasks.filter((t) => t.status === "not-supported").length,
  };
}

function gapNote({ partial, missing }) {
  return [partial && `${partial} partial`, missing && `${missing} missing`].filter(Boolean).join(", ");
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

function row(system, t, maxClicks, y, c) {
  const isServio = system.key === "servio";
  const barW = (t.clicks / maxClicks) * BAR.maxW;
  const mid = y + BAR.h / 2;
  const weight = isServio ? 800 : 600;
  const note = gapNote(t);
  return `
  <text x="${PAD}" y="${mid + 10}" font-size="30" font-weight="${weight}" fill="${c.ink}">${system.name}</text>
  <rect x="${BAR.x}" y="${y}" width="${BAR.maxW}" height="${BAR.h}" rx="6" fill="${c.track}"/>
  <rect x="${BAR.x}" y="${y}" width="${barW.toFixed(1)}" height="${BAR.h}" rx="6" fill="${isServio ? c.servio : c.other}"/>
  <text x="${(BAR.x + barW + 16).toFixed(1)}" y="${mid + 10}" font-size="30" font-weight="${weight}" fill="${c.ink}">${t.clicks}</text>
  <text x="${COL.complete}" y="${mid + (note ? 2 : 10)}" font-size="30" font-weight="${weight}" fill="${c.ink}">${t.done} / ${TASK_COUNT}</text>
  ${note ? `<text x="${COL.complete}" y="${mid + 28}" font-size="18" fill="${c.muted}">${note}</text>` : ""}
  <text x="${COL.time}" y="${mid + 10}" font-size="30" font-weight="${weight}" fill="${c.ink}">${seconds(t.ms)}</text>`;
}

function render(data, c) {
  const systems = COMPARED.map((key) => ({ ...data.systems.find((s) => s.key === key), t: totalsFor(data.results[key]) }))
    .sort((a, b) => a.t.clicks - b.t.clicks);
  const maxClicks = Math.max(...systems.map((s) => s.t.clicks));
  const footerY = FIRST_ROW_Y + systems.length * ROW_H + 36;
  const h = footerY + 52;
  const month = new Date(data.measured).toLocaleString("en-GB", { month: "long", year: "numeric" });
  const label = (x, text) => `<text x="${x}" y="${FIRST_ROW_Y - 30}" font-size="15" font-weight="700" letter-spacing="1.6" fill="${c.muted}">${text}</text>`;
  const rows = systems.map((s, i) => row(s, s.t, maxClicks, FIRST_ROW_Y + i * ROW_H, c)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" role="img" aria-labelledby="t d">
<title id="t">Clicks for ${TASK_COUNT} everyday service-desk tasks</title>
<desc id="d">${systems.map((s) => `${s.name}: ${s.t.clicks} clicks, ${s.t.done} of ${TASK_COUNT} tasks complete, ${seconds(s.t.ms)}`).join("; ")}. Measured ${month}.</desc>
<rect width="${W}" height="${h}" fill="${c.bg}"/>
<g font-family="${FONT}" style="font-variant-numeric: tabular-nums">
  <text x="${PAD}" y="96" font-size="44" font-weight="800" fill="${c.ink}">Clicks for ${TASK_COUNT} everyday service-desk tasks</text>
  <text x="${PAD}" y="140" font-size="22" fill="${c.muted}">Fewer is better. Same tasks and seed data in every system, scripted with Playwright · ${month}</text>
  ${label(PAD, "SYSTEM")}${label(BAR.x, "TOTAL CLICKS")}${label(COL.complete, "FULLY DONE")}${label(COL.time, "SCRIPT TIME")}
  <line x1="${PAD}" x2="${W - PAD}" y1="${FIRST_ROW_Y - 18}" y2="${FIRST_ROW_Y - 18}" stroke="${c.rule}" stroke-width="2"/>
  ${rows}
  <text x="${PAD}" y="${footerY + 14}" font-size="19" fill="${c.muted}">Partially supported tasks take fewer clicks, so the totals favour systems with gaps. Method and per-task numbers: docs/benchmark.md</text>
</g>
</svg>
`;
}

const data = JSON.parse(readFileSync(DIR + "results.json", "utf8"));
for (const [name, colors] of Object.entries(THEMES)) {
  writeFileSync(`${DIR}clicks-${name}.svg`, render(data, colors));
  console.log(`wrote docs/benchmark/clicks-${name}.svg`);
}
