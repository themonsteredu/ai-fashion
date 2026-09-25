# 원곡 배경음악 생성 (저작권 걱정 없는 직접 합성): 패드 화음 + 아르페지오 + 부드러운 킥/베이스
import numpy as np, wave, sys
SR = 44100; DUR = float(sys.argv[1]) if len(sys.argv) > 1 else 52.0
N = int(SR * DUR); t = np.arange(N) / SR
BPM = 108; beat = 60 / BPM; bar = beat * 4
def mid(m): return 440 * 2 ** ((m - 69) / 12)
# Fmaj7 - Em7 - Dm7 - Cmaj7 (가벼운 팝 무드)
prog = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]]
out = np.zeros(N); rng = np.random.default_rng(7)
def env_ar(n, a, r):
    e = np.ones(n); ai = int(a * SR); ri = int(r * SR)
    e[:ai] = np.linspace(0, 1, ai); e[-ri:] *= np.linspace(1, 0, ri); return e
chord_len = bar * 2
start = 0.0; k = 0
while start < DUR:
    ch = prog[k % 4]; n = int(min(chord_len + 1.0, DUR - start) * SR); s0 = int(start * SR)
    if n <= int(0.3 * SR): break
    tt = np.arange(n) / SR; sig = np.zeros(n)
    for m in ch + [ch[0] - 12]:
        f = mid(m)
        for d in (-0.1, 0.1):
            ff = f * 2 ** (d / 12)
            sig += np.sin(2 * np.pi * ff * tt) + 0.22 * np.sin(2 * np.pi * 2 * ff * tt) + 0.06 * np.sin(2 * np.pi * 3 * ff * tt)
    sig *= env_ar(n, 1.0, 1.0) * 0.028
    out[s0:s0 + n] += sig[:N - s0]; start += chord_len; k += 1
# 아르페지오 (16분 느낌의 8분), 3.5초부터
step = beat / 2; i = 0; tcur = 3.5
while tcur < DUR - 2.5:
    ch = prog[int(tcur / chord_len) % 4]
    pat = [0, 2, 1, 3, 2, 1, 3, 2]; m = ch[pat[i % 8]] + 12
    n = int(0.5 * SR); s0 = int(tcur * SR); tt = np.arange(n) / SR; f = mid(m)
    sig = (np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(2 * np.pi * 2 * f * tt)) * np.exp(-tt * 8) * 0.05
    e = min(n, N - s0); out[s0:s0 + e] += sig[:e]; tcur += step; i += 1
# 킥 + 하이햇 + 클랩 (7.5초 ~ 끝-4초)
KS, KE = 7.5, DUR - 4.0
tcur = KS; bi = 0
while tcur < KE:
    n = int(0.3 * SR); s0 = int(tcur * SR); tt = np.arange(n) / SR
    f = 48 + 85 * np.exp(-tt * 30); ph = 2 * np.pi * np.cumsum(f) / SR
    out[s0:s0 + n] += np.sin(ph) * np.exp(-tt * 10) * 0.2
    h0 = int((tcur + beat / 2) * SR); hn = int(0.045 * SR)
    if h0 + hn < N: out[h0:h0 + hn] += rng.standard_normal(hn) * np.exp(-np.arange(hn) / SR * 95) * 0.022
    if bi % 2 == 1:
        cn = int(0.12 * SR)
        if s0 + cn < N: out[s0:s0 + cn] += rng.standard_normal(cn) * np.exp(-np.arange(cn) / SR * 35) * 0.035
    tcur += beat; bi += 1
# 베이스 (8분 펄스)
for j in range(int(DUR / (beat / 2))):
    tb = j * beat / 2
    if tb < KS or tb > KE: continue
    ch = prog[int(tb / chord_len) % 4]; f = mid(ch[0] - 24) * (2 if j % 4 == 3 else 1)
    n = int(beat / 2 * SR * 0.9); s0 = int(tb * SR); tt = np.arange(n) / SR
    sig = np.sin(2 * np.pi * f * tt) * np.minimum(1, tt * 80) * np.exp(-tt * 5) * 0.1
    out[s0:s0 + n] += sig[:N - s0]
fade = np.ones(N); fi = int(1.0 * SR); fade[:fi] = np.linspace(0, 1, fi); fo = int(3.5 * SR); fade[-fo:] = np.linspace(1, 0, fo) ** 1.5
out *= fade
for d, g in ((0.21, 0.22), (0.39, 0.13), (0.61, 0.07)):
    di = int(d * SR); out[di:] += out[:-di] * g
out /= np.max(np.abs(out)) * 1.12
st = np.stack([out, np.roll(out, int(0.011 * SR))], 1)
wv = wave.open('music.wav', 'wb'); wv.setnchannels(2); wv.setsampwidth(2); wv.setframerate(SR)
wv.writeframes((st * 32767).astype('<i2').tobytes()); wv.close()
print('ok', DUR)
