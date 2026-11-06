// Renders the README comparison charts (light + dark SVG) from the ITSM benchmark
// data in docs/benchmark/results.json: total clicks per system and the feature
// matrix. Run `pnpm benchmark:chart` after updating the data; docs/benchmark.md
// describes the method.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("../docs/benchmark/", import.meta.url));
const COMPARED = ["servio", "glpi", "itop", "znuny"];
const TASK_COUNT = 17;

const THEMES = {
  light: {
    bg: "#F1F4F8", ink: "#12243A", muted: "#5D6C80", track: "#E1E7EF", rule: "#D5DDE7", servio: "#3559E8", other: "#9DAABA",
    band: "#E3E9FB", yes: "#1E8A5A", partial: "#C58A16", no: "#9DAABA",
  },
  dark: {
    bg: "#12243A", ink: "#FFFFFF", muted: "#9DACBF", track: "#1C3350", rule: "#26405F", servio: "#8FAAFF", other: "#5A6D85",
    band: "#1B3156", yes: "#4CC98A", partial: "#E7B347", no: "#5A6D85",
  },
};

const W = 1600;
const PAD = 72;
const FONT = "Manrope, Inter, 'Segoe UI', Helvetica, Arial, sans-serif";

const monthOf = (data) => new Date(data.measured).toLocaleString("en-GB", { month: "long", year: "numeric" });
const systemsOf = (data) => COMPARED.map((key) => data.systems.find((s) => s.key === key));

