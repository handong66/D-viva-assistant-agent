import "server-only";
import type { Config } from "../config";
import { googleSttTransport } from "./google";
import { SttDisabledError, type SttTransport } from "./types";

function disabledTransport(): SttTransport {
  return {
    enabled: false,
    transcribe() {
      return Promise.reject(new SttDisabledError("STT is not configured"));
    },
  };
}

export function getSttTransport(config: Config, override?: SttTransport): SttTransport {
  if (override) return override;
  if (config.sttProvider === "google_cloud" && config.sttConfigured) return googleSttTransport();
  return disabledTransport();
}
