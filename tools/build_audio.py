"""Builds the Lahore soundscape (Part A) and the loop stems used by the webpage (Part B).

Inputs : five open-licence field recordings (see CREDITS.md), converted to 44.1 kHz stereo float WAV
Outputs: assets/audio/lahore-soundscape.mp3   the composed ~88 s soundscape
         assets/audio/{azaan,bazaar,food,traffic,birds}.mp3   levelled, seamless loop stems
         js/envelopes.js                      loudness envelopes (fallback for the visuals)
Usage  : python3 build_audio.py <folder with the five .wav files> <project root>
"""
import sys, json, subprocess, os
import numpy as np
import scipy.io.wavfile as wav
from scipy.signal import butter, sosfilt, fftconvolve

SR = 44100
src, root = sys.argv[1], sys.argv[2]
out = os.path.join(root, "assets", "audio")
os.makedirs(out, exist_ok=True)
rng = np.random.default_rng(7)


def load(name):
    sr, x = wav.read(os.path.join(src, name + ".wav"))
    assert sr == SR
    return x.astype(np.float32)


def rms_db(x):
    return 20 * np.log10(np.sqrt((x ** 2).mean()) + 1e-9)


def level(x, target_db):
    """Match loudness, then soft-limit so peaks never clip."""
    x = x * 10 ** ((target_db - rms_db(x)) / 20)
    return np.tanh(x * 0.9) / 0.9 * 0.95


def hp(x, f):
    return sosfilt(butter(2, f, "highpass", fs=SR, output="sos"), x, axis=0)


