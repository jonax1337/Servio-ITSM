import { describe, expect, it, vi } from "vitest";
import { convert } from "officeparser";

vi.mock("server-only", () => ({}));

const { extractText } = await import("@/lib/rag/extract");
const { renderFileHtml } = await import("@/lib/rag/render");

// Real Office files built from plain source text, so the test needs no binary fixtures.
async function makeXlsx(csv: string): Promise<Buffer> {
  const { value } = await convert(Buffer.from(csv), "xlsx", { parseConfig: { fileType: "csv" } });
  return Buffer.from(value);
}

async function makePptx(markdown: string): Promise<Buffer> {
  const { value } = await convert(Buffer.from(markdown), "pptx", { parseConfig: { fileType: "md" } });
  return Buffer.from(value);
}

/** A one-page PDF that shows `text` (officeparser would need puppeteer or pdf-lib to write one). */
function makePdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const SLIDE = "# Quarterly review\n\nINC-42 was resolved.\n";

describe("extractText", () => {
  it("reads the cells of an xlsx sheet", async () => {
    const xlsx = await makeXlsx("Name,Ticket\nAlice,INC-42\n");
    const text = await extractText(xlsx, "", "sheet.xlsx");
    expect(text).toContain("Alice");
    expect(text).toContain("INC-42");
  });

  it("reads the text of a pptx slide", async () => {
    const pptx = await makePptx(SLIDE);
    expect(await extractText(pptx, "", "deck.pptx")).toContain("INC-42 was resolved.");
  });

  it("reads the text of a pdf", async () => {
    const pdf = makePdf("Restart the mail relay.");
    expect(await extractText(pdf, "application/pdf", "runbook.pdf")).toContain("Restart the mail relay.");
  });

  it("returns an empty string for an Office file it cannot parse", async () => {
    expect(await extractText(Buffer.from("not a zip"), "", "broken.pptx")).toBe("");
  });
});

describe("renderFileHtml", () => {
  it("previews a pptx as its extracted text", async () => {
    const pptx = await makePptx(SLIDE);
    const rendered = await renderFileHtml({ buf: pptx, mime: "", name: "deck.pptx" });
    expect(rendered).toMatchObject({ kind: "html" });
    expect(rendered.kind === "html" ? rendered.html : "").toContain("INC-42 was resolved.");
  });
});
