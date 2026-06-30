import { getUiCopy, type UiLocale } from "./ui-copy";

export type NextAction = { label: string; href: string };

export function recommendNextAction(
  stats: { prepTotal: number; practiceRuns: number; openReviews: number },
  aiReady: boolean,
  locale: UiLocale = "en",
): NextAction {
  const t = getUiCopy(locale).actions;
  if (stats.prepTotal === 0) {
    return aiReady
      ? { label: t.generatePrepPack, href: "/materials" }
      : { label: t.setupAi, href: "/library" };
  }
  if (stats.practiceRuns === 0) return { label: t.startPractice, href: "/practice" };
  if (stats.openReviews > 0) return { label: t.reviewWeak(stats.openReviews), href: "/review" };
  return { label: t.practiceAnother, href: "/practice" };
}
