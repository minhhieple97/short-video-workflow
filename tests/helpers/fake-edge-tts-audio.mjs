#!/usr/bin/env node
// Stand-in for the edge-tts CLI that writes a real MP3 as long as the text takes to read (about four syllables a
// second at --rate=+0%, shorter at a faster rate, at least one second), so the whole voice-over path (silence trim, probe, store) and the length checks can run. Every call is counted in FAKE_EDGE_TTS_COUNTER, and FAKE_EDGE_TTS_FAIL_ON makes a call fail when the text file
// it was given contains that marker.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const args = process.argv.slice(2);
const valueOf = (flag) => args[args.indexOf(flag) + 1];
const output = valueOf("--write-media");
const text = fs.readFileSync(valueOf("--file"), "utf8");

const counterFile = process.env.FAKE_EDGE_TTS_COUNTER;
if (counterFile) {
  const calls = (fs.existsSync(counterFile) ? Number(fs.readFileSync(counterFile, "utf8")) : 0) + 1;
  fs.writeFileSync(counterFile, String(calls));
}
const logFile = process.env.FAKE_EDGE_TTS_LOG;
if (logFile) fs.appendFileSync(logFile, `${text}\n`);

const marker = process.env.FAKE_EDGE_TTS_FAIL_ON;
if (marker && text.includes(marker)) {
  process.stderr.write("ValueError: Invalid voice 'xx-XX-Nobody'\n");
  process.exit(1);
}
const syllables = text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
const rate = Number(/^--rate=([+-]?\d+)%$/.exec(args.find((arg) => arg.startsWith("--rate=")) ?? "")?.[1] ?? 0);
const seconds = Math.max(1, Math.round((syllables / (4 * (1 + rate / 100))) * 10) / 10);
execFileSync("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-y",
  "-f",
  "lavfi",
  "-i",
  `sine=frequency=440:duration=${seconds}`,
  "-ar",
  "24000",
  "-ac",
  "1",
  output,
]);
