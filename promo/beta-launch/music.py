"""宣伝動画の音。すべてここで合成する（既存の楽曲・音源は使わない）。

静かな和音の広がり（パッド）と低音、ときどき鳴る鈴の音に、画面の出来事
（カードが出る・軸が切り替わる・クリック）に合わせた小さな効果音を重ねる。
出来事の時刻は record.mjs が out/timeline.json に書いたものを使う。

    python promo/beta-launch/music.py
"""
import json
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
SR = 48_000
rng = np.random.default_rng(7)

timeline = json.loads((OUT / "timeline.json").read_text(encoding="utf-8"))
DURATION = float(timeline["duration"]) + 0.6
N = int(DURATION * SR)
t = np.arange(N) / SR
left = np.zeros(N)
right = np.zeros(N)


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def add(signal, start, gain_l, gain_r=None):
    """signal を start 秒から左右に足す"""
    gain_r = gain_l if gain_r is None else gain_r
    i = int(start * SR)
    if i >= N:
        return
    j = min(N, i + len(signal))
    left[i:j] += signal[: j - i] * gain_l
    right[i:j] += signal[: j - i] * gain_r


def envelope(length, attack, release):
    n = int(length * SR)
    env = np.ones(n)
    a = max(1, int(attack * SR))
    r = max(1, int(release * SR))
    env[:a] = np.linspace(0, 1, a) ** 2
    env[-r:] *= np.linspace(1, 0, r) ** 2
    return env


# ── パッド：D を中心にした、やわらかい 4 つの和音をゆっくり回す ─────────────
CHORDS = [
    [50, 57, 62, 66, 69, 73],  # Dmaj9
    [47, 54, 59, 62, 66, 69],  # Bm11
    [43, 50, 55, 59, 62, 66],  # Gmaj9
    [45, 52, 57, 61, 64, 71],  # A(add9)
]
STEP = 3.4
k = 0
start = 0.0
while start < DURATION:
    chord = CHORDS[k % len(CHORDS)]
    length = STEP + 1.8
    n = int(length * SR)
    tt = np.arange(n) / SR
    env = envelope(length, 1.4, 1.8)
    for idx, note in enumerate(chord):
        f = hz(note + 12 if idx >= 3 else note)
        # 左右でわずかに音程をずらして広がりを出す
        for side, detune in ((0, -0.0016), (1, 0.0016)):
            fs = f * (1 + detune)
            voice = np.sin(2 * np.pi * fs * tt) + 0.28 * np.sin(2 * np.pi * 2 * fs * tt + 0.3) + 0.07 * np.sin(2 * np.pi * 3 * fs * tt)
            voice *= env * (0.05 if idx >= 3 else 0.065)
            add(voice, start, 1.0 if side == 0 else 0.0, 0.0 if side == 0 else 1.0)
    # 低音
    bass = np.sin(2 * np.pi * hz(chord[0] - 12) * tt) * env * 0.11
    add(bass, start, 0.9)
    start += STEP
    k += 1


# ── 鈴：和音にそった音を、ときどき左右に散らして鳴らす ─────────────────
def bell(freq, length=1.6, gain=0.06):
    n = int(length * SR)
    tt = np.arange(n) / SR
    decay = np.exp(-tt * 3.2)
    tone = np.sin(2 * np.pi * freq * tt) + 0.35 * np.sin(2 * np.pi * freq * 2.76 * tt) * np.exp(-tt * 6)
    return tone * decay * gain


PENTA = [74, 76, 78, 81, 83, 86, 88]
s = 1.2
while s < DURATION - 3:
    note = PENTA[int(rng.integers(0, len(PENTA)))]
    pan = float(rng.uniform(0.2, 0.8))
    add(bell(hz(note)), s, 1 - pan, pan)
    s += float(rng.choice([0.85, 1.7, 2.55]))


# ── 画面の出来事に合わせた小さな音 ───────────────────────────
def pop(freq):
    length = 0.5
    n = int(length * SR)
    tt = np.arange(n) / SR
    env = np.exp(-tt * 9) * (1 - np.exp(-tt * 900))
    return (np.sin(2 * np.pi * freq * tt) + 0.5 * np.sin(2 * np.pi * freq * 2 * tt)) * env * 0.16


def click():
    n = int(0.03 * SR)
    noise = rng.normal(0, 1, n)
    noise = np.convolve(noise, np.ones(6) / 6, mode="same")
    return noise * np.exp(-np.arange(n) / SR * 160) * 0.12


def whoosh(length=1.1):
    n = int(length * SR)
    tt = np.arange(n) / SR
    noise = rng.normal(0, 1, n)
    # 帯域を狭めたざわめき：なめらかにしたものから、さらになめらかにしたものを引く
    soft = np.convolve(noise, np.hanning(40) / 20, mode="same")
    softer = np.convolve(noise, np.hanning(400) / 200, mode="same")
    band = soft - softer
    sweep = np.sin(2 * np.pi * np.cumsum(np.linspace(260, 820, n)) / SR) * 0.25
    env = np.sin(np.pi * np.clip(tt / length, 0, 1)) ** 2
    return (band + sweep) * env * 0.09


pops = 0
for event in timeline.get("events", []):
    at = float(event["t"])
    kind = event["kind"]
    if kind == "pop":
        freq = hz(PENTA[pops % len(PENTA)])
        pops += 1
        add(pop(freq), at, 0.55, 0.45)
    elif kind == "click":
        add(click(), at, 0.5)
    elif kind == "whoosh":
        add(whoosh(), max(0.0, at - 0.2), 0.45, 0.55)

# ── 仕上げ：出だしと終わりをなだらかに、音量をそろえる ─────────────────
fade_in = int(1.0 * SR)
fade_out = int(2.6 * SR)
master = np.ones(N)
master[:fade_in] = np.linspace(0, 1, fade_in) ** 1.5
master[-fade_out:] = np.linspace(1, 0, fade_out) ** 1.3
left *= master
right *= master
mix = np.stack([left, right], axis=1)
mix = np.tanh(mix * 1.6) / 1.6  # 角を丸める
mix *= 0.56 / max(1e-9, float(np.max(np.abs(mix))))  # 最大でおよそ -5 dBFS
pcm = (mix * 32767).astype("<i2")

path = OUT / "music.wav"
with wave.open(str(path), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
cues = sum(1 for e in timeline.get("events", []) if e["kind"] in ("pop", "click", "whoosh"))
print(f"music: {path} ({DURATION:.1f}s, {cues} sound cues)")
