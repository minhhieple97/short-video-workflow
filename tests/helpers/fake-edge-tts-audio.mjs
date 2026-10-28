#!/usr/bin/env node
// Stand-in for the edge-tts CLI that writes a real, short MP3, so the whole voice-over path (silence trim, probe, store)
// can run. Every call is counted in FAKE_EDGE_TTS_COUNTER, and FAKE_EDGE_TTS_FAIL_ON makes a call fail when the text file
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
execFileSync("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-y",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=1",
  "-ar",
  "24000",
  "-ac",
  "1",
  output,
]);
