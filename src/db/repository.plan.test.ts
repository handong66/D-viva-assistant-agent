import { describe, expect, it } from "vitest";
import { makeTestDb } from "../test/db";
import { getActivePlan, getThesisSections, insertThesisWithChunks, savePlan } from "./repository";

const chunk = (ord: number, section: string | undefined, text: string) => ({
  ord,
  section,
  text,
  charStart: 0,
  charEnd: text.length,
  hash: `h${ord}`,
});

describe("plan repository", () => {
  it("round-trips a saved plan through getActivePlan", () => {
    const db = makeTestDb();
    insertThesisWithChunks(db, {
      thesis: { id: "t1", title: "T", source_kind: "md" },
      chunks: [chunk(0, "Intro", "intro text")],
    });

    const id = savePlan(db, {
      thesisId: "t1",
      name: "5-day plan",
      totalDays: 5,
      templateKey: "ai",
      days: [
        { dayNo: 1, title: "Day 1 - Foundations", focus: "Focus: Intro", activities: ["Read", "Practice"] },
        { dayNo: 2, title: "Day 2 - Review", focus: "General review", activities: ["Review"] },
      ],
    });

    expect(getActivePlan(db, "t1")).toMatchObject({
      id,
      name: "5-day plan",
      totalDays: 5,
      templateKey: "ai",
      days: [
        { dayNo: 1, title: "Day 1 - Foundations", focus: "Focus: Intro", activities: ["Read", "Practice"] },
        { dayNo: 2, title: "Day 2 - Review", focus: "General review", activities: ["Review"] },
      ],
    });
    expect(getActivePlan(db, "t1")?.createdAt).toEqual(expect.any(String));
    db.close();
  });

  it("replaces the prior active plan for a thesis on second save", () => {
    const db = makeTestDb();
    insertThesisWithChunks(db, {
      thesis: { id: "t1", title: "T", source_kind: "md" },
      chunks: [chunk(0, "Intro", "intro text")],
    });

    savePlan(db, {
      thesisId: "t1",
      name: "old",
      totalDays: 3,
      templateKey: "static",
      days: [{ dayNo: 1, title: "Old day", focus: "Old", activities: ["Old activity"] }],
    });
    savePlan(db, {
      thesisId: "t1",
      name: "new",
      totalDays: 4,
      templateKey: "ai",
      days: [
        { dayNo: 1, title: "New day 1", focus: "New", activities: ["New activity"] },
        { dayNo: 2, title: "New day 2", focus: "New", activities: ["Another activity"] },
      ],
    });

    const plan = getActivePlan(db, "t1");
    expect(plan).toMatchObject({ name: "new", totalDays: 4, templateKey: "ai" });
    expect(plan?.days).toHaveLength(2);
    expect((db.prepare("SELECT count(*) c FROM plan WHERE thesis_id = 't1'").get() as { c: number }).c).toBe(1);
    expect((db.prepare("SELECT count(*) c FROM plan_day").get() as { c: number }).c).toBe(2);
    db.close();
  });

  it("returns distinct thesis sections in document order", () => {
    const db = makeTestDb();
    insertThesisWithChunks(db, {
      thesis: { id: "t1", title: "T", source_kind: "md" },
      chunks: [
        chunk(0, "Introduction", "intro"),
        chunk(1, "Methods", "methods"),
        chunk(2, "Introduction", "more intro"),
        chunk(3, "Results", "results"),
        chunk(4, undefined, "unsectioned"),
      ],
    });

    expect(getThesisSections(db, "t1")).toEqual(["Introduction", "Methods", "Results"]);
    db.close();
  });
});
