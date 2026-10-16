import { describe, expect, it } from "vitest";
import { stripMarks } from "../src/lib/adapt";

describe("stripMarks", () => {
  it("removes footnote marks glued to words printed in capitals", () => {
    expect(stripMarks("INDUCTIONe,f,g")).toBe("INDUCTION");
    expect(stripMarks("CLINICAL PRESENTATIONa")).toBe("CLINICAL PRESENTATION");
    expect(stripMarks("(Staging, ST-1)a")).toBe("(Staging, ST-1)");
    expect(stripMarks("SURVEILLANCEvv and follow-up")).toBe("SURVEILLANCE and follow-up");
  });
  it("keeps ordinary words and staging codes", () => {
    for (const s of ["Low", "High", "Very high", "cT1c", "T1c", "M1b", "N1", "Stage IIIA", "PSA <10 ng/mL", "Grade Group 2"]) expect(stripMarks(s)).toBe(s);
  });
});
