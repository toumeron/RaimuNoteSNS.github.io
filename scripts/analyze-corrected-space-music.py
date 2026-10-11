"""Generate sparse Fourier synthesis parameters; the app never plays the input file.
Usage: python analyze-corrected-space-music.py path/to/supplied-preview.mp3
Requires numpy and soundfile, only at analysis time.
"""
import base64, gzip, json, struct, sys
from pathlib import Path
import numpy as np
import soundfile as sf

x, rate = sf.read(sys.argv[1], always_2d=True, dtype='float32')
assert rate == 22050 and x.shape[1] == 2
size, hop = 2048, 1024
window = .5 - .5 * np.cos(2 * np.pi * np.arange(size) / size)
frames = (len(x) + hop - 1) // hop + 1
packed = bytearray()
reconstructed = np.zeros((frames * hop + size, 2))
weights = np.zeros(len(reconstructed))
for frame in range(frames):
    start = frame * hop
    weights[start:start + size] += window ** 2
    for channel in range(2):
        padded = np.pad(x[:, channel], (size // 2, size)) if frame == 0 else padded_channels[channel]
        if frame == 0:
            if channel == 0: padded_channels = []
            padded_channels.append(padded)
        spectrum = np.fft.rfft(padded[start:start + size] * window)
        energy = np.abs(spectrum) ** 2
        order = np.argsort(energy)[::-1]
        count = np.searchsorted(np.cumsum(energy[order]), energy.sum() * .999) + 1
        indices = np.sort(order[:count])
        values = spectrum[indices]
        scale = max(np.max(np.abs(values.real)), np.max(np.abs(values.imag)), 1e-20) / 32767
        pairs = np.rint(np.stack([values.real, values.imag], axis=1) / scale).astype('<i2')
        packed += struct.pack('<Hf', len(indices), scale)
        rows = np.empty((len(indices), 3), dtype='<u2')
        rows[:, 0] = indices
        rows[:, 1:] = pairs.view('<u2')
        packed += rows.tobytes()
        selected = np.zeros_like(spectrum)
        selected[indices] = (pairs[:, 0] + 1j * pairs[:, 1]) * np.float32(scale)
        reconstructed[start:start + size, channel] += np.fft.irfft(selected, n=size) * window
reconstructed /= np.maximum(weights[:, None], 1e-20)
reconstructed = reconstructed[size // 2:size // 2 + len(x)]
error = x - reconstructed
snr = 10 * np.log10(np.sum(x ** 2) / np.sum(error ** 2))
compressed = gzip.compress(packed, compresslevel=9, mtime=0)
encoded = base64.b64encode(compressed).decode('ascii')
Path('src/lib/spaceMusicScore.ts').write_text(
    '/** Sparse frequency, amplitude and phase coefficients from the supplied corrected preview.\n'
    ' * Used by inverse Fourier synthesis; contains no MP3 or time-domain PCM samples. */\n'
    f'export const SPACE_SCORE_DURATION = {len(x) / rate!r};\n'
    f'export const SPACE_SCORE_SAMPLES = {len(x)};\n'
    f'export const SPACE_SCORE_FRAMES = {frames};\n'
    f'export const SPACE_SPECTRUM_SIZE = {size};\n'
    f'export const SPACE_SPECTRUM_HOP = {hop};\n'
    f'export const SPACE_SPECTRUM_GZIP = {json.dumps(encoded)};\n')
print(json.dumps({'seconds': len(x)/rate, 'frames': frames, 'synthesis_snr_db': round(float(snr), 2), 'compressed_bytes': len(compressed)}))
np.save('/private/tmp/lime-spectral-reference.npy', x)
