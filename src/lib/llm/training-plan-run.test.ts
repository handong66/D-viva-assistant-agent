import { describe, expect, it } from "vitest";
import { getActivePlan, insertThesisWithChunks } from "../../db/repository";
import { makeTestDb } from "../../test/db";
import { ACTION_LABEL, PLAN_ACTIONS } from "./training-plan";
import { runTrainingPlanGeneration } from "./training-plan-run";
import { MockLlmClient } from "./mock";

const chunk = (ord: number, section: string, text: string) => ({
  ord,
  section,
  text,
  charStart: 0,
  charEnd: text.length,
  hash: `h${ord}`,
});

function seed() {
  const db = makeTestDb();
  insertThesisWithChunks(db, {
    thesis: { id: "t1", title: "Thesis", source_kind: "md" },
    chunks: [
      chunk(0, "Introduction", "intro text"),
      chunk(1, "Methods", "methods text"),
      chunk(2, "Results", "results text"),
    ],
  });
  return db;
}

describe("runTrainingPlanGeneration", () => {
  it("saves clean LLM output as an AI plan: fixed-label titles + fixed action-label activities", async () => {
    const db = seed();
    const mock = new MockLlmClient().setObject("training_plan", {
      days: [
        { themeKey: "orientation", sectionFocus: ["Introduction"], actions: [PLAN_ACTIONS.READ_SECTION, PLAN_ACTIONS.MOCK_QUESTION] },
        { themeKey: "methods_focus", sectionFocus: ["Methods"], actions: [PLAN_ACTIONS.WRITE_ANSWER] },
        { themeKey: "rehearsal", sectionFocus: ["Results"], actions: [PLAN_ACTIONS.REHEARSE_OUT_LOUD] },
      ],
    });

    await expect(runTrainingPlanGeneration({ db, llmClient: mock, totalDays: 3, thesisId: "t1" })).resolves.toEqual({ source: "ai" });

    const plan = getActivePlan(db, "t1");
    expect(plan?.templateKey).toBe("ai");
    expect(plan?.days).toHaveLength(3);
    // title comes from the FIXED label map, never model free text
    expect(plan?.days[0]?.title).toBe("Day 1 - Orientation & overview");
    expect(plan?.days[0]?.activities).toEqual([
      ACTION_LABEL[PLAN_ACTIONS.READ_SECTION],
      ACTION_LABEL[PLAN_ACTIONS.MOCK_QUESTION],
    ]);
    db.close();
  });

  it("drops invented sectionFocus entries before saving the rendered day", async () => {
    const db = seed();
    const mock = new MockLlmClient().setObject("training_plan", {
      days: [
        { themeKey: "orientation", sectionFocus: ["Introduction", "Invented"], actions: [PLAN_ACTIONS.READ_SECTION] },
        { themeKey: "practice_drills", sectionFocus: ["Methods"], actions: [PLAN_ACTIONS.MOCK_QUESTION] },
        { themeKey: "weak_spots", sectionFocus: ["Results"], actions: [PLAN_ACTIONS.REVIEW_NOTES] },
      ],
    });

    await runTrainingPlanGeneration({ db, llmClient: mock, totalDays: 3, thesisId: "t1" });

    const plan = getActivePlan(db, "t1");
    expect(plan?.days[0]?.focus).toBe("Focus: Introduction");
    expect(plan?.days[0]?.focus).not.toContain("Invented");
    db.close();
  });

  it("pads short output to N days and truncates long output to N days", async () => {
    const shortDb = seed();
    const shortMock = new MockLlmClient().setObject("training_plan", {
      days: [
        { themeKey: "orientation", sectionFocus: ["Introduction"], actions: [PLAN_ACTIONS.READ_SECTION] },
        { themeKey: "practice_drills", sectionFocus: ["Methods"], actions: [PLAN_ACTIONS.MOCK_QUESTION] },
      ],
    });

    await runTrainingPlanGeneration({ db: shortDb, llmClient: shortMock, totalDays: 4, thesisId: "t1" });
    const padded = getActivePlan(shortDb, "t1");
    expect(padded?.days).toHaveLength(4);
    expect(padded?.days[2]).toMatchObject({
      dayNo: 3,
      title: "Day 3 - Review & rehearse",
      activities: [
        ACTION_LABEL[PLAN_ACTIONS.REVIEW_NOTES],
        ACTION_LABEL[PLAN_ACTIONS.REHEARSE_OUT_LOUD],
      ],
    });
    shortDb.close();

    const longDb = seed();
    const longMock = new MockLlmClient().setObject("training_plan", {
      days: [
        { themeKey: "orientation", sectionFocus: ["Introduction"], actions: [PLAN_ACTIONS.READ_SECTION] },
        { themeKey: "methods_focus", sectionFocus: ["Methods"], actions: [PLAN_ACTIONS.MOCK_QUESTION] },
        { themeKey: "rehearsal", sectionFocus: ["Results"], actions: [PLAN_ACTIONS.REVIEW_NOTES] },
        { themeKey: "final_polish", sectionFocus: ["Results"], actions: [PLAN_ACTIONS.REHEARSE_OUT_LOUD] },
      ],
    });

    await runTrainingPlanGeneration({ db: longDb, llmClient: longMock, totalDays: 3, thesisId: "t1" });
    const truncated = getActivePlan(longDb, "t1");
    expect(truncated?.days).toHaveLength(3);
    expect(truncated?.days.map((day) => day.title)).toEqual([
      "Day 1 - Orientation & overview",
      "Day 2 - Methods focus",
      "Day 3 - Rehearsal",
    ]);
    longDb.close();
  });
});
