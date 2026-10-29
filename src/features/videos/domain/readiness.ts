import { runPreflight, type PreflightInput, type PreflightIssue } from "./preflight";

export interface ReadinessInput extends PreflightInput {
  // One entry per lesson snapshot of the video: whether it still carries a source excerpt.
  lessons: readonly { hasSourceExcerpt: boolean }[];
}

export interface ReadinessReport {
  ready: boolean;
  issues: PreflightIssue[];
}

// Automated stand-in for the person who approved a script: it decides whether a FINAL render may go ahead. It applies
// every blocking rule of the FINAL preflight (hook within 4 s by the real audio, total within the range's maximum, hook
// and text present), holds the range's minimum too (a person may accept a short video, a batch does not), and adds two
// rules that only make sense once voicing is done: every visible scene has audio, and every lesson still has a source
// excerpt. The preflight's own approval gate is what is being decided here, so it is skipped.
export function assessReadiness(input: ReadinessInput): ReadinessReport {
  const preflight = runPreflight({ ...input, autoReady: true }, "FINAL");
  const issues: PreflightIssue[] = [
    ...preflight.blocking,
    ...preflight.warnings.filter((warning) => warning.code === "UNDER_MIN"),
  ];

  const silent = input.scenes.filter((scene) => !scene.hidden && !scene.audioAssetId).length;
  if (silent > 0) {
    issues.push({ code: "AUDIO_NOT_READY", message: `${silent} cảnh hiển thị chưa có giọng đọc.` });
  }
  if (input.lessons.length === 0 || input.lessons.some((lesson) => !lesson.hasSourceExcerpt)) {
    issues.push({ code: "SOURCE_MISSING", message: "Có bài học không còn trích đoạn nguồn trong sách." });
  }
  return { ready: issues.length === 0, issues };
}
