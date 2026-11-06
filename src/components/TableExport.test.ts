import { describe, it, expect } from "vitest";
import { tableToTSV, tableToCSV, csvName } from "./TableExport";
import type { ColumnDef, Row } from "../types";

const cols = [{ name: "g", label: "Group", type: "categorical" },
              { name: "v", label: "Value", type: "numeric" }] as ColumnDef[];
const rows = [{ id: "1", g: "a, b", v: 1.5 }, { id: "2", g: "c\td", v: null }] as Row[];

describe("table export", () => {
  it("TSV: labels as header, tabs inside a value flattened, missing blank", () => {
    expect(tableToTSV(cols, rows)).toBe("Group\tValue\na, b\t1.5\nc d\t\n");
  });
  it("CSV: a comma is quoted", () => {
    expect(tableToCSV(cols, rows)).toBe('Group,Value\r\n"a, b",1.5\r\nc\td,\r\n');
  });
  it("names the file after the node", () => {
    expect(csvName("centroids · per Field")).toBe("centroids-per-Field.csv");
    expect(csvName("")).toBe("iris-table.csv");
  });
});
