import {beforeEach,expect,it} from 'vitest';
import {DEFAULT_COMPANION,readCompanion,updateCompanion,companionKey} from './companionPreferences';
beforeEach(()=>localStorage.clear());
it('keeps characters disabled by default and isolates selections per account',()=>{
 expect(readCompanion('a')).toEqual(DEFAULT_COMPANION);updateCompanion('a',{enabled:true,modelId:'uploaded',x:70,y:80});expect(readCompanion('a').modelId).toBe('uploaded');expect(readCompanion('a').x).toBe(70);expect(readCompanion('b')).toEqual(DEFAULT_COMPANION);
});
it('recovers corrupt settings and bounds model size without restricting placement',()=>{
 localStorage.setItem(companionKey('a'),'bad');expect(readCompanion('a')).toEqual(DEFAULT_COMPANION);localStorage.setItem(companionKey('a'),JSON.stringify({enabled:true,size:5000,x:'bad'}));expect(readCompanion('a').size).toBe(360);expect(readCompanion('a').x).toBeNull();updateCompanion('a',{x:-50,y:999,viewportWidth:390,viewportHeight:844});expect(readCompanion('a').x).toBe(-50);expect(readCompanion('a').y).toBe(999);
});
