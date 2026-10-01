import { expect, it } from 'vitest';
import { classifyAvatarMorph } from './avatarMorphs';
it.each([
  ['Face_Blendshape.Fcl_MTH_A', 'aa'], ['vrc.v_ih', 'ih'], ['viseme_ou', 'ou'], ['Fcl_MTH_E', 'ee'], ['mouth_open', 'aa'], ['jawOpen', 'aa'], ['vrc.v_oh', 'oh'],
])('supports mouth convention %s', (name, vowel) => expect(classifyAvatarMorph(name).vowel).toBe(vowel));
it.each(['eyeBlinkLeft', 'eyeBlinkRight', 'Face_Blendshape.Fcl_EYE_Close', 'blink'])('supports blink convention %s', (name) => expect(classifyAvatarMorph(name).blink).toBe(true));
it('keeps unrelated facial morphs neutral and identifies RobotExpressive emotions', () => {
  expect(classifyAvatarMorph('extra')).toEqual({ vowel: null, emotion: null, blink: false });
  expect(classifyAvatarMorph('Surprised').emotion).toBe('surprised');
  expect(classifyAvatarMorph('Sad').emotion).toBe('sad');
});
