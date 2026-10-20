import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { readSharedDisplay, setSharedDisplay, SHARED_DISPLAY_KEY, useSharedDisplay } from "@/lib/externalAccounts";
import { type Session } from "@supabase/supabase-js";
import { activateAccountIntegrations, getSavedAccountTokens, markSavedAccountNeedsLogin, readSavedAccounts, removeSavedAccount, saveAccountSession, SAVED_ACCOUNTS_KEY } from "@/lib/savedAccounts";

describe("sharedAccountDisplay", () => {
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
});

describe("savedAccounts", () => {
const session=(id:string, token=`access-${id}`)=>({user:{id,email:`${id}@example.invalid`,user_metadata:{username:id,display_name:id}},access_token:token,refresh_token:`refresh-${id}`} as unknown as Session);
beforeEach(()=>localStorage.clear());
it('keeps multiple sessions and upserts rotated tokens without exposing them in UI summaries',()=>{
  saveAccountSession(session('alice'));saveAccountSession(session('bob'));
  saveAccountSession(session('alice','rotated'),{displayName:'Alice',avatarUrl:'/alice.png'});
  expect(readSavedAccounts()).toEqual([{id:'alice',username:'alice',displayName:'Alice',avatarUrl:'/alice.png',needsLogin:false},{id:'bob',username:'bob',displayName:'bob',avatarUrl:'',needsLogin:false}]);
  expect(getSavedAccountTokens('alice')?.access_token).toBe('rotated');
  expect(JSON.stringify(readSavedAccounts())).not.toContain('refresh-');
});
it('forgets only the selected session and marks revoked sessions for re-login',()=>{
  saveAccountSession(session('alice'));saveAccountSession(session('bob'));
  markSavedAccountNeedsLogin('bob');expect(getSavedAccountTokens('bob')).toBeNull();
  expect(readSavedAccounts().find(a=>a.id==='bob')?.needsLogin).toBe(true);
  removeSavedAccount('bob');expect(readSavedAccounts().map(a=>a.id)).toEqual(['alice']);
});
it('retains the database verification badge on token refresh and when re-login is needed',()=>{
  saveAccountSession(session('alice'),{isOfficial:true});
  saveAccountSession(session('alice','rotated'));
  expect(readSavedAccounts()[0].isOfficial).toBe(true);
  markSavedAccountNeedsLogin('alice');
  expect(readSavedAccounts()[0]).toMatchObject({isOfficial:true,needsLogin:true});
  saveAccountSession(session('alice'),{isOfficial:false});
  expect(readSavedAccounts()[0].isOfficial).toBe(false);
});
it('ignores corrupt storage and malformed entries rather than accepting their tokens',()=>{
  localStorage.setItem(SAVED_ACCOUNTS_KEY,'broken');expect(readSavedAccounts()).toEqual([]);
  localStorage.setItem(SAVED_ACCOUNTS_KEY,JSON.stringify([{id:'bad'},null]));expect(readSavedAccounts()).toEqual([]);
});
it('isolates Bluesky sessions and author settings between LimeNote accounts',()=>{
  localStorage.setItem('lime_bluesky_session','alice-bsky');localStorage.setItem('lime_bluesky_author_handles','["alice.bsky.social"]');
  activateAccountIntegrations(undefined,'alice');activateAccountIntegrations('alice','bob');
  expect(localStorage.getItem('lime_bluesky_session')).toBeNull();
  localStorage.setItem('lime_bluesky_session','bob-bsky');
  activateAccountIntegrations('bob','alice');expect(localStorage.getItem('lime_bluesky_session')).toBe('alice-bsky');
  expect(localStorage.getItem('lime_bluesky_author_handles')).toBe('["alice.bsky.social"]');
  // A second tab receiving the same switch must not overwrite Bob with Alice.
  activateAccountIntegrations('bob','alice');activateAccountIntegrations('alice','bob');
  expect(localStorage.getItem('lime_bluesky_session')).toBe('bob-bsky');
});
it('reload keeps the latest active Bluesky login rather than restoring an older switch snapshot',()=>{
 localStorage.setItem('lime_bluesky_session','old-session');activateAccountIntegrations(undefined,'alice');
 localStorage.setItem('lime_bluesky_session','new-login');
 activateAccountIntegrations(undefined,'alice');expect(localStorage.getItem('lime_bluesky_session')).toBe('new-login');
 activateAccountIntegrations('alice','bob');activateAccountIntegrations('bob','alice');
 expect(localStorage.getItem('lime_bluesky_session')).toBe('new-login');
});
it('reload preserves an explicit Bluesky logout instead of resurrecting the stale session',()=>{
 localStorage.setItem('lime_bluesky_session','old-session');activateAccountIntegrations(undefined,'alice');
 localStorage.removeItem('lime_bluesky_session');activateAccountIntegrations(undefined,'alice');
 expect(localStorage.getItem('lime_bluesky_session')).toBeNull();
});
});
