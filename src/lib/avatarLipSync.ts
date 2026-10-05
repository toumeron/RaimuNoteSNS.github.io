export type Vowel = "aa" | "ih" | "ou" | "ee" | "oh";
export type Emotion = "neutral" | "happy" | "sad" | "angry" | "surprised" | "relaxed";

const ROWS: [Vowel, string][] = [
  ["aa", "あかさたなはまやらわがざだばぱぁゃゎ"],
  ["ih", "いきしちにひみりぎじぢびぴぃゐ"],
  ["ou", "うくすつぬふむゆるぐずづぶぷぅゅゔ"],
  ["ee", "えけせてねへめれげぜでべぺぇゑ"],
  ["oh", "おこそとのほもよろをごぞどぼぽぉょ"],
];
const MAP = new Map<string, Vowel>();
for (const [v, chars] of ROWS) for (const c of chars) MAP.set(c, v);
const LATIN: Record<string, Vowel> = { a: "aa", i: "ih", u: "ou", e: "ee", o: "oh" };
const VOWELS: Vowel[] = ["aa", "ih", "ou", "ee", "oh"];
const AMP: Record<Vowel, number> = { aa: 1, oh: 0.85, ee: 0.65, ih: 0.5, ou: 0.55 };

const PAUSE = /[、。，．,.!?！？\n\s…・「」『』()（）:：;；]/;

function toHiragana(ch: string) {
  const c = ch.charCodeAt(0);
  return c >= 0x30a1 && c <= 0x30f6 ? String.fromCharCode(c - 0x60) : ch;
}

type Sample = { vowel: Vowel; open: number; pause: boolean };

export class LipSync {
  private text = "";
  private baseIndex = 0;
  private baseTime = 0;
  private rate = 1;
  private lastVowel: Vowel = "aa";
  active = false;

  begin(text: string, rate: number) {
    this.text = text;
    this.rate = rate;
    this.baseIndex = 0;
    this.baseTime = performance.now();
    this.active = true;
  }

  /** Called when a new utterance chunk starts: text is the full text, offset is chunk offset. */
  chunk(offset: number) {
    this.baseIndex = offset;
    this.baseTime = performance.now();
  }

  boundary(charIndex: number) {
    this.baseIndex = charIndex;
    this.baseTime = performance.now();
  }

  end() {
    this.active = false;
  }

  /** Estimated index (float) of the character currently being pronounced. */
  position(now: number) {
    return this.active ? this.baseIndex + ((now - this.baseTime) / 1000) * 7.2 * this.rate : 0;
  }

  sample(now: number): Sample {
    if (!this.active || !this.text) return { vowel: "aa", open: 0, pause: true };
    const cps = 7.2 * this.rate;
    const pos = this.baseIndex + ((now - this.baseTime) / 1000) * cps;
    // 文字数を超えて推定位置が進んだ場合は口を閉じる(最後の文字で口が開きっぱなしになるのを防ぐ)
    if (pos >= this.text.length + 1) return { vowel: this.lastVowel, open: 0, pause: true };
    const i = Math.min(Math.floor(pos), this.text.length - 1);
    if (i < 0) return { vowel: this.lastVowel, open: 0, pause: true };
    let frac = pos - Math.floor(pos);
    const raw = this.text[i];
    const ch = toHiragana(raw).toLowerCase();
    if (PAUSE.test(ch)) return { vowel: this.lastVowel, open: 0, pause: true };
    let vowel: Vowel | undefined = MAP.get(ch);
    if (ch === "ー") vowel = this.lastVowel;
    else if (ch === "ん" || ch === "っ") return { vowel: this.lastVowel, open: 0.08, pause: false };
    else if (LATIN[ch]) vowel = LATIN[ch];
    else if (!vowel) {
      // 漢字などは2音節ぶんとして扱い、前半・後半で母音を変える(口の動きが自然になる)
      const half = frac < 0.5 ? 0 : 1;
      vowel = VOWELS[(raw.charCodeAt(0) * 7 + i + half * 3) % 5];
      frac = (frac * 2) % 1;
    }
    this.lastVowel = vowel;
    // syllable envelope: open quickly, close before the next character
    const env = Math.sin(Math.PI * Math.min(1, frac * 0.95 + 0.04));
    return { vowel, open: Math.max(0.12, env) * AMP[vowel], pause: false };
  }
}

