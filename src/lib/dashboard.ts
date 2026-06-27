export type NextAction = { label: string; href: string };

export function recommendNextAction(
  stats: { prepTotal: number; practiceRuns: number; openReviews: number },
  aiReady: boolean,
): NextAction {
  if (stats.prepTotal === 0) {
    return aiReady
      ? { label: "Generate a prep pack", href: "/materials" }
      : { label: "Set up AI to generate a prep pack", href: "/library" };
  }
  if (stats.practiceRuns === 0) return { label: "Start practising", href: "/practice" };
  if (stats.openReviews > 0) return { label: `Review ${stats.openReviews} weak ${stats.openReviews === 1 ? "spot" : "spots"}`, href: "/review" };
  return { label: "Practise another question", href: "/practice" };
}
