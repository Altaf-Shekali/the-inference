"""
Kokoro TTS helper (CPU / ONNX) for the pipeline. Called by tts.mjs.

  python tts-kokoro.py --voice am_michael --text-file in.txt --out out.wav

Reads the narration from a file (avoids CLI encoding issues), synthesizes with
Kokoro, writes a WAV, and prints {"duration": seconds, "sampleRate": hz} as JSON.
Apache-2.0 model — free for commercial use. No GPU required.
"""
import argparse
import json
import os
import sys

import soundfile as sf
from kokoro_onnx import Kokoro

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="am_michael")
    ap.add_argument("--text-file", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--model", default=os.path.join(HERE, "kokoro", "kokoro-v1.0.onnx"))
    ap.add_argument("--voices", default=os.path.join(HERE, "kokoro", "voices-v1.0.bin"))
    a = ap.parse_args()

    with open(a.text_file, "r", encoding="utf-8") as f:
        text = f.read().strip()
    if not text:
        print(json.dumps({"error": "empty text"}))
        sys.exit(1)

    kokoro = Kokoro(a.model, a.voices)
    samples, sample_rate = kokoro.create(text, voice=a.voice, speed=a.speed, lang="en-us")
    sf.write(a.out, samples, sample_rate)
    print(json.dumps({"duration": len(samples) / sample_rate, "sampleRate": int(sample_rate)}))


if __name__ == "__main__":
    main()
