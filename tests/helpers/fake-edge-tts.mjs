#!/usr/bin/env node
// Stand-in for edge-tts-words.py in tests, run in place of its Python (EDGE_TTS_PYTHON): the script path arrives as the first
// argument and is ignored. FAKE_EDGE_TTS_MODE: "flaky" fails the first FAKE_EDGE_TTS_FAILS calls with
// NoAudioReceived (like the real service does), "403" mimics an outdated client, "invalid-voice" a permanent error.
// Every call is counted in FAKE_EDGE_TTS_COUNTER.
import fs from "node:fs";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("edge-tts 7.3.1 (fake)\n");
  process.exit(0);
}
const output = args[args.indexOf("--write-media") + 1];
const boundaries = args.includes("--write-boundaries") ? args[args.indexOf("--write-boundaries") + 1] : null;
const counterFile = process.env.FAKE_EDGE_TTS_COUNTER;
const calls = (counterFile && fs.existsSync(counterFile) ? Number(fs.readFileSync(counterFile, "utf8")) : 0) + 1;
if (counterFile) fs.writeFileSync(counterFile, String(calls));

const mode = process.env.FAKE_EDGE_TTS_MODE ?? "flaky";
const fail = (message) => {
  process.stderr.write(`Traceback (most recent call last):\n${message}\n`);
  process.exit(1);
};
if (mode === "no-module") {
  process.stderr.write("EdgeTtsModuleMissing: this Python has no edge_tts module\n");
  process.exit(3);
}
if (mode === "403") fail("aiohttp.client_exceptions.WSServerHandshakeError: 403, message='Invalid response status'");
if (mode === "invalid-voice") fail("ValueError: Invalid voice 'xx-XX-Nobody'");
if (mode === "slow") setTimeout(() => {}, 60_000);
else if (calls <= Number(process.env.FAKE_EDGE_TTS_FAILS ?? 0)) {
  fail("edge_tts.exceptions.NoAudioReceived: No audio was received. Please verify that your parameters are correct.");
} else {
  fs.writeFileSync(output, Buffer.from("ID3fake-mp3-bytes"));
  if (boundaries) {
    const words = fs
      .readFileSync(args[args.indexOf("--file") + 1], "utf8")
      .split(/\s+/)
      .filter(Boolean);
    const events = words.map((text, index) => ({
      text: text.replace(/[^\p{L}\p{N}]/gu, ""),
      offset: (1 + index * 3) * 1e6,
      duration: 2.5e6,
    }));
    fs.writeFileSync(
      boundaries,
      process.env.FAKE_EDGE_TTS_BOUNDARIES === "broken" ? "{not json" : JSON.stringify(events),
    );
  }
}
