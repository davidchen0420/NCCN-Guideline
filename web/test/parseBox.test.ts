import { describe, expect, it } from "vitest";
import { parseBox, parseInline } from "../src/lib/parseBox";

const kinds = (s: string) => parseBox(s).blocks.map((b) => b.t);

describe("parseBox", () => {
  it("keeps a plain sentence as one paragraph", () => {
    const p = parseBox("Biochemical recurrence");
    expect(p.blocks).toEqual([{ t: "para", inline: [{ t: "text", v: "Biochemical recurrence" }] }]);
  });

  it("splits bullets and links the page reference", () => {
    const p = parseBox("• Perform check A • Estimate the score (Principles of Example Scoring [PROS-A]) • Assess outcome measures");
    expect(kinds("• a • b")).toEqual(["list"]);
    const list = p.blocks[0];
    expect(list.t).toBe("list");
    if (list.t === "list") {
      expect(list.items).toHaveLength(3);
      const links = list.items[1].inline.filter((x) => x.t === "link");
      expect(links).toEqual([{ t: "link", code: "PROS-A", text: "Principles of Example Scoring", label: "PROS-A", idx: undefined }]);
    }
    expect(p.refs).toEqual(["PROS-A"]);
  });

  it("nests sub-bullets under their parent and keeps tier headings", () => {
    const p = parseBox("Therapy X with one of the following: • Preferred: \u0017Alphadrug (category 1) \u0017Betadrug (category 1) • Other Recommended: \u0017Deltadrug (category 2B)");
    expect(p.blocks[0].t).toBe("lead");
    const tiers = p.blocks.filter((b) => b.t === "tier");
    expect(tiers.map((b) => (b as { label: string }).label)).toEqual(["Preferred", "Other Recommended"]);
    const lists = p.blocks.filter((b) => b.t === "list");
    expect(lists).toHaveLength(2);
    expect(p.tags).toEqual(expect.arrayContaining(["Preferred", "Other Recommended", "Category 1", "Category 2B"]));
  });

  it("turns alternative regimens into 'or' dividers", () => {
    const p = parseBox("Deltadrug (category 2B) or ADT with docetaxel and one of the following (low-volume disease only):");
    expect(p.blocks.map((b) => b.t)).toContain("or");
  });

  it("does not split 'or' inside parentheses", () => {
    expect(kinds("Example condition (Type 1, Group A or Type 2, Group B)")).toEqual(["para"]);
  });

  it("turns a title followed by a page reference into a link", () => {
    expect(parseInline("Routine review Example Review Program (PROS-F 2 of 5)")).toEqual([
      { t: "text", v: "Routine review " },
      { t: "link", code: "PROS-F", text: "Example Review Program", label: "PROS-F 2", idx: 2 },
    ]);
    expect(parseInline("Estimate the score (Principles of Example Scoring [PROS-A])")).toEqual([
      { t: "text", v: "Estimate the score " },
      { t: "link", code: "PROS-A", text: "Principles of Example Scoring", label: "PROS-A", idx: undefined },
    ]);
  });

  it("keeps sibling items at the same depth under a tier", () => {
    const p = parseBox("• Preferred: \u0017Alphadrug \u0017Betadrug \u0017Gammadrug");
    const list = p.blocks.find((b) => b.t === "list");
    expect(list && list.t === "list" && list.items.map((i) => i.children.length)).toEqual([0, 0, 0]);
  });

  it("splits a tier name glued to the end of an item", () => {
    const p = parseBox("Preferred: • Etadrug • Epsilondrug rechallenge Useful in Certain Circumstances: • Marker-Directed Therapy");
    expect(p.blocks.filter((b) => b.t === "tier")).toHaveLength(2);
  });

  it("recognises category and preference tags", () => {
    expect(parseInline("Olaparib (category 1)")).toEqual([
      { t: "text", v: "Olaparib " },
      { t: "tag", label: "Category 1", kind: "cat" },
    ]);
  });
});
