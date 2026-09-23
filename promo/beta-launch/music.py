"""宣伝動画の音。すべてここで合成する（既存の楽曲・音源は使わない）。

静かな和音の広がり（パッド）と低音、ときどき鳴る鈴の音に、画面の出来事
（カードが出る・軸が切り替わる・クリック）に合わせた小さな効果音を重ねる。
出来事の時刻は record.mjs が out/timeline.json に書いたものを使う。

    python promo/beta-launch/music.py
    python promo/beta-launch/music.py out/edit-landscape.json out/music-60s.wav   （1分版）

1分版では、導入アニメーションの間は張りつめた音（鼓動・ざわめき・通知音が増えていく）にし、
混沌が整列するところで和音に解き放つ。
"""
import json
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
SR = 48_000
rng = np.random.default_rng(7)

import sys

# 編集版があればその長さと目印を、無ければ録画そのものを使う
EDIT = Path(sys.argv[1]) if len(sys.argv) > 1 else None
WAV = Path(sys.argv[2]) if len(sys.argv) > 2 else OUT / "music.wav"
if EDIT:
    edit = json.loads((HERE / EDIT if not EDIT.is_absolute() else EDIT).read_text(encoding="utf-8"))
    timeline = {"duration": edit["duration"], "events": edit["cues"]}
else:
    timeline = json.loads((OUT / "timeline.json").read_text(encoding="utf-8"))
beats = {e["kind"][6:]: float(e["t"]) for e in timeline.get("events", []) if e["kind"].startswith("intro-")}
CALM_FROM = beats.get("order", 0.0)  # ここから穏やかな和音
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
start = max(0.0, CALM_FROM - 0.3)
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
s = max(1.2, CALM_FROM + 1.0)
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


# ── 導入：張りつめた音 → 解き放つ ─────────────────────────
if beats:
    ai, drain, collapse, order = beats["ai"], beats["drain"], beats["collapse"], beats["order"]

    def thump(freq=52, length=0.35, gain=0.32):
        n = int(length * SR)
        tt = np.arange(n) / SR
        sweep = freq * (1 + 1.5 * np.exp(-tt * 30))
        return np.sin(2 * np.pi * np.cumsum(sweep) / SR) * np.exp(-tt * 11) * gain

    # 鼓動：だんだん速く、強く
    at = ai
    while at < collapse - 0.15:
        k = (at - ai) / (collapse - ai)
        add(thump(gain=0.22 + 0.2 * k), at, 0.5)
        add(thump(freq=46, gain=0.14 + 0.14 * k), at + 0.17, 0.5)
        at += 1.0 - 0.48 * k

    # 通知音：依頼が増えるほど、細かく、少し濁っていく
    def blip(freq, gain):
        n = int(0.07 * SR)
        tt = np.arange(n) / SR
        return np.sin(2 * np.pi * freq * tt) * np.exp(-tt * 55) * gain

    at = ai
    while at < collapse:
        k = np.clip((at - drain) / (collapse - drain), 0, 1)
        rate = (3 + 9 * (at - ai) / (drain - ai)) if at < drain else (12 + 26 * k)
        f = float(rng.choice([1320, 1480, 1760, 1976])) * (1 - 0.06 * k)
        pan = float(rng.uniform(0.15, 0.85))
        add(blip(f, 0.05 + 0.03 * k), at, 1 - pan, pan)
        if k > 0.3:
            add(blip(f * 1.06, 0.03 * k), at + 0.01, pan, 1 - pan)  # 半音ずれて濁る
        at += float(rng.exponential(1 / max(1.0, rate)))

    # ざわめき：消耗の場面で上がっていく
    n = int((collapse - ai) * SR)
    tt = np.arange(n) / SR
    noise = rng.normal(0, 1, n)
    band = np.convolve(noise, np.hanning(60) / 30, mode="same") - np.convolve(noise, np.hanning(500) / 250, mode="same")
    rise = np.clip((tt - (drain - ai)) / (collapse - drain), 0, 1) ** 1.6
    add(band * (0.02 + 0.12 * rise), ai, 0.5)

    # 濁った低い和音（消耗）
    n = int((collapse - drain + 0.4) * SR)
    tt = np.arange(n) / SR
    env = np.clip(tt / 2.5, 0, 1) ** 2 * np.clip((len(tt) / SR - tt) / 0.3, 0, 1)
    drone = sum(np.sin(2 * np.pi * hz(m) * tt) for m in (38, 51, 52, 57)) * env * 0.05
    add(drone, drain, 0.5)

    # 吸い込まれて、静かになる
    n = int((order - collapse + 0.35) * SR)
    tt = np.arange(n) / SR
    suck = rng.normal(0, 1, n)
    suck = np.convolve(suck, np.hanning(30) / 15, mode="same") * (tt / tt[-1]) ** 3 * 0.18
    add(suck, collapse - 0.35, 0.5)

    # 整列：明るい鐘ひとつ
    add(bell(hz(86), 2.4, 0.11), order, 0.5)
    # 名前：上っていく鐘
    if "name" in beats:
        for i, m in enumerate((74, 78, 81, 86)):
            add(bell(hz(m), 2.2, 0.09), beats["name"] + i * 0.12, 0.5 + (i - 1.5) * 0.12, 0.5 - (i - 1.5) * 0.12)
    # 光の輪が広がって、画面へ
    if "out" in beats:
        add(whoosh(1.0), beats["out"] - 0.1, 0.5)

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
fade_in = int((0.25 if beats else 1.0) * SR)
fade_out = int(min(2.6, DURATION * 0.1) * SR)  # 短い動画では終わりの減衰も短く
master = np.ones(N)
master[:fade_in] = np.linspace(0, 1, fade_in) ** 1.5
master[-fade_out:] = np.linspace(1, 0, fade_out) ** 1.3
left *= master
right *= master
mix = np.stack([left, right], axis=1)
mix = np.tanh(mix * 1.6) / 1.6  # 角を丸める
mix *= 0.56 / max(1e-9, float(np.max(np.abs(mix))))  # 最大でおよそ -5 dBFS
pcm = (mix * 32767).astype("<i2")

path = WAV if WAV.is_absolute() else HERE / WAV
with wave.open(str(path), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
cues = sum(1 for e in timeline.get("events", []) if e["kind"] in ("pop", "click", "whoosh"))
print(f"music: {path} ({DURATION:.1f}s, {cues} sound cues)")
