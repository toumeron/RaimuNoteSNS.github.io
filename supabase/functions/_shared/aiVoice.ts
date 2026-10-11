// Fish Audio's Japanese “落ち着いた女性” from its official soft-voice library:
// https://fish.audio/ja/app/m/0089dce5fefb4c6ba9b9f2f0debe1ddc/
export const CALM_FEMALE_VOICE_ID = '0089dce5fefb4c6ba9b9f2f0debe1ddc';
export const CALM_FEMALE_VOICE_NAME = '落ち着いた女性';
export const PCM_SAMPLE_RATE = 24000;

// Japanese conversational male voice: https://fish.audio/ja/m/de5f57933d304c8faedb8244e3f991d9/
export const JAPANESE_MALE_VOICE_ID = 'de5f57933d304c8faedb8244e3f991d9';
export function resolveVoiceId(opts: { voiceURI?: string; gender?: 'female' | 'male' }) {
  return opts.voiceURI || (opts.gender === 'male' ? JAPANESE_MALE_VOICE_ID : CALM_FEMALE_VOICE_ID);
}
