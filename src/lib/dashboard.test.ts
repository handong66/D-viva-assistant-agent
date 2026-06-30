import { describe, it, expect } from "vitest";
import { recommendNextAction } from "./dashboard";

describe("recommendNextAction", () => {
  it("with no prep items: generate (AI ready) or set up AI", () => {
    expect(recommendNextAction({ prepTotal: 0, practiceRuns: 0, openReviews: 0 }, true)).toEqual({ label: "Generate a prep pack", href: "/materials" });
    expect(recommendNextAction({ prepTotal: 0, practiceRuns: 0, openReviews: 0 }, false)).toEqual({ label: "Set up AI to generate a prep pack", href: "/library" });
  });
  it("prep but no practice → practise", () => {
    expect(recommendNextAction({ prepTotal: 5, practiceRuns: 0, openReviews: 0 }, true)).toEqual({ label: "Start practising", href: "/practice" });
  });
  it("open reviews → review with count + plural", () => {
    expect(recommendNextAction({ prepTotal: 5, practiceRuns: 2, openReviews: 1 }, true)).toEqual({ label: "Review 1 weak spot", href: "/review" });
    expect(recommendNextAction({ prepTotal: 5, practiceRuns: 2, openReviews: 3 }, true)).toEqual({ label: "Review 3 weak spots", href: "/review" });
  });
  it("localizes recommendation labels for Chinese UI screenshots", () => {
    expect(recommendNextAction({ prepTotal: 5, practiceRuns: 2, openReviews: 3 }, true, "zh-CN")).toEqual({
      label: "复盘 3 个薄弱点",
      href: "/review",
    });
  });
  it("all caught up → practise more", () => {
    expect(recommendNextAction({ prepTotal: 5, practiceRuns: 2, openReviews: 0 }, true)).toEqual({ label: "Practise another question", href: "/practice" });
  });
});