def reverb(x, rt60=2.2, wet=0.3):
    n = int(rt60 * 1.2 * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal(n) * np.exp(-6.9 * t / rt60)
    ir = sosfilt(butter(2, 3500, "lowpass", fs=SR, output="sos"), ir)
    ir /= np.abs(ir).max()
    tail = np.stack([fftconvolve(x[:, c], ir)[: len(x) + n // 2] for c in (0, 1)], axis=1)
    tail /= np.abs(tail).max() / np.abs(x).max()
    dry = np.zeros_like(tail)
    dry[: len(x)] = x
    return dry * (1 - wet) + tail * wet


def loopable(x, xf=1.5):
    """Cross-fade the end into the start so the clip repeats without a click or gap."""
    n, k = len(x), int(xf * SR)
    y = x[: n - k].copy()
    fin = np.linspace(0, 1, k)[:, None]
    y[:k] = x[:k] * fin + x[n - k:] * (1 - fin)
    return y


def fade(x, a=0.05, b=0.15):
    x = x.copy()
    x[: int(a * SR)] *= np.linspace(0, 1, int(a * SR))[:, None]
    x[-int(b * SR):] *= np.linspace(1, 0, int(b * SR))[:, None]
    return x


def tile(x, n):
    return np.tile(x, (int(np.ceil(n / len(x))), 1))[:n]


def curve(points, n):
    """Gain automation: (seconds, gain) keyframes -> smooth per-sample gain."""
    t = np.arange(n) / SR
    g = np.interp(t, [p[0] for p in points], [p[1] for p in points])
    k = int(0.4 * SR)
    return np.convolve(g, np.ones(k) / k, mode="same")[:, None]


def pan(x, p):
    """Equal-power pan, p = -1 (left) .. +1 (right); may be an array over time."""
    m = x.mean(axis=1, keepdims=True)
    a = (np.asarray(p) + 1) * np.pi / 4
    a = a[:, None] if a.ndim else a
    return np.concatenate([m * np.cos(a), m * np.sin(a)], axis=1)


# ---------- stems ----------
azaan_once = fade(level(reverb(hp(load("azaan"), 80)), -22), 0.4, 1.2)
bazaar_full = load("bazaar")
bazaar_once = level(bazaar_full[63 * SR: 111 * SR], -24)           # steadiest 48 s of the recording
food_once = level(load("food"), -24)
traffic_once = level(load("traffic"), -24)
birds_once = level(hp(load("birds"), 180), -27)

stems = {
    "azaan": loopable(azaan_once, 2.0),
    "bazaar": loopable(bazaar_once),
    "food": loopable(food_once),
    "traffic": loopable(traffic_once),
    "birds": loopable(birds_once),
}

# ---------- the composed soundscape ----------
T = 88
N = T * SR
mix = np.zeros((N, 2), dtype=np.float32)


def place(x, at, gain_points, p=None):
    global mix
    s = int(at * SR)
    seg = x[: N - s]
    g = curve([(t - at, v) for t, v in gain_points], len(seg))
    y = seg * g
    if p is not None:
        y = pan(y, p[: len(y)])
    mix[s: s + len(y)] += y


tt = np.arange(N) / SR
place(tile(stems["birds"], N), 0, [(0, 0), (3, .9), (12, .9), (18, .25), (40, .12), (62, .08), (75, .5), (80, 1.7), (85, 1.6), (88, 0)],
      p=0.7 * np.sin(tt / 9.0))
place(azaan_once, 10, [(10, 0), (13, 1.0), (37, 1.0), (45, 0)])
place(tile(stems["bazaar"], N), 0, [(0, 0), (34, 0), (41, .85), (54, .8), (60, .45), (66, .25), (76, .1), (80, 0)])
place(tile(stems["food"], N), 0, [(0, 0), (50, 0), (54, .9), (62, .8), (68, .15), (72, 0)])
place(tile(stems["traffic"], N), 0, [(0, 0), (62, 0), (67, .9), (74, .85), (80, .2), (83, 0)],
      p=0.8 * np.sin(tt / 6.5 + 1))
mix = fade(mix, 0.05, 3.0)
master_f = np.tanh(mix * 0.9) / 0.9


def to_wav(x, name):
    p = os.path.join(src, name + "_out.wav")
    wav.write(p, SR, (np.clip(x, -1, 1) * 32767).astype(np.int16))
    return p


def mp3(x, name, br="128k", mono=False, loudnorm=False):
    p = to_wav(x, name)
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", p]
    if loudnorm:
        cmd += ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"]
    cmd += ["-ac", "1" if mono else "2", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", br, os.path.join(out, name + ".mp3")]
    subprocess.run(cmd, check=True)


mp3(master_f, "lahore-soundscape", "192k", loudnorm=True)
mp3(stems["azaan"], "azaan", "96k", mono=True)
mp3(stems["bazaar"], "bazaar", "128k")
mp3(stems["food"], "food", "112k")
mp3(stems["traffic"], "traffic", "96k", mono=True)
mp3(stems["birds"], "birds", "96k", mono=True)

# ---------- loudness envelopes (20 per second), used if the browser can't analyse live audio ----------
def envelope(x):
    m = x.mean(axis=1) if x.ndim == 2 else x
    w = SR // 20
    r = np.array([np.sqrt((m[i:i + w] ** 2).mean()) for i in range(0, len(m) - w, w)])
    d = 20 * np.log10(r + 1e-9)
    v = np.clip((d + 52) / 34, 0, 1)
    v = np.convolve(v, np.ones(3) / 3, mode="same")
    return [round(float(a), 2) for a in v]


env = {"soundscape": envelope(master_f)}
for k, v in stems.items():
    env[k] = envelope(v)
with open(os.path.join(root, "js", "envelopes.js"), "w") as f:
    f.write("/* Loudness envelopes of each audio file, 20 values per second (0 to 1).\n"
            "   Generated by tools/build_audio.py. Used only as a fallback when the browser\n"
            "   cannot analyse the live audio (e.g. page opened from file://). */\n")
    f.write("window.ENVELOPES = " + json.dumps(env, separators=(",", ":")) + ";\n")
print("done", {k: round(len(v) / SR, 1) for k, v in stems.items()}, "master", T, "s")