function svg({ title, desc, height, c, body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" role="img" aria-labelledby="t d">
<title id="t">${title}</title>
<desc id="d">${desc}</desc>
<rect width="${W}" height="${height}" fill="${c.bg}"/>
<g font-family="${FONT}" style="font-variant-numeric: tabular-nums">${body}
</g>
</svg>
`;
}

function heading(title, subtitle, c) {
  return `
  <text x="${PAD}" y="96" font-size="44" font-weight="800" fill="${c.ink}">${title}</text>
  <text x="${PAD}" y="140" font-size="22" fill="${c.muted}">${subtitle}</text>`;
}

const columnLabel = (x, y, text, c, anchor = "start") =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="15" font-weight="700" letter-spacing="1.6" fill="${c.muted}">${text}</text>`;

// ---------------------------------------------------------------- clicks chart

const CLICKS = { rowH: 76, firstRowY: 240, bar: { x: 320, maxW: 700, h: 34 }, col: { complete: 1180, time: 1430 } };

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

function clicksRow(system, t, maxClicks, y, c) {
  const { bar, col } = CLICKS;
  const isServio = system.key === "servio";
  const barW = (t.clicks / maxClicks) * bar.maxW;
  const mid = y + bar.h / 2;
  const weight = isServio ? 800 : 600;
  const note = gapNote(t);
  return `
  <text x="${PAD}" y="${mid + 10}" font-size="30" font-weight="${weight}" fill="${c.ink}">${system.name}</text>
  <rect x="${bar.x}" y="${y}" width="${bar.maxW}" height="${bar.h}" rx="6" fill="${c.track}"/>
  <rect x="${bar.x}" y="${y}" width="${barW.toFixed(1)}" height="${bar.h}" rx="6" fill="${isServio ? c.servio : c.other}"/>
  <text x="${(bar.x + barW + 16).toFixed(1)}" y="${mid + 10}" font-size="30" font-weight="${weight}" fill="${c.ink}">${t.clicks}</text>
  <text x="${col.complete}" y="${mid + (note ? 2 : 10)}" font-size="30" font-weight="${weight}" fill="${c.ink}">${t.done} / ${TASK_COUNT}</text>
  ${note ? `<text x="${col.complete}" y="${mid + 28}" font-size="18" fill="${c.muted}">${note}</text>` : ""}
  <text x="${col.time}" y="${mid + 10}" font-size="30" font-weight="${weight}" fill="${c.ink}">${seconds(t.ms)}</text>`;
}

function renderClicks(data, c) {
  const { rowH, firstRowY, bar, col } = CLICKS;
  const systems = systemsOf(data).map((s) => ({ ...s, t: totalsFor(data.results[s.key]) })).sort((a, b) => a.t.clicks - b.t.clicks);
  const maxClicks = Math.max(...systems.map((s) => s.t.clicks));
  const footerY = firstRowY + systems.length * rowH + 36;
  const labelY = firstRowY - 30;
  return svg({
    title: `Clicks for ${TASK_COUNT} everyday service-desk tasks`,
    desc: `${systems.map((s) => `${s.name}: ${s.t.clicks} clicks, ${s.t.done} of ${TASK_COUNT} tasks complete, ${seconds(s.t.ms)}`).join("; ")}. Measured ${monthOf(data)}.`,
    height: footerY + 52,
    c,
    body: `${heading(`Clicks for ${TASK_COUNT} everyday service-desk tasks`, `Fewer is better. Same tasks and seed data in every system, scripted with Playwright · ${monthOf(data)}`, c)}
  ${columnLabel(PAD, labelY, "SYSTEM", c)}${columnLabel(bar.x, labelY, "TOTAL CLICKS", c)}${columnLabel(col.complete, labelY, "FULLY DONE", c)}${columnLabel(col.time, labelY, "SCRIPT TIME", c)}
  <line x1="${PAD}" x2="${W - PAD}" y1="${firstRowY - 18}" y2="${firstRowY - 18}" stroke="${c.rule}" stroke-width="2"/>
  ${systems.map((s, i) => clicksRow(s, s.t, maxClicks, firstRowY + i * rowH, c)).join("")}
  <text x="${PAD}" y="${footerY + 14}" font-size="19" fill="${c.muted}">Partially supported tasks take fewer clicks, so the totals favour systems with gaps. Method and per-task numbers: docs/benchmark.md</text>`,
  });
}

// -------------------------------------------------------------- feature matrix

const MATRIX = { headerY: 268, firstGroupY: 300, groupH: 58, rowH: 44, colX: [940, 1120, 1300, 1480], bandW: 150 };
const GROUP_LABELS = {
  service: "SERVICE MANAGEMENT",
  platform: "PLATFORM AND INTEGRATION",
  beyond: "BEYOND THE SERVICE DESK",
  experience: "EXPERIENCE",
};
const SUPPORT_LABEL = { yes: "Yes", partial: "Partial", no: "No" };

function supportMark(support, cx, cy, c) {
  if (support === "yes") {
    return `<circle cx="${cx}" cy="${cy}" r="13" fill="${c.yes}"/><path d="M${cx - 6} ${cy} l4 4.5 l8 -9" fill="none" stroke="${c.bg}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  if (support === "partial") {
    return `<circle cx="${cx}" cy="${cy}" r="11.5" fill="none" stroke="${c.partial}" stroke-width="3"/><path d="M${cx} ${cy - 11.5} A11.5 11.5 0 0 0 ${cx} ${cy + 11.5} Z" fill="${c.partial}"/>`;
  }
  if (support === "no") {
    return `<circle cx="${cx}" cy="${cy}" r="11.5" fill="none" stroke="${c.no}" stroke-width="2.5"/><line x1="${cx - 5}" x2="${cx + 5}" y1="${cy}" y2="${cy}" stroke="${c.no}" stroke-width="2.5" stroke-linecap="round"/>`;
  }
  return `<text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="16" fill="${c.muted}">not checked</text>`;
}

function legend(c) {
  const y = 196;
  return ["yes", "partial", "no"].map((s, i) => {
    const x = PAD + 14 + i * 170;
    return `${supportMark(s, x, y, c)}<text x="${x + 24}" y="${y + 7}" font-size="20" fill="${c.ink}">${SUPPORT_LABEL[s]}</text>`;
  }).join("");
}

function renderFeatures(data, c) {
  const { headerY, firstGroupY, groupH, rowH, colX, bandW } = MATRIX;
  const systems = systemsOf(data);
  const groups = Object.keys(GROUP_LABELS).map((key) => ({ key, features: data.features.filter((f) => f.group === key) }));
  let y = firstGroupY;
  const rows = groups.map(({ key, features }) => {
    const groupLabel = `<text x="${PAD}" y="${y + 38}" font-size="15" font-weight="700" letter-spacing="1.6" fill="${c.muted}">${GROUP_LABELS[key]}</text>`;
    y += groupH;
    return groupLabel + features.map((f) => {
      const mid = y + rowH / 2;
      const marks = systems.map((s, i) => supportMark(f.ratings[s.key].support, colX[i], mid, c)).join("");
      const line = `<line x1="${PAD}" x2="${W - PAD}" y1="${y + rowH}" y2="${y + rowH}" stroke="${c.rule}" stroke-width="1"/>`;
      y += rowH;
      return `<text x="${PAD}" y="${mid + 8}" font-size="23" fill="${c.ink}">${f.label}</text>${marks}${line}`;
    }).join("");
  }).join("");
  const bandTop = headerY - 44;
  const footerY = y + 44;
  const count = data.features.length;
  const yesCounts = systems.map((s) => `${s.name}: ${data.features.filter((f) => f.ratings[s.key].support === "yes").length} of ${count} fully supported`);
  return svg({
    title: "What each ITSM system covers",
    desc: `${yesCounts.join("; ")}. Rated ${monthOf(data)}.`,
    height: footerY + 40,
    c,
    body: `
  <rect x="${colX[0] - bandW / 2}" y="${bandTop}" width="${bandW}" height="${y - bandTop + 8}" rx="14" fill="${c.band}"/>${heading("What each system covers", `${count} capabilities, rated from what the UI, menus and documentation show · ${monthOf(data)}`, c)}
  ${legend(c)}
  ${systems.map((s, i) => `<text x="${colX[i]}" y="${headerY}" text-anchor="middle" font-size="24" font-weight="${s.key === "servio" ? 800 : 600}" fill="${s.key === "servio" ? c.servio : c.ink}">${s.name}</text>`).join("")}
  ${rows}
  <text x="${PAD}" y="${footerY + 4}" font-size="19" fill="${c.muted}">Ratings per edition used in the benchmark (community/free editions). Notes and sources for every cell: docs/benchmark.md</text>`,
  });
}

const data = JSON.parse(readFileSync(DIR + "results.json", "utf8"));
const CHARTS = { clicks: renderClicks, features: renderFeatures };
for (const [chart, render] of Object.entries(CHARTS)) {
  for (const [theme, colors] of Object.entries(THEMES)) {
    writeFileSync(`${DIR}${chart}-${theme}.svg`, render(data, colors));
    console.log(`wrote docs/benchmark/${chart}-${theme}.svg`);
  }
}
