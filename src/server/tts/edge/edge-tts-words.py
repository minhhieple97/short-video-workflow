"""Voices a text with edge-tts and records when each word is spoken.

Called by edge-tts-provider.ts with an argument list (never a shell):
  python edge-tts-words.py --voice V --rate=+0% --file TEXT --write-media OUT.mp3 --write-boundaries OUT.json
  python edge-tts-words.py --version
The edge-tts command-line tool only reports sentence timings, so this uses its Python API, asking for word boundaries.
Offsets and durations are written as the service sends them (100-ns ticks of the audio written). Errors are left to
propagate so their traceback reaches the caller, which tells passing service failures from permanent ones.
"""

import argparse
import asyncio
import json
import sys

try:
    import edge_tts
except ImportError:
    sys.stderr.write("EdgeTtsModuleMissing: this Python has no edge_tts module\n")
    sys.exit(3)


def communicate(text, voice, rate):
    try:
        return edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
    except TypeError:
        # edge-tts 6 had no boundary choice and always sent word boundaries.
        return edge_tts.Communicate(text, voice, rate=rate)


async def synthesize(args):
    with open(args.file, encoding="utf-8") as source:
        text = source.read()
    boundaries = []
    with open(args.write_media, "wb") as media:
        async for chunk in communicate(text, args.voice, args.rate).stream():
            if chunk["type"] == "audio":
                media.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                boundaries.append({"text": chunk["text"], "offset": chunk["offset"], "duration": chunk["duration"]})
    with open(args.write_boundaries, "w", encoding="utf-8") as output:
        json.dump(boundaries, output, ensure_ascii=False)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", action="store_true")
    parser.add_argument("--voice")
    parser.add_argument("--rate", default="+0%")
    parser.add_argument("--file")
    parser.add_argument("--write-media")
    parser.add_argument("--write-boundaries")
    args = parser.parse_args()
    if args.version:
        print(f"edge-tts {getattr(edge_tts, '__version__', 'unknown')}")
        return
    if not (args.voice and args.file and args.write_media and args.write_boundaries):
        parser.error("--voice, --file, --write-media and --write-boundaries are required")
    asyncio.run(synthesize(args))


if __name__ == "__main__":
    main()
