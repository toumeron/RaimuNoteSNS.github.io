import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { readSharedDisplay, setSharedDisplay, SHARED_DISPLAY_KEY, useSharedDisplay } from './sharedAccountDisplay';
beforeEach(()=>localStorage.removeItem(SHARED_DISPLAY_KEY));
afterEach(cleanup);
it('defaults off and shares one saved preference between mounted account views',()=>{
 const a=renderHook(useSharedDisplay),b=renderHook(useSharedDisplay);
 expect(a.result.current).toBe(false);
 act(()=>setSharedDisplay(true));expect(a.result.current).toBe(true);expect(b.result.current).toBe(true);
 expect(localStorage.getItem(SHARED_DISPLAY_KEY)).toBe('true');
 a.unmount();const c=renderHook(useSharedDisplay);expect(c.result.current).toBe(true);
 act(()=>setSharedDisplay(false));expect(b.result.current).toBe(false);expect(c.result.current).toBe(false);
});
it('reacts to another tab changing or clearing the common preference',()=>{
 const view=renderHook(useSharedDisplay);
 act(()=>{localStorage.setItem(SHARED_DISPLAY_KEY,'true');window.dispatchEvent(new StorageEvent('storage',{key:SHARED_DISPLAY_KEY}));});
 expect(view.result.current).toBe(true);
 act(()=>{localStorage.clear();window.dispatchEvent(new StorageEvent('storage',{key:null}));});
 expect(view.result.current).toBe(false);expect(readSharedDisplay()).toBe(false);
});
