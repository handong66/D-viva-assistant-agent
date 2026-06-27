export type SttUiMode = "off" | "browser" | "google_cloud";

/** Resolve config to the answer-form's STT mode. google_cloud without a key can't record → off.
 *  browser needs no key. Pure — the practice page calls it server-side and passes the string to the client form. */
export function sttUiMode(c: { sttProvider: "off" | "browser" | "google_cloud"; sttConfigured: boolean }): SttUiMode {
  if (c.sttProvider === "google_cloud") return c.sttConfigured ? "google_cloud" : "off";
  return c.sttProvider; // "off" | "browser"
}
