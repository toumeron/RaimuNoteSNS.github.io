import {act,cleanup,renderHook} from '@testing-library/react';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {readVideoMuted,useVideoMutedPreference} from './videoSoundPreference';
beforeEach(()=>localStorage.clear());afterEach(cleanup);
it('shares the last explicit mute choice across players and reopening',()=>{
 const first=renderHook(()=>useVideoMutedPreference()),second=renderHook(()=>useVideoMutedPreference());
 expect(first.result.current[0]).toBe(true);
 act(()=>first.result.current[1](false));expect(second.result.current[0]).toBe(false);expect(readVideoMuted()).toBe(false);
 first.unmount();const reopened=renderHook(()=>useVideoMutedPreference());expect(reopened.result.current[0]).toBe(false);
 act(()=>reopened.result.current[1](true));expect(second.result.current[0]).toBe(true);reopened.unmount();expect(renderHook(()=>useVideoMutedPreference()).result.current[0]).toBe(true);
});
