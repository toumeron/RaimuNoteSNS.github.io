export type AvatarVowel = 'aa' | 'ih' | 'ou' | 'ee' | 'oh';
export type AvatarEmotion = 'happy' | 'sad' | 'angry' | 'surprised' | 'relaxed';

/** Common glTF/FBX morph conventions: VRoid, Ready Player Me, VRChat and ARKit. */
export function classifyAvatarMorph(name: string) {
  const n = name.toLowerCase().replace(/[\s_.:-]/g, '');
  const vowelPatterns: [AvatarVowel, RegExp][] = [
    ['aa', /^(aa|a|あ|mouthopen|jawopen|visemeaa|mtha|fclmtha|vrcvaa)$|fclmtha$/],
    ['ih', /^(ih|i|い|visemeih|mthi|fclmthi|vrcvih)$|fclmthi$/],
    ['ou', /^(ou|u|う|visemeou|mthu|fclmthu|vrcvou)$|fclmthu$/],
    ['ee', /^(ee|e|え|visemeee|mthe|fclmthe|vrcvee)$|fclmthe$/],
    ['oh', /^(oh|o|お|visemeoh|mtho|fclmtho|vrcvoh)$|fclmtho$/],
  ];
  const emotionPatterns: [AvatarEmotion, RegExp][] = [
    ['happy', /^(happy|joy|smile|mouthsmile(left|right)?)$|fclalljoy$/],
    ['sad', /^(sad|sorrow)$|fclallsorrow$/],
    ['angry', /^(angry|anger)$|fclallangry$/],
    ['surprised', /^(surprised|surprise|shock)$|fclallsurprised$/],
    ['relaxed', /^(relaxed|relax|calm)$|fclallfun$/],
  ];
  return {
    vowel: vowelPatterns.find(([, pattern]) => pattern.test(n))?.[0] ?? null,
    emotion: emotionPatterns.find(([, pattern]) => pattern.test(n))?.[0] ?? null,
    blink: /^(blink|eyeblink(left|right)?|eyeclose(left|right)?|eyesclosed)$|fcleyeclose(left|right|l|r)?$/.test(n),
  };
}
