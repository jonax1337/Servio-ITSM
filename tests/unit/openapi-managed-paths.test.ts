import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/v1/openapi/route";

describe("OpenAPI spec", () => {
  it("documents the catalog item, change template, contract and vendor endpoints", async () => {
    const spec = (await GET().json()) as { paths: Record<string, Record<string, { requestBody?: { content: Record<string, { schema: { properties?: Record<string, unknown> } }> } }>> };
    for (const base of ["catalog-items", "change-templates", "contracts", "vendors"]) {
      expect(Object.keys(spec.paths[`/${base}`])).toEqual(["get", "post"]);
      expect(Object.keys(spec.paths[`/${base}/{id}`])).toEqual(["get", "patch", "delete"]);
      expect(Object.keys(spec.paths[`/${base}/ref/{ref}`])).toEqual(["get", "put"]);
    }
    const catalog = spec.paths["/catalog-items"].post.requestBody!.content["application/json"].schema.properties!;
    expect(Object.keys(catalog)).toEqual(expect.arrayContaining(["service_id", "category_id", "group_id", "ticket_type", "title_template", "questions", "import_ref"]));
    const contract = spec.paths["/contracts"].post.requestBody!.content["application/json"].schema.properties!;
    expect(Object.keys(contract)).toEqual(expect.arrayContaining(["vendor_id", "owner_id", "renewal_notice_days", "auto_renew", "asset_ids", "import_ref"]));
  });
});
