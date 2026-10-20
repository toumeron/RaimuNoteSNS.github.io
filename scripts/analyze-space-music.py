"""Analyze reference audio without playing it as the application's soundtrack.

Default: 44100 Hz mono float32 -> oscillator analysis JSON (NumPy).
--corrected: 22050 Hz stereo preview -> sparse Fourier asset (NumPy, soundfile).
Run from the project root; the corrected asset retains the original synthesis format.
"""
import argparse
from pathlib import Path


def analyze_oscillators(input_path, output_path):
    import json, sys
    from pathlib import Path
    import numpy as np
    x=np.fromfile(str(input_path), dtype='float32')[::2]
    rate=22050; size=4096; hop=1024
    padded=np.pad(x,(size//2,size//2))
    frames=np.lib.stride_tricks.sliding_window_view(padded,size)[::hop]
    spectrum=np.fft.rfft(frames*np.hanning(size),axis=1)
    tracks=[]; active=[]; noise=[]; captured=0.; total=0.
    for frame,s in enumerate(spectrum):
     mag=np.abs(s); log=np.log(np.maximum(mag,1e-10)); time=frame*hop/rate
     peaks=np.where((mag[1:-1]>mag[:-2])&(mag[1:-1]>mag[2:]))[0]+1
     peaks=peaks[(peaks*rate/size>35)&(peaks*rate/size<7000)]
     peaks=sorted(peaks,key=lambda k:mag[k],reverse=True)[:24]
     used=set(); next_active=[]
     for k in peaks:
      delta=float(np.clip(.5*(log[k-1]-log[k+1])/(log[k-1]-2*log[k]+log[k+1]),-.5,.5))
      freq=(k+delta)*rate/size
      amplitude=float(4/size*np.exp(log[k]-.25*(log[k-1]-log[k+1])*delta))
      if amplitude<.0015:continue
      phase=float((np.angle(s[k])+np.pi*k+np.pi/2)%(2*np.pi))
      candidates=[i for i in active if i not in used and time-tracks[i][-1][0]<hop/rate*2.1 and abs(freq-tracks[i][-1][1])<max(5,freq*.018)]
      if candidates:
       index=min(candidates,key=lambda i:abs(freq-tracks[i][-1][1])); previous=tracks[index][-1]
       predicted=previous[3]+2*np.pi*.5*(previous[1]+freq)*(time-previous[0])
       phase=predicted+(phase-predicted+np.pi)%(2*np.pi)-np.pi
      else:index=len(tracks);tracks.append([])
      tracks[index].append([round(time,5),round(freq,3),round(amplitude,5),round(phase,5)])
      used.add(index);next_active.append(index)
      captured+=np.sum(mag[max(0,k-1):k+2]**2)
     total+=np.sum(mag**2)
     active=next_active
     high=mag[(np.arange(len(mag))*rate/size>4000)&(np.arange(len(mag))*rate/size<8000)]
     flatness=np.exp(np.mean(np.log(np.maximum(high,1e-8))))/max(high.mean(),1e-8)
     noise.append(round(float(np.sqrt(np.sum(high**2))*2/size*flatness*.45),5))
    tracks=[track for track in tracks if len(track)>=3]
    # Short-lived, untracked peaks are not turned into unrelated musical notes.
    output = output_path
    output.write_text(json.dumps({'duration': round(len(x)/rate, 5), 'partials': tracks,
                                  'noiseHop': hop/rate, 'noise': noise}, separators=(',', ':')))
    print('trajectories',len(tracks),'points',sum(map(len,tracks)),'spectral energy retained',round(captured/total,3))


def analyze_corrected(input_path):
    import gzip, json, re, struct, sys
    from pathlib import Path
    import numpy as np
    import soundfile as sf

    x, rate = sf.read(str(input_path), always_2d=True, dtype='float32')
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
    asset = Path('src/assets/audio/space-spectrum.gz')
    asset.parent.mkdir(parents=True, exist_ok=True)
    asset.write_bytes(compressed)
    metadata = {'SPACE_SCORE_DURATION': len(x) / rate, 'SPACE_SCORE_SAMPLES': len(x),
                'SPACE_SCORE_FRAMES': frames, 'SPACE_SPECTRUM_SIZE': size, 'SPACE_SPECTRUM_HOP': hop}
    source = Path('src/lib/spaceMusic.ts')
    text = source.read_text()
    for name, value in metadata.items():
        text, count = re.subn(r'const ' + name + r' = [^;]+;', f'const {name} = {value};', text)
        if count != 1:
            raise ValueError(f'Missing synthesis metadata: {name}')
    source.write_text(text)
    print(json.dumps({'seconds': len(x)/rate, 'frames': frames, 'synthesis_snr_db': round(float(snr), 2), 'compressed_bytes': len(compressed)}))
    np.save('/private/tmp/lime-spectral-reference.npy', x)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path, help='reference audio file')
    parser.add_argument('output', type=Path, nargs='?', default=Path('/private/tmp/lime-space-music-analysis.json'), help='oscillator analysis JSON')
    parser.add_argument('--corrected', action='store_true', help='regenerate the corrected Fourier asset and synthesis metadata')
    args = parser.parse_args()
    if args.corrected:
        analyze_corrected(args.input)
    else:
        analyze_oscillators(args.input, args.output)
