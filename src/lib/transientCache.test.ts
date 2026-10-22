import {afterEach,expect,it,vi} from 'vitest';
import {TransientCache,sweepTransientCaches} from "@/lib/utils";
const used:TransientCache<string,number>[]=[];
function cache(){const value=new TransientCache<string,number>(1000,4,2);used.push(value);return value;}
afterEach(()=>{used.splice(0).forEach(value=>value.dispose());vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('uses a smaller PWA budget while preserving the most recently read results',()=>{
 vi.stubGlobal('navigator',{standalone:true});const value=cache();value.set('a',1).set('b',2);expect(value.get('a')).toBe(1);value.set('c',3);
 expect(value.get('b')).toBeUndefined();expect(value.get('a')).toBe(1);expect(value.size).toBe(2);
});
it('releases expired values on access and background sweeping without timers',()=>{
 vi.useFakeTimers();const value=cache();value.set('a',1).set('b',2);vi.advanceTimersByTime(1001);
 expect(value.get('a')).toBeUndefined();sweepTransientCaches();expect(value.size).toBe(0);expect(vi.getTimerCount()).toBe(0);
});
