import { describe, it, expect, afterEach } from "vitest";
import { join, resolve } from "node:path";
import { recordingPath, recordingsRoot } from "./path";

const savedDir = process.env.RECORDINGS_DIR;
afterEach(() => {
  if (savedDir === undefined) delete process.env.RECORDINGS_DIR;
  else process.env.RECORDINGS_DIR = savedDir;
});

describe("recordingPath", () => {
  it("builds <date>/<id>.<ext>, mapping the MediaRecorder mime to an extension", () => {
    expect(recordingPath("abc", "audio/webm;codecs=opus")).toMatch(/^\d{4}-\d{2}-\d{2}\/abc\.webm$/);
    expect(recordingPath("def", "audio/ogg;codecs=opus")).toMatch(/^\d{4}-\d{2}-\d{2}\/def\.ogg$/);
    expect(recordingPath("ghi", "audio/wav")).toMatch(/\/ghi\.wav$/);
    expect(recordingPath("x", "application/octet-stream")).toMatch(/\/x\.bin$/);
  });
});

describe("recordingsRoot", () => {
  it("defaults to ./recordings when RECORDINGS_DIR is unset, blank, or whitespace", () => {
    const fallback = join(process.cwd(), "recordings");
    delete process.env.RECORDINGS_DIR;
    expect(recordingsRoot()).toBe(fallback);
    process.env.RECORDINGS_DIR = "";
    expect(recordingsRoot()).toBe(fallback);
    process.env.RECORDINGS_DIR = "   ";
    expect(recordingsRoot()).toBe(fallback);
  });
  it("resolves an explicit RECORDINGS_DIR to an absolute path", () => {
    process.env.RECORDINGS_DIR = "/tmp/viva-recordings";
    expect(recordingsRoot()).toBe(resolve("/tmp/viva-recordings"));
  });
});
