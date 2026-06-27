import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Search, X, Clock, Loader2, TrendingUp, Newspaper, Radio, Play, Square } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PostCard } from '@/components/feed/PostCard';
import UserCard from '@/components/search/UserCard';
import { supabase } from '@/lib/supabase';
import type { User, PostWithAuthor } from '@/types';
// @ts-ignore - tiny-segmenter has no bundled types
import TinySegmenter from 'tiny-segmenter';
import { useSearchParams, useNavigate } from 'react-router-dom';

const segmenter = new TinySegmenter();

const kataToHira = (s: string) =>
  s.replace(/[\u30a1-\u30f6]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0x60)
  );

const normalize = (s: string) => {
  if (!s) return '';
  let n = s.normalize('NFKC').toLowerCase();
  n = kataToHira(n);
  return n;
};

const tokenizeQuery = (q: string): string[] => {
  const norm = normalize(q);
  if (!norm.trim()) return [];
  return norm.split(/[\s\u3000]+/).filter(Boolean);
};

const buildUserHaystack = (u: User): string =>
  normalize(`${u.displayName} ${u.username} @${u.username} ${u.bio || ''}`);

const HISTORY_KEY = 'search:recent';
const HISTORY_MAX = 8;

const RADIO_FALLBACK_SCRIPT = `
バグが発生しています
`;

const createSilentAudioUrl = () => {
  const sampleRate = 8000;
  const seconds = 1;
  const samples = sampleRate * seconds;
  const dataSize = samples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
};

const getHumanLikeJapaneseVoice = () => {
  if (!('speechSynthesis' in window)) return null;

  const voices = window.speechSynthesis.getVoices();
  const japaneseVoices = voices.filter((voice) => voice.lang.toLowerCase().startsWith('ja'));
  const candidates = japaneseVoices.length > 0 ? japaneseVoices : voices;

  return candidates
    .map((voice) => {
      const name = voice.name.toLowerCase();
      const uri = voice.voiceURI.toLowerCase();
      const label = `${name} ${uri}`;
      let score = 0;

      if (voice.lang.toLowerCase().startsWith('ja')) score += 130;
      if (/siri|voice 1|voice 2|voice 3|voice 4/.test(label)) score += 110;
      if (/kyoko|otoya/.test(label) && /enhanced|premium/.test(label)) score += 105;
      if (/kyoko|otoya|aoi|mayu|shiori|haruka|ichiro|sayaka/.test(label)) score += 62;
      if (/natural|neural/.test(label)) score += 55;
      if (/enhanced|premium|online/.test(label)) score += 50;
      if (/apple|com.apple/.test(label)) score += 36;
      if (/microsoft|google|nanami|keita/.test(label)) score -= 70;
      if (/compact/.test(label)) score -= 90;
      if (/default/.test(label)) score -= 22;
      if (/novelty|whisper|organ|bad news|bells|boing|bubbles/.test(label)) score -= 120;
      if (voice.localService) score += 18;
      if (!voice.default) score += 10;

      return { voice, score };
    })
    .sort((a, b) => b.score - a.score)[0]?.voice || null;
};

const getRadioTimeIntro = () => {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const period = hours < 12 ? '午前' : '午後';
  const displayHours = hours % 12 || 12;
  const minuteText = minutes === 0 ? 'ちょうど' : `${minutes}分`;

  return `現在、${period}${displayHours}時${minuteText}です。`;
};

const loadHistory = (): string[] => {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, HISTORY_MAX) : [];
  } catch { return []; }
};
const saveHistory = (list: string[]) => {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
  } catch { /* noop */ }
};

const RowSkeleton = () => (
  <div className="flex gap-3 px-4 py-3 border-b border-black/[0.03] dark:border-white/[0.05] animate-pulse bg-transparent">
    <div className="w-10 h-10 rounded-full bg-black/5 dark:bg-white/10 shrink-0" />
    <div className="flex-1 space-y-2 pt-1">
      <div className="h-3 w-1/3 bg-black/5 dark:bg-white/10 rounded" />
      <div className="h-3 w-5/6 bg-black/5 dark:bg-white/10 rounded" />
    </div>
  </div>
);

// トレンドアイテムの型定義
type TrendItem = {
  title: string;
  traffic: string;
};

// ニュースアイテムの型定義
type NewsItem = {
  id: string;
  title: string;
  content: string;
  category: string;
  created_at: string;
};

type SuggestionRow =
  | { type: 'search'; value: string }
  | { type: 'user'; value: string; user: User };

