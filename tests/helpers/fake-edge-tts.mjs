#!/usr/bin/env node
// Stand-in for the edge-tts CLI in tests. FAKE_EDGE_TTS_MODE: "flaky" fails the first FAKE_EDGE_TTS_FAILS calls with
// NoAudioReceived (like the real service does), "403" mimics an outdated client, "invalid-voice" a permanent error.
// Every call is counted in FAKE_EDGE_TTS_COUNTER.
import fs from "node:fs";

const args = process.argv.slice(2);
const output = args[args.indexOf("--write-media") + 1];
const counterFile = process.env.FAKE_EDGE_TTS_COUNTER;
const calls = (counterFile && fs.existsSync(counterFile) ? Number(fs.readFileSync(counterFile, "utf8")) : 0) + 1;
if (counterFile) fs.writeFileSync(counterFile, String(calls));

const mode = process.env.FAKE_EDGE_TTS_MODE ?? "flaky";
const fail = (message) => {
  process.stderr.write(`Traceback (most recent call last):\n${message}\n`);
  process.exit(1);
};
if (mode === "403") fail("aiohttp.client_exceptions.WSServerHandshakeError: 403, message='Invalid response status'");
if (mode === "invalid-voice") fail("ValueError: Invalid voice 'xx-XX-Nobody'");
if (mode === "slow") setTimeout(() => {}, 60_000);
else if (calls <= Number(process.env.FAKE_EDGE_TTS_FAILS ?? 0)) {
  fail("edge_tts.exceptions.NoAudioReceived: No audio was received. Please verify that your parameters are correct.");
} else {
  fs.writeFileSync(output, Buffer.from("ID3fake-mp3-bytes"));
}
