"""Build oscillator parameters from mono float32 reference audio (not PCM playback data).
Usage: python analyze-space-music.py /tmp/lime-reference.f32
Requires NumPy. Input: 44100 Hz mono float32, decoded locally from the supplied file.
"""
import json, sys
import numpy as np
x=np.fromfile(sys.argv[1], dtype='float32')[::2]
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
with open('src/lib/spaceMusicScore.ts','w') as out:
 out.write('// Measured sinusoidal frequency/amplitude/phase trajectories, not recorded PCM.\n')
 out.write('export const SPACE_SCORE_DURATION = '+str(round(len(x)/rate,5))+';\n')
 out.write('export const SPACE_PARTIALS: number[][][] = [\n')
 for track in tracks:out.write(json.dumps(track,separators=(',',':'))+',\n')
 out.write('];\nexport const SPACE_NOISE_HOP = '+str(hop/rate)+';\n')
 out.write('export const SPACE_NOISE: number[] = '+json.dumps(noise,separators=(',',':'))+';\n')
print('trajectories',len(tracks),'points',sum(map(len,tracks)),'spectral energy retained',round(captured/total,3))
