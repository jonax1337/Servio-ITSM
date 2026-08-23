import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";

describe("toCsv", () => {
  it("serialises rows with a header", () => {
    expect(toCsv([{ a: 1, b: "x" }])).toBe("a,b\r\n1,x");
  });

  it("quotes cells containing separators, quotes or newlines", () => {
    expect(toCsv([{ msg: 'a "quoted", value' }])).toBe('msg\r\n"a ""quoted"", value"');
    expect(toCsv([{ line: "row1\nrow2" }])).toBe('line\r\n"row1\nrow2"');
  });

  it("renders null/undefined as empty cells", () => {
    expect(toCsv([{ a: null, b: undefined }])).toBe("a,b\r\n,");
  });

  it("honours an explicit column order and fills missing cells", () => {
    expect(toCsv([{ b: 2, extra: "z" }], ["a", "b"])).toBe("a,b\r\n,2");
  });

  it("unifies columns across heterogeneous rows", () => {
    expect(toCsv([{ a: 1 }, { b: 2 }])).toBe("a,b\r\n1,\r\n,2");
  });
});