declare global {
  interface Window {
    __limeSearchRadioIsPlaying?: boolean;
    __limeSearchRadioOwnerId?: string;
    __limeSearchRadioStop?: () => void;
  }
}

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [searchedPosts, setSearchedPosts] = useState<PostWithAuthor[]>([]);
  const [isUsersLoading, setIsUsersLoading] = useState(false);
  const [isPostsLoading, setIsPostsLoading] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const [activeSuggestIdx, setActiveSuggestIdx] = useState<number>(-1);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isRadioPlaying, setIsRadioPlaying] = useState(() => !!window.__limeSearchRadioIsPlaying);
  
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  // トレンド用ステート
  const [trends, setTrends] = useState<TrendItem[]>([]);
  const [isTrendsLoading, setIsTrendsLoading] = useState(false);

  // ニュース用ステート
  const [latestNews, setLatestNews] = useState<NewsItem | null>(null);
  const [radioNews, setRadioNews] = useState<NewsItem[]>([]);
  const [isNewsLoading, setIsNewsLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const suggestBoxRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const lastElementRef = useRef<HTMLDivElement>(null);
  const radioPlayingRef = useRef(false);
  const backgroundAudioRef = useRef<HTMLAudioElement | null>(null);
  const backgroundAudioUrlRef = useRef<string | null>(null);
  const radioAudioContextRef = useRef<AudioContext | null>(null);
  const radioBeatTimerRef = useRef<number | null>(null);
  const radioBeatGainRef = useRef<GainNode | null>(null);
  const isMountedRef = useRef(true);
  const radioInstanceIdRef = useRef(`search-radio-${Date.now()}-${Math.random()}`);

  const radioScript = useMemo(() => {
    const newsLines = radioNews
      .slice(0, 4)
      .map((news, idx) => {
        const content = news.content ? `。${news.content.slice(0, 140)}` : '';
        return `${idx + 1}本目、${news.category}から。${news.title}${content}`;
      });

    if (newsLines.length === 0) {
      return RADIO_FALLBACK_SCRIPT;
    }

    return [
      'こんにちは。こちらはLimeNote開発部です。',
      '検索ページで見つけたニュースを、読み上げます。',
      'まずはニュースです。',
      ...newsLines,
      '以上、LimeNoteでした。読み上げが終わると、また最初から繰り返します。'
    ].filter(Boolean).join('\n');
  }, [radioNews]);

  const playRadioJingle = useCallback(() => {
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) return;

    const audioContext = radioAudioContextRef.current || new AudioContextCtor();
    radioAudioContextRef.current = audioContext;

    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {
        // ブラウザ側でAudioContextの再開が拒否された場合は読み上げだけ続ける
      });
    }

    const now = audioContext.currentTime;
    const master = audioContext.createGain();
    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-20, now);
    compressor.knee.setValueAtTime(16, now);
    compressor.ratio.setValueAtTime(3, now);
    compressor.attack.setValueAtTime(0.006, now);
    compressor.release.setValueAtTime(0.16, now);
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.32, now + 0.08);
    master.gain.setValueAtTime(0.28, now + 1.75);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 2.35);
    master.connect(compressor);
    compressor.connect(audioContext.destination);

    const playTone = (
      frequency: number,
      start: number,
      duration: number,
      peak: number,
      type: OscillatorType = 'sine'
    ) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const end = start + duration;

      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.035);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);

      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(start);
      oscillator.stop(end + 0.02);
    };

    const playChordHit = (start: number, frequencies: number[], duration: number) => {
      const chordGain = audioContext.createGain();
      const filter = audioContext.createBiquadFilter();

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2200, start);
      chordGain.gain.setValueAtTime(0.0001, start);
      chordGain.gain.exponentialRampToValueAtTime(0.2, start + 0.06);
      chordGain.gain.setValueAtTime(0.17, start + duration - 0.16);
      chordGain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      frequencies.forEach((frequency, index) => {
        const oscillator = audioContext.createOscillator();
        oscillator.type = index % 2 === 0 ? 'triangle' : 'sine';
        oscillator.frequency.setValueAtTime(frequency, start);
        oscillator.detune.setValueAtTime(index % 2 === 0 ? -5 : 5, start);
        oscillator.connect(filter);
        oscillator.start(start);
        oscillator.stop(start + duration + 0.03);
      });

      filter.connect(chordGain);
      chordGain.connect(master);
    };

    const createNoiseBuffer = (duration: number) => {
      const bufferSize = Math.floor(audioContext.sampleRate * duration);
      const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
      const output = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i += 1) output[i] = Math.random() * 2 - 1;
      return buffer;
    };

    const playNoise = (start: number, duration: number, peak: number, frequency: number) => {
      const noise = audioContext.createBufferSource();
      const filter = audioContext.createBiquadFilter();
      const gain = audioContext.createGain();

      noise.buffer = createNoiseBuffer(duration);
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      noise.start(start);
      noise.stop(start + duration + 0.02);
    };

    playChordHit(now, [293.66, 349.23, 440.00, 523.25, 659.25], 0.62);
    playTone(73.42, now, 0.38, 0.14, 'sawtooth');
    playNoise(now + 0.02, 0.08, 0.08, 6200);

    playChordHit(now + 0.55, [196.00, 246.94, 349.23, 440.00, 587.33], 0.72);
    playTone(98.00, now + 0.56, 0.46, 0.15, 'sawtooth');
    playNoise(now + 0.58, 0.12, 0.1, 2200);

    playChordHit(now + 1.18, [261.63, 329.63, 392.00, 493.88, 587.33], 1.05);
    playTone(65.41, now + 1.18, 0.72, 0.16, 'sawtooth');

    [659.25, 783.99, 987.77, 1174.66, 987.77, 1318.51, 1174.66].forEach((frequency, index) => {
      playTone(frequency, now + 0.18 + index * 0.18, 0.24, 0.13, index % 2 === 0 ? 'triangle' : 'sine');
    });

    playTone(880.00, now + 1.55, 0.26, 0.11, 'triangle');
    playTone(987.77, now + 1.72, 0.28, 0.12, 'triangle');
    playTone(1318.51, now + 1.96, 0.48, 0.15, 'sine');
    playNoise(now + 2.05, 0.22, 0.13, 5600);
  }, []);

  const startRadioBeat = useCallback(() => {
    if (radioBeatTimerRef.current !== null) return;

    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) return;

    const audioContext = radioAudioContextRef.current || new AudioContextCtor();
    radioAudioContextRef.current = audioContext;

    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {
        // ブラウザ側でAudioContextの再開が拒否された場合は読み上げだけ続ける
      });
    }

    const beatGain = audioContext.createGain();
    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-18, audioContext.currentTime);
    compressor.knee.setValueAtTime(18, audioContext.currentTime);
    compressor.ratio.setValueAtTime(4, audioContext.currentTime);
    compressor.attack.setValueAtTime(0.006, audioContext.currentTime);
    compressor.release.setValueAtTime(0.18, audioContext.currentTime);
    beatGain.gain.setValueAtTime(1.25, audioContext.currentTime);
    beatGain.connect(compressor);
    compressor.connect(audioContext.destination);
    radioBeatGainRef.current = beatGain;

    const createNoiseBuffer = (duration = 0.18) => {
      const bufferSize = Math.floor(audioContext.sampleRate * duration);
      const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
      const output = buffer.getChannelData(0);

      for (let i = 0; i < bufferSize; i += 1) {
        output[i] = Math.random() * 2 - 1;
      }

      return buffer;
    };

    const playKick = (time: number) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(116, time);
      oscillator.frequency.exponentialRampToValueAtTime(48, time + 0.14);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.18, time + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.24);

      oscillator.connect(gain);
      gain.connect(beatGain);
      oscillator.start(time);
      oscillator.stop(time + 0.24);
    };

    const playSnare = (time: number) => {
      const noise = audioContext.createBufferSource();
      const filter = audioContext.createBiquadFilter();
      const gain = audioContext.createGain();

      noise.buffer = createNoiseBuffer();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(950, time);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.095, time + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(beatGain);
      noise.start(time);
      noise.stop(time + 0.15);
    };

    const playHat = (time: number) => {
      const noise = audioContext.createBufferSource();
      const filter = audioContext.createBiquadFilter();
      const gain = audioContext.createGain();

      noise.buffer = createNoiseBuffer();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(6200, time);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.045, time + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(beatGain);
      noise.start(time);
      noise.stop(time + 0.07);
    };

    const playBass = (time: number, frequency: number) => {
      const oscillator = audioContext.createOscillator();
      const filter = audioContext.createBiquadFilter();
      const gain = audioContext.createGain();

      oscillator.type = 'sawtooth';
      oscillator.frequency.setValueAtTime(frequency, time);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(420, time);
      filter.Q.setValueAtTime(1.2, time);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.16, time + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.34);

      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(beatGain);
      oscillator.start(time);
      oscillator.stop(time + 0.36);
    };

    const playChord = (time: number, frequencies: number[], duration: number) => {
      const chordGain = audioContext.createGain();
      const filter = audioContext.createBiquadFilter();

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1550, time);
      filter.Q.setValueAtTime(0.6, time);
      chordGain.gain.setValueAtTime(0.0001, time);
      chordGain.gain.exponentialRampToValueAtTime(0.085, time + 0.08);
      chordGain.gain.setValueAtTime(0.075, time + duration - 0.16);
      chordGain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

      frequencies.forEach((frequency, index) => {
        const oscillator = audioContext.createOscillator();
        oscillator.type = index % 2 === 0 ? 'triangle' : 'sine';
        oscillator.frequency.setValueAtTime(frequency, time);
        oscillator.detune.setValueAtTime(index % 2 === 0 ? -4 : 4, time);
        oscillator.connect(filter);
        oscillator.start(time);
        oscillator.stop(time + duration + 0.03);
      });

      filter.connect(chordGain);
      chordGain.connect(beatGain);
    };

    const playArp = (time: number, frequency: number) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const filter = audioContext.createBiquadFilter();

      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(frequency, time);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2400, time);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.055, time + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);

      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(beatGain);
      oscillator.start(time);
      oscillator.stop(time + 0.2);
    };

    const bpm = 92;
    const step = 60 / bpm / 4;
    const patternSteps = 64;
    const patternLength = step * patternSteps;
    const chordProgression = [
      { chord: [261.63, 329.63, 392.00, 493.88], bass: 65.41, arp: [392.00, 493.88, 659.25, 493.88] },
      { chord: [220.00, 261.63, 329.63, 392.00], bass: 55.00, arp: [329.63, 392.00, 523.25, 392.00] },
      { chord: [174.61, 220.00, 261.63, 329.63], bass: 43.65, arp: [329.63, 440.00, 523.25, 440.00] },
      { chord: [196.00, 246.94, 293.66, 392.00], bass: 49.00, arp: [293.66, 392.00, 587.33, 392.00] }
    ];

    const schedulePattern = () => {
      if (!radioPlayingRef.current) return;

      const start = audioContext.currentTime + 0.04;
      for (let i = 0; i < patternSteps; i += 1) {
        const time = start + i * step;
        const barIndex = Math.floor(i / 16);
        const stepInBar = i % 16;
        const section = chordProgression[barIndex % chordProgression.length];

        if (stepInBar === 0) {
          playChord(time, section.chord, step * 16);
        }
        if (stepInBar === 0 || stepInBar === 6 || stepInBar === 10) playKick(time);
        if (stepInBar === 4 || stepInBar === 12) playSnare(time);
        if (stepInBar % 2 === 0) playHat(time);
        if ([0, 3, 6, 10, 13].includes(stepInBar)) playBass(time, section.bass);
        if ([2, 5, 8, 11, 14].includes(stepInBar)) {
          playArp(time, section.arp[(stepInBar + barIndex) % section.arp.length]);
        }
      }
    };

    schedulePattern();
    radioBeatTimerRef.current = window.setInterval(schedulePattern, patternLength * 1000);
  }, []);

  const setRadioBeatVolume = useCallback((volume: number, fadeSeconds = 0.18) => {
    const beatGain = radioBeatGainRef.current;
    if (!beatGain) return;

    const now = beatGain.context.currentTime;
    beatGain.gain.cancelScheduledValues(now);
    beatGain.gain.setTargetAtTime(volume, now, fadeSeconds);
  }, []);

  const setRadioPlayingState = useCallback((value: boolean) => {
    if (isMountedRef.current) {
      setIsRadioPlaying(value);
    }
  }, []);

  const stopRadioBeat = useCallback(() => {
    if (radioBeatTimerRef.current !== null) {
      window.clearInterval(radioBeatTimerRef.current);
      radioBeatTimerRef.current = null;
    }
    if (radioBeatGainRef.current) {
      radioBeatGainRef.current.gain.setValueAtTime(0.0001, radioBeatGainRef.current.context.currentTime);
      radioBeatGainRef.current.disconnect();
      radioBeatGainRef.current = null;
    }
  }, []);

  const stopRadio = useCallback(() => {
    if (
      window.__limeSearchRadioOwnerId &&
      window.__limeSearchRadioOwnerId !== radioInstanceIdRef.current &&
      window.__limeSearchRadioStop
    ) {
      window.__limeSearchRadioStop();
      window.__limeSearchRadioIsPlaying = false;
      setRadioPlayingState(false);
      return;
    }

    radioPlayingRef.current = false;
    window.__limeSearchRadioIsPlaying = false;
    if (window.__limeSearchRadioOwnerId === radioInstanceIdRef.current) {
      window.__limeSearchRadioOwnerId = undefined;
      window.__limeSearchRadioStop = undefined;
    }
    setRadioPlayingState(false);
    stopRadioBeat();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (backgroundAudioRef.current) {
      backgroundAudioRef.current.pause();
      backgroundAudioRef.current.currentTime = 0;
    }
  }, [setRadioPlayingState, stopRadioBeat]);

  const playRadio = useCallback(() => {
    if (!('speechSynthesis' in window)) return;

    if (
      window.__limeSearchRadioOwnerId &&
      window.__limeSearchRadioOwnerId !== radioInstanceIdRef.current &&
      window.__limeSearchRadioStop
    ) {
      window.__limeSearchRadioStop();
    }

    window.__limeSearchRadioOwnerId = radioInstanceIdRef.current;
    window.__limeSearchRadioStop = stopRadio;
    window.__limeSearchRadioIsPlaying = true;
    radioPlayingRef.current = true;
    setRadioPlayingState(true);
    window.speechSynthesis.cancel();
    window.speechSynthesis.getVoices();
    stopRadioBeat();

    if (!backgroundAudioUrlRef.current) {
      backgroundAudioUrlRef.current = createSilentAudioUrl();
    }

    if (!backgroundAudioRef.current) {
      backgroundAudioRef.current = new Audio(backgroundAudioUrlRef.current);
      backgroundAudioRef.current.loop = true;
      backgroundAudioRef.current.preload = 'auto';
    }

    backgroundAudioRef.current.play().catch(() => {
      // ブラウザ側でバックグラウンド保持用audioが拒否されても、読み上げ自体は続ける
    });

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'ベータラジオ',
        artist: '検索ページ',
        album: 'ニュース'
      });
      navigator.mediaSession.setActionHandler('play', () => {
        if (!radioPlayingRef.current) {
          radioPlayingRef.current = true;
          setRadioPlayingState(true);
        }
        backgroundAudioRef.current?.play().catch(() => {
          // ブラウザ側で再開が拒否された場合は、次のユーザー操作で復帰する
        });
        startRadioBeat();
        setRadioBeatVolume(0.24, 0.18);
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
      });
      navigator.mediaSession.setActionHandler('pause', stopRadio);
      navigator.mediaSession.setActionHandler('stop', stopRadio);
    }

    const speak = () => {
      if (!radioPlayingRef.current) return;

      const utterance = new SpeechSynthesisUtterance(`${getRadioTimeIntro()}\n${radioScript}`);
      const voice = getHumanLikeJapaneseVoice();
      if (voice) utterance.voice = voice;
      utterance.lang = 'ja-JP';
      utterance.rate = 0.98;
      utterance.pitch = 1;
      utterance.volume = 1;
      utterance.onend = () => {
        setRadioBeatVolume(0.62, 0.2);
        if (radioPlayingRef.current) {
          window.setTimeout(speak, 900);
        }
      };
      utterance.onerror = () => {
        stopRadio();
      };

      playRadioJingle();
      stopRadioBeat();
      window.setTimeout(() => {
        if (radioPlayingRef.current) {
          startRadioBeat();
          setRadioBeatVolume(0.24, 0.18);
          window.speechSynthesis.speak(utterance);
        }
      }, 2450);
    };

    speak();
  }, [playRadioJingle, radioScript, setRadioBeatVolume, setRadioPlayingState, startRadioBeat, stopRadio, stopRadioBeat]);

  useEffect(() => {
    const keepRadioAlive = () => {
      if (!radioPlayingRef.current) return;

      backgroundAudioRef.current?.play().catch(() => {
        // ブラウザ側で再開が拒否された場合は、次のユーザー操作で復帰する
      });
      startRadioBeat();
      setRadioBeatVolume(0.24, 0.18);

      if ('speechSynthesis' in window && window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    };

    document.addEventListener('visibilitychange', keepRadioAlive);
    window.addEventListener('focus', keepRadioAlive);
    return () => {
      document.removeEventListener('visibilitychange', keepRadioAlive);
      window.removeEventListener('focus', keepRadioAlive);
    };
  }, [setRadioBeatVolume, startRadioBeat]);

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;

    const loadVoices = () => {
      window.speechSynthesis.getVoices();
    };

    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
    };
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // ニュース取得用Effect
  useEffect(() => {
    async function fetchLatestNews() {
      setIsNewsLoading(true);
      try {
        const { data, error } = await supabase
          .from('news_summaries')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(5);

        if (error) throw error;
        const newsItems = Array.isArray(data) ? data : [];
        setRadioNews(newsItems);
        setLatestNews(newsItems[0] || null);
      } catch (err) {
        console.error('Failed to fetch news:', err);
      } finally {
        setIsNewsLoading(false);
      }
    }
    fetchLatestNews();
  }, []);

  // トレンド取得用Effect
  useEffect(() => {
    async function fetchTrends() {
      setIsTrendsLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke('get-trends', {
          method: 'POST',
          body: {}, 
        });

        if (error) throw error;

        if (Array.isArray(data)) {
          setTrends(data);
        } else if (data && data.error) {
          console.error('Function returned error:', data.error);
          setTrends([]);
        }
      } catch (err) {
        console.error('Failed to fetch trends:', err);
        setTrends([]);
      } finally {
        setIsTrendsLoading(false);
      }
    }
    fetchTrends();
  }, []);

  // Realtime同期用のEffect
  useEffect(() => {
    if (!searchQuery) return;

    const channel = supabase
      .channel('search_likes_sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'likes' },
        () => {
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [searchQuery]);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 90);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchUsers() {
      setIsUsersLoading(true);
      try {
        const { data, error } = await supabase.from('profiles').select('*');
        if (error) throw error;
        if (cancelled) return;
        setAllUsers((data || []).map((u: any) => ({
          id: u.id,
          username: u.username,
          displayName: u.display_name || u.displayName || 'User',
          avatarUrl: u.avatar_url || u.avatarUrl || '',
          coverUrl: u.cover_url || '',
          createdAt: u.created_at || '',
          bio: u.bio || '',
          isOfficial: !!(u.is_official || u.isOfficial),
        })));
      } catch (err) { console.error(err); }
      finally { if (!cancelled) setIsUsersLoading(false); }
    }
    fetchUsers();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (suggestBoxRef.current && !suggestBoxRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setIsInputFocused(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const fetchPosts = useCallback(async (q: string, targetPage: number) => {
    if (!q.trim()) return;
    if (targetPage === 0) setIsPostsLoading(true);

    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const from = targetPage * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let conditions = ['visibility.eq.public'];
      if (currentUser) {
        conditions.push(`user_id.eq.${currentUser.id}`);

        const { data: followedByData } = await supabase
          .from('follows')
          .select('follower_id')
          .eq('followee_id', currentUser.id);
        
        const authorsWhoFollowMe = followedByData?.map(f => f.follower_id) || [];
        if (authorsWhoFollowMe.length > 0) {
          conditions.push(`user_id.in.(${authorsWhoFollowMe.join(',')})`);
        }
      }

      const { data, error } = await supabase
        .from('posts')
        .select(`id, content, image_urls, created_at, user_id, likes_count, reposts_count, visibility`)
        .ilike('content', `%${q}%`)
        .or(conditions.join(','))
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;

      if (data) {
        let myLikes: string[] = [];
        if (currentUser) {
          const { data: likesData } = await supabase
            .from('likes')
            .select('post_id')
            .eq('user_id', currentUser.id)
            .in('post_id', data.map(p => p.id));
          if (likesData) myLikes = likesData.map(l => l.post_id);
        }

        let myReposts: string[] = [];
        if (currentUser) {
          const { data: repostsData } = await supabase
            .from('reposts')
            .select('post_id')
            .eq('user_id', currentUser.id)
            .in('post_id', data.map(p => p.id));
          if (repostsData) myReposts = repostsData.map(r => r.post_id);
        }

        const formatted: PostWithAuthor[] = data.map((p: any) => {
          const user = allUsers.find(u => u.id === p.user_id);
          return {
            id: p.id,
            userId: p.user_id,
            authorId: p.user_id,
            content: p.content,
            imageUrl: p.image_urls?.[0] || null,
            imageUrls: p.image_urls || [],
            createdAt: p.created_at,
            likesCount: p.likes_count || 0,
            repostsCount: p.reposts_count || 0,
            commentsCount: 0,
            likedByMe: myLikes.includes(p.id),
            repostedByMe: myReposts.includes(p.id),
            visibility: p.visibility,
            author: {
              id: user?.id || p.user_id,
              username: user?.username || 'unknown',
              displayName: user?.displayName || 'User',
              avatarUrl: user?.avatarUrl || '',
              coverUrl: user?.coverUrl || '',
              createdAt: user?.createdAt || p.created_at,
              bio: user?.bio || '',
              isOfficial: user?.isOfficial || false
            }
          };
        });

        if (targetPage === 0) {
          setSearchedPosts(formatted);
        } else {
          setSearchedPosts(prev => [...prev, ...formatted]);
        }
        
        setHasMore(data.length === PAGE_SIZE);
      }
    } catch (err) {
      console.error('Search query failed:', err);
    } finally {
      setIsPostsLoading(false);
    }
  }, [allUsers]);

  const commitSearch = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (!q) return;

    setInputValue(q);
    setSearchQuery(q);
    setIsInputFocused(false);
    setActiveSuggestIdx(-1);
    setPage(0);
    setHasMore(true);

    setHistory((prev) => {
      const next = [q, ...prev.filter((h) => h !== q)].slice(0, HISTORY_MAX);
      saveHistory(next);
      return next;
    });

    await fetchPosts(q, 0);
    inputRef.current?.blur();
  }, [fetchPosts]);

  useEffect(() => {
    const queryParam = searchParams.get('q');
    if (queryParam) {
      commitSearch(queryParam);
    }
  }, [searchParams, commitSearch]);

  useEffect(() => {
    if (isPostsLoading) return;
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && searchQuery) {
        const nextPage = page + 1;
        setPage(nextPage);
        fetchPosts(searchQuery, nextPage);
      }
    });

    if (lastElementRef.current) {
      observerRef.current.observe(lastElementRef.current);
    }

    return () => observerRef.current?.disconnect();
  }, [isPostsLoading, hasMore, page, searchQuery, fetchPosts]);

  const liveSuggestions = useMemo(() => {
    const raw = inputValue.trim();
    const normalizedRaw = normalize(raw);
    const queryCandidates = Array.from(
      new Set([normalizedRaw, normalizedRaw.replace(/^@+/, '')].filter(Boolean))
    );

    if (queryCandidates.length === 0) return [];

    return allUsers
      .map((u) => {
        const dn = normalize(u.displayName);
        const un = normalize(u.username);
        const handle = normalize(`@${u.username}`);
        const fields = [dn, un, handle];
        let score = 0;

        if (queryCandidates.some((q) => fields.includes(q))) score = 100;
        else if (queryCandidates.some((q) => fields.some((field) => field.startsWith(q)))) score = 50;
        else if (queryCandidates.some((q) => fields.some((field) => field.includes(q)))) score = 20;

        return { user: u, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((x) => x.user);
  }, [inputValue, allUsers]);

  const queryTokens = useMemo(() => tokenizeQuery(searchQuery), [searchQuery]);

  const filteredUsers = useMemo(() => {
    if (!searchQuery || queryTokens.length === 0) return [];

    return allUsers.map((u) => {
      const hay = buildUserHaystack(u);
      const dn = normalize(u.displayName);
      const un = normalize(u.username);
      const handle = normalize(`@${u.username}`);
      let score = 0;
      let allMatch = true;
      for (const t of queryTokens) {
        const tokenCandidates = Array.from(new Set([t, t.replace(/^@+/, '')].filter(Boolean)));
        if (!tokenCandidates.some((token) => hay.includes(token))) { allMatch = false; break; }
        if (tokenCandidates.some((token) => dn === token || un === token || handle === token)) score += 5;
        else if (tokenCandidates.some((token) => dn.startsWith(token) || un.startsWith(token) || handle.startsWith(token))) score += 3;
        else score += 1;
      }
      return allMatch ? { u, score } : null;
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.score - a.score)
    .map((x: any) => x.u) as User[];
  }, [searchQuery, queryTokens, allUsers]);

  const suggestionRows = useMemo<SuggestionRow[]>(() => {
    const rows: SuggestionRow[] = [];
    if (inputValue.trim()) {
      rows.push({ type: 'search', value: inputValue.trim() });
      for (const u of liveSuggestions) rows.push({ type: 'user', value: u.username, user: u });
    } else {
      for (const h of history) rows.push({ type: 'search', value: h });
    }
    return rows;
  }, [inputValue, liveSuggestions, history]);

  const handleSuggestionSelect = useCallback((row: SuggestionRow) => {
    if (row.type === 'user') {
      setIsInputFocused(false);
      setActiveSuggestIdx(-1);
      inputRef.current?.blur();
      navigate(`/u/${row.user.username}`);
      return;
    }

    commitSearch(row.value);
  }, [commitSearch, navigate]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isInputFocused) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestIdx((i) => Math.min(suggestionRows.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestIdx((i) => Math.max(-1, i - 1));
    } else if (e.key === 'Enter' && activeSuggestIdx >= 0) {
      e.preventDefault();
      handleSuggestionSelect(suggestionRows[activeSuggestIdx]);
    }
  };

  const removeHistoryItem = (item: string) => {
    setHistory((prev) => {
      const next = prev.filter((h) => h !== item);
      saveHistory(next);
      return next;
    });
  };

  const clearHistory = () => {
    setHistory([]);
    saveHistory([]);
  };

  const renderSearchHomeSections = () => (
    <div className="flex flex-col gap-6">
      {/* 最新ニュースセクション */}
      <div className="px-4">
        <div className="bg-primary/10 dark:bg-primary/5 rounded-2xl border border-primary/20 dark:border-primary/10 overflow-hidden">
          <div className="px-4 py-3 border-b border-primary/20 dark:border-primary/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Newspaper className="w-5 h-5 text-primary" />
              <h2 className="font-extrabold text-xl">ニュース</h2>
            </div>
            {latestNews && (
               <button 
                 onClick={() => navigate('/news')}
                 className="text-[11px] font-bold bg-primary text-white px-2 py-0.5 rounded-full uppercase hover:opacity-80 transition-opacity"
               >
                 NEW
               </button>
            )}
          </div>
          
          {isNewsLoading ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : latestNews ? (
            <div 
              className="p-4 flex flex-col gap-2 cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
              onClick={() => navigate('/news')}
            >
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-bold text-primary px-2 py-0.5 bg-primary/10 rounded-md">
                  {latestNews.category}
                </span>
                <span className="text-[12px] text-[rgb(83,100,113)] dark:text-gray-400">
                  {new Date(latestNews.created_at).toLocaleDateString()}
                </span>
              </div>
              <h3 className="font-bold text-[17px] leading-tight hover:underline">
                {latestNews.title}
              </h3>
              <p className="text-[14px] text-[rgb(83,100,113)] dark:text-gray-300 leading-normal line-clamp-3">
                {latestNews.content}
              </p>
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-[rgb(83,100,113)] dark:text-gray-400 text-[14px]">
              現在、表示できるニュースはありません
            </div>
          )}
        </div>
      </div>

      {/* トレンドセクション */}
      <div className="px-4">
        <div className="bg-black/[0.02] dark:bg-white/[0.03] rounded-2xl border border-black/[0.03] dark:border-white/[0.05] overflow-hidden">
          <div className="px-4 py-3 border-b border-black/[0.03] dark:border-white/[0.05] flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            <h2 className="font-extrabold text-xl">トレンド</h2>
          </div>
          
          {isTrendsLoading ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="flex flex-col">
              {trends.length > 0 ? (
                trends.map((trend, idx) => (
                  <button
                    key={idx}
                    onClick={() => commitSearch(trend.title)}
                    className="px-4 py-3 text-left hover:bg-black/[0.03] dark:hover:bg-white/[0.05] transition-colors border-b last:border-none border-black/[0.03] dark:border-white/[0.05] flex flex-col gap-0.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] text-[rgb(83,100,113)] dark:text-gray-400">{idx + 1} · トレンド</span>
                    </div>
                    <div className="font-bold text-[15px]">{trend.title}</div>
                  </button>
                ))
              ) : (
                <div className="px-4 py-8 text-center text-[rgb(83,100,113)] dark:text-gray-400 text-[14px]">
                  現在、トレンドを取得できません
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ベータラジオセクション */}
      <div className="px-4 pb-6">
        <div className="bg-black/[0.02] dark:bg-white/[0.03] rounded-2xl border border-black/[0.03] dark:border-white/[0.05] overflow-hidden">
          <div className="px-4 py-3 border-b border-black/[0.03] dark:border-white/[0.05] flex items-center gap-2">
            <Radio className="w-5 h-5 text-primary" />
            <h2 className="font-extrabold text-xl">ラジオ</h2>
          </div>

          <div className="p-4 flex items-center justify-between gap-4">
            <div className="min-w-0 flex flex-col gap-1">
              <p className="text-[14px] text-[rgb(83,100,113)] dark:text-gray-400 leading-normal">
                by LimeNote
              </p>
            </div>

            <button
              type="button"
              onClick={isRadioPlaying ? stopRadio : playRadio}
              className="shrink-0 inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-[14px] font-bold text-white hover:opacity-90 transition-opacity"
            >
              {isRadioPlaying ? (
                <>
                  <Square className="w-4 h-4" fill="currentColor" />
                  停止
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" fill="currentColor" />
                  再生
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-transparent text-[rgb(15,20,25)] dark:text-white">
      <div
        className={`sticky top-0 z-50 transition-all duration-300 w-full h-16 flex items-center ${
          isScrolled 
            ? 'max-sm:bg-[#fbf9f2]/70 dark:max-sm:bg-[#000000]/70 max-sm:backdrop-blur-md border-b border-black/[0.03] dark:border-white/[0.05]' 
            : 'bg-transparent'
        }`}
        style={{ position: 'sticky', top: 0 }}
      >
        <div className="max-w-3xl mx-auto w-full px-4">
          <form onSubmit={(e) => { e.preventDefault(); commitSearch(inputValue); }} className="relative">
            <div className={`relative flex items-center h-11 rounded-full transition-all ${
              isInputFocused 
                ? 'bg-white dark:bg-black ring-2 ring-primary' 
                : 'bg-black/5 dark:bg-white/10'
            }`}>
              <Search className={`absolute left-4 w-[18px] h-[18px] ${isInputFocused ? 'text-primary' : 'text-[rgb(83,100,113)] dark:text-gray-400'}`} />
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => { setInputValue(e.target.value); setActiveSuggestIdx(-1); }}
                onFocus={() => setIsInputFocused(true)}
                onKeyDown={onKeyDown}
                placeholder="検索"
                className="w-full h-full bg-transparent border-none pl-11 pr-11 text-[15px] outline-none dark:placeholder-gray-500"
              />
              {inputValue && (
                <button type="button" onClick={() => { setInputValue(''); inputRef.current?.focus(); }} className="absolute right-3 w-5 h-5 flex items-center justify-center bg-primary rounded-full">
                  <X className="w-3 h-3 text-white" strokeWidth={3} />
                </button>
              )}
            </div>

            {isInputFocused && suggestionRows.length > 0 && (
              <div ref={suggestBoxRef} className="absolute left-0 right-0 mt-2 bg-white/95 dark:bg-[#15202b]/95 backdrop-blur-xl rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.1)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.3)] border border-black/5 dark:border-white/10 overflow-hidden max-h-[420px] overflow-y-auto">
                {!inputValue.trim() && history.length > 0 && (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="font-bold text-[15px]">最近の検索</span>
                    <button type="button" onClick={clearHistory} className="text-primary text-[13px] hover:underline">すべて消去</button>
                  </div>
                )}
                {suggestionRows.map((row, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); handleSuggestionSelect(row); }}
                    className={`w-full flex items-center gap-3 px-4 py-3 transition-colors ${
                      idx === activeSuggestIdx 
                        ? 'bg-black/5 dark:bg-white/10' 
                        : 'hover:bg-black/[0.03] dark:hover:bg-white/5'
                    }`}
                  >
                    {row.type === 'search' ? (
                      <>
                        {!inputValue.trim() 
                          ? <Clock className="w-[18px] h-[18px] text-[rgb(83,100,113)] dark:text-gray-400" /> 
                          : <Search className="w-[18px] h-[18px] text-[rgb(83,100,113)] dark:text-gray-400" />
                        }
                        <span className="flex-1 text-[15px] truncate text-left ml-3">{row.value}</span>
                        {!inputValue.trim() && (
                          <span role="button" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); removeHistoryItem(row.value); }} className="p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/20">
                            <X className="w-4 h-4 text-[rgb(83,100,113)] dark:text-gray-400" />
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        {row.user.avatarUrl ? (
                          <img
                            src={row.user.avatarUrl}
                            alt={row.user.displayName}
                            className="w-10 h-10 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-black/5 dark:bg-white/10" />
                        )}
                        <div className="min-w-0 flex flex-col text-left">
                          <span className="flex min-w-0 items-center gap-1">
                            <span className="truncate font-bold text-[15px]">{row.user.displayName}</span>
                            {row.user.isOfficial && (
                              <img
                                src={`${import.meta.env.BASE_URL}verified.png`}
                                alt="Official"
                                className="h-4 w-4 shrink-0 translate-y-[0.5px]"
                                loading="eager"
                              />
                            )}
                          </span>
                          <span className="truncate text-[13px] text-[rgb(83,100,113)] dark:text-gray-400">@{row.user.username}</span>
                        </div>
                      </>
                    )}
                  </button>
                ))}
              </div>
            )}
          </form>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 max-sm:relative max-sm:left-1/2 max-sm:w-screen max-sm:max-w-none max-sm:-translate-x-1/2">
        <Tabs defaultValue="posts" className="w-full">
          <TabsList className="w-full h-[53px] bg-transparent border-b border-black/[0.03] dark:border-white/[0.05] rounded-none p-0 grid grid-cols-2 relative z-20">
            <TabsTrigger value="posts" className="relative h-full bg-transparent text-[15px] font-medium text-[rgb(83,100,113)] dark:text-gray-400 data-[state=active]:text-[rgb(15,20,25)] dark:data-[state=active]:text-white data-[state=active]:font-bold data-[state=active]:bg-transparent data-[state=active]:shadow-none hover:bg-black/[0.03] dark:hover:bg-white/5 transition-colors data-[state=active]:after:content-[''] data-[state=active]:after:absolute data-[state=active]:after:bottom-0 data-[state=active]:after:left-1/2 data-[state=active]:after:-translate-x-1/2 data-[state=active]:after:w-16 data-[state=active]:after:h-1 data-[state=active]:after:rounded-full data-[state=active]:after:bg-primary">
              ポスト
            </TabsTrigger>
            <TabsTrigger value="users" className="relative h-full bg-transparent text-[15px] font-medium text-[rgb(83,100,113)] dark:text-gray-400 data-[state=active]:text-[rgb(15,20,25)] dark:data-[state=active]:text-white data-[state=active]:font-bold data-[state=active]:bg-transparent data-[state=active]:shadow-none hover:bg-black/[0.03] dark:hover:bg-white/5 transition-colors data-[state=active]:after:content-[''] data-[state=active]:after:absolute data-[state=active]:after:bottom-0 data-[state=active]:after:left-1/2 data-[state=active]:after:-translate-x-1/2 data-[state=active]:after:w-16 data-[state=active]:after:h-1 data-[state=active]:after:rounded-full data-[state=active]:after:bg-primary">
              アカウント
            </TabsTrigger>
          </TabsList>

          <TabsContent value="posts" className="mt-4 bg-transparent border-none outline-none">
            {!searchQuery ? renderSearchHomeSections() :
             isPostsLoading && page === 0 ? <div>{Array.from({ length: 5 }).map((_, i) => <RowSkeleton key={i} />)}</div> :
             searchedPosts.length === 0 ? <EmptyHint title={`"${searchQuery}" に一致する結果はありません`} desc="キーワードを変えてみてください。" /> :
             <div className="flex flex-col gap-4 bg-transparent max-sm:gap-0">
               {searchedPosts.map((post: PostWithAuthor) => (
                 <div key={post.id} className="bg-transparent sm:rounded-xl sm:overflow-hidden sm:hover:bg-black/[0.01] sm:dark:hover:bg-white/[0.02] sm:transition-colors">
                   <PostCard post={post} />
                 </div>
               ))}
               
               <div ref={lastElementRef} className="h-20 flex items-center justify-center">
                 {hasMore && searchQuery && <Loader2 className="w-6 h-6 text-primary animate-spin" />}
               </div>
             </div>}
          </TabsContent>

          <TabsContent value="users" className="mt-4 bg-transparent border-none outline-none">
            {!searchQuery ? renderSearchHomeSections() :
             isUsersLoading ? <div>{Array.from({ length: 5 }).map((_, i) => <RowSkeleton key={i} />)}</div> :
             filteredUsers.length === 0 ? <EmptyHint title={`"${searchQuery}" に一致するアカウントはありません`} desc="別のキーワードでお試しください。" /> :
             <div className="flex flex-col gap-2 px-4">
               {filteredUsers.map((user) => (
                 <div key={user.id} className="rounded-xl overflow-hidden hover:bg-black/[0.01] dark:hover:bg-white/[0.02] transition-colors">
                   <UserCard user={user} />
                 </div>
               ))}
             </div>}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function EmptyHint({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="px-8 pt-16 pb-8 text-center max-w-[450px] mx-auto bg-transparent">
      <h2 className="text-[31px] leading-tight font-extrabold text-[rgb(15,20,25)] dark:text-white mb-2">{title}</h2>
      <p className="text-[15px] text-[rgb(83,100,113)] dark:text-gray-400">{desc}</p>
    </div>
  );
}
