import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: [] as any[], read: vi.fn(), update: vi.fn(), readError: null as any, writeError: null as any }));
vi.mock('@/lib/supabase', async original => ({ ...await original<typeof import('@/lib/supabase')>(), supabase: { from: () => ({ select: () => ({ in: async (...args: any[]) => { state.read(...args); return { data: state.rows, error: state.readError }; } }), update: (patch: any) => { state.update(patch); const q:any = { eq: () => q, select: () => q, single: async () => ({ data: { id: 'viewer', avatar_url: 'https://example.com/unchanged.png' }, error: state.writeError }) }; return q; } }) } }));
import { Avatar, AvatarImage, AvatarFallback, setAvatarSantaSnapshot, AvatarDecorationOverlay, parseAvatarDecoration } from './avatar';
import { updateProfile } from '@/api/users';
const a='a1111111-1111-4111-8111-111111111111', b='b2222222-2222-4222-8222-222222222222';
afterEach(cleanup);
it('batches cloud reads and overlays the hat without replacing or wrapping the original image source', async () => {
 state.rows=[{id:a,avatar_url:'https://example.com/a.png',avatar_decoration:'santa'},{id:b,avatar_url:'https://example.com/b.png',avatar_decoration:null}];
 const {container}=render(<><Avatar userId={a}><AvatarImage src="https://example.com/a.png"/><AvatarFallback>A</AvatarFallback></Avatar><Avatar userId={b}><AvatarImage src="https://example.com/b.png"/><AvatarFallback>B</AvatarFallback></Avatar></>);
 await waitFor(()=>expect(container.querySelectorAll('img[src$="santa-hat.svg"]')).toHaveLength(1));
 expect(state.read).toHaveBeenCalledWith('id',expect.arrayContaining([a,b]));
 const decorated=container.firstElementChild!;
 expect(decorated.className).toContain('overflow-visible');
 expect(decorated.querySelector('img[src$="santa-hat.svg"]')?.getAttribute('aria-hidden')).toBe('true');
 act(()=>setAvatarSantaSnapshot(a,'https://example.com/a.png',false));
 expect(container.querySelector('img[src$="santa-hat.svg"]')).toBeNull();
});
it('saves only decoration metadata and leaves the avatar URL untouched when enabling and disabling', async () => {
 await updateProfile('viewer',{santaHat:true}); expect(state.update).toHaveBeenLastCalledWith({avatar_decoration:'santa',avatar_decoration_options:null});
 await updateProfile('viewer',{santaHat:false}); expect(state.update).toHaveBeenLastCalledWith({avatar_decoration:null,avatar_decoration_options:null});
});

it.each(['santa','sunglasses','censored','sleep'] as const)('saves %s with cloud transforms and renders them as an overlay', async type => {
 const decoration = {type,angle:35,x:-14,y:22,flip:true};
 await updateProfile('viewer',{avatarDecoration:decoration});
 expect(state.update).toHaveBeenLastCalledWith({avatar_decoration:type,avatar_decoration_options:{angle:35,x:-14,y:22,flip:true}});
 const {container}=render(<AvatarDecorationOverlay decoration={decoration}/>);
 const image=container.querySelector('img')!;
 expect(image.dataset.avatarDecoration).toBe(type);
 expect(image.style.transform).toBe('rotate(35deg) scaleX(-1)');
 expect(parseAvatarDecoration(type,{angle:35,x:-14,y:22,flip:true})).toEqual(decoration);
});
it('rejects unsafe transforms and clears both cloud fields when removing a decoration', async () => {
 for(const invalid of [{type:'unknown',angle:0,x:0,y:0,flip:false},{type:'santa',angle:181,x:0,y:0,flip:false},{type:'sunglasses',angle:0,x:Infinity,y:0,flip:false}]) {
  await expect(updateProfile('viewer',{avatarDecoration:invalid as any})).rejects.toThrow('設定を確認');
 }
 await updateProfile('viewer',{avatarDecoration:null});
 expect(state.update).toHaveBeenLastCalledWith({avatar_decoration:null,avatar_decoration_options:null});
 expect(parseAvatarDecoration('santa')).toEqual({type:'santa',angle:0,x:0,y:0,flip:false});
 for (const removed of ['restricted','hearts','anger','crown']) expect(parseAvatarDecoration(removed)).toBeNull();
});

it('reports a missing migration accurately and suppresses repeated missing-column reads', async () => {
 state.writeError={code:'PGRST204',message:'column does not exist'};
 await expect(updateProfile('viewer',{santaHat:true})).rejects.toThrow('デコレーションを保存できませんでした。しばらくしてからお試しください。');
 state.writeError=null; state.readError={code:'42703'};
 const before=state.read.mock.calls.length;
 const view=render(<Avatar userId="c3333333-3333-4333-8333-333333333333"><AvatarFallback>C</AvatarFallback></Avatar>);
 await waitFor(()=>expect(state.read.mock.calls.length).toBeGreaterThan(before));
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,25));});
 view.unmount(); const count=state.read.mock.calls.length;
 render(<Avatar userId="d4444444-4444-4444-8444-444444444444"><AvatarFallback>D</AvatarFallback></Avatar>);
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,25));});
 expect(state.read.mock.calls).toHaveLength(count);
 state.readError=null;
});
