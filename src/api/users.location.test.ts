import { beforeEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({patch:{} as Record<string,unknown>,selection:'',row:{id:'author',username:'author',display_name:'Author',bio:'',location:'ホットプレート'}}));
vi.mock('@/lib/supabase',()=>({supabase:{from:()=>{const query={select:(columns:string)=>{state.selection=columns;return query;},eq:()=>query,single:async()=>({data:{...state.row,...state.patch},error:null}),update:(patch:Record<string,unknown>)=>{state.patch=patch;return query;}};return query;}}}));
import {getUserByUsername,updateProfile} from './users';
beforeEach(()=>{state.patch={};state.selection='';});
it('loads the freeform location with the profile',async()=>{
  expect((await getUserByUsername('author'))?.location).toBe('ホットプレート');
  expect(state.selection.split(', ')).toContain('location');
});
it('saves arbitrary text without treating it as coordinates or markup and allows clearing',async()=>{
  expect((await updateProfile('author',{location:'  ホットプレート <script>text</script>  '})).location).toBe('ホットプレート <script>text</script>');
  expect(state.patch).toEqual({location:'ホットプレート <script>text</script>'});
  expect((await updateProfile('author',{location:''})).location).toBe('');
});
it('keeps the location unchanged when saving unrelated profile settings',async()=>{
  await updateProfile('author',{bio:'自己紹介'});
  expect(state.patch).toEqual({bio:'自己紹介'});
});
