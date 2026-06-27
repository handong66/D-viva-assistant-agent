import { describe, it, expect } from "vitest";
import { defaultPlan, planPhase, currentDayNumber, TOTAL_DAYS } from "./plan";

describe("planPhase", () => {
  it("maps day ranges to the three phases", () => {
    expect(planPhase(1, TOTAL_DAYS).name).toBe("Build familiarity");
    expect(planPhase(5, TOTAL_DAYS).name).toBe("Build familiarity");
    expect(planPhase(6, TOTAL_DAYS).name).toBe("Drill the core");
    expect(planPhase(10, TOTAL_DAYS).name).toBe("Drill the core");
    expect(planPhase(11, TOTAL_DAYS).name).toBe("Polish under pressure");
    expect(planPhase(15, TOTAL_DAYS).name).toBe("Polish under pressure");
    expect(planPhase(99, TOTAL_DAYS).name).toBe("Polish under pressure"); // clamps past the end
    expect(planPhase(3, TOTAL_DAYS).activities.length).toBeGreaterThan(0);
  });

  it.each([3, 5, 10, 30])("covers all three phases for a %i-day plan", (totalDays) => {
    const phases = Array.from({ length: totalDays }, (_, i) => planPhase(i + 1, totalDays).name);
    expect(new Set(phases)).toEqual(new Set(["Build familiarity", "Drill the core", "Polish under pressure"]));
    expect(phases[0]).toBe("Build familiarity");
    expect(phases[phases.length - 1]).toBe("Polish under pressure");
  });
});

describe("defaultPlan", () => {
  it("produces TOTAL_DAYS numbered days, each with a phase + activities", () => {
    const days = defaultPlan();
    expect(days).toHaveLength(TOTAL_DAYS);
    expect(days[0]).toMatchObject({ day: 1, phase: "Build familiarity", title: "Day 1" });
    expect(days[14]).toMatchObject({ day: 15, phase: "Polish under pressure" });
    expect(days.every((d) => d.activities.length > 0)).toBe(true);
    // every day keeps the spec's daily structure: materials + practice + review
    expect(days.every((d) => {
      const hrefs = d.activities.map((a) => a.href);
      return hrefs.includes("/materials") && hrefs.includes("/practice") && hrefs.includes("/review");
    })).toBe(true);
  });
});

describe("currentDayNumber", () => {
  it("counts days since the start (1-based), clamped to [1, totalDays]", () => {
    expect(currentDayNumber("2026-06-26T10:00:00Z", 15, "2026-06-26T23:00:00Z")).toBe(1); // same day
    expect(currentDayNumber("2026-06-26", 15, "2026-06-29")).toBe(4);                     // 3 days later
    expect(currentDayNumber("2026-06-01", 15, "2026-12-01")).toBe(15);                    // clamped to totalDays
    expect(currentDayNumber("2026-06-12", 15, "2026-06-26")).toBe(15);                    // exactly 14 days later → last day
    expect(currentDayNumber("2026-06-11", 15, "2026-06-26")).toBe(15);                    // 15 days later → clamped (not 16)
    expect(currentDayNumber("2026-07-01", 15, "2026-06-29")).toBe(1);                     // future start → day 1
    expect(currentDayNumber("not-a-date", 15, "2026-06-29")).toBe(1);                     // bad start → day 1
    expect(currentDayNumber("2026-06-26", 15, "not-a-date")).toBe(1);                     // bad now → day 1
  });
});
