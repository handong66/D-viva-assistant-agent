import { describe, it, expect } from "vitest";
import { recordingPath } from "./path";

describe("recordingPath", () => {
  it("builds recordings/<date>/<id>.<ext>, mapping the MediaRecorder mime to an extension", () => {
    expect(recordingPath("abc", "audio/webm;codecs=opus")).toMatch(/^\d{4}-\d{2}-\d{2}\/abc\.webm$/);
    expect(recordingPath("def", "audio/ogg;codecs=opus")).toMatch(/^\d{4}-\d{2}-\d{2}\/def\.ogg$/);
    expect(recordingPath("ghi", "audio/wav")).toMatch(/\/ghi\.wav$/);
    expect(recordingPath("x", "application/octet-stream")).toMatch(/\/x\.bin$/);
  });
});
