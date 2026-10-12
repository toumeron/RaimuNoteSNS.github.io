// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('node:dns/promises',()=>{const lookup=vi.fn(async()=>[{address:'1.1.1.1',family:4}]);return {lookup,default:{lookup}};});
import {page} from '../../supabase/functions/link-preview/http';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('closes a socket whose connect completes after the request timeout',async()=>{
 vi.useFakeTimers();let resolve;
 const close=vi.fn(),write=vi.fn();
 vi.stubGlobal('Deno',{connect:()=>new Promise(done=>{resolve=done;})});
 const pending=page(new URL('http://example.com/'));
 const rejected=expect(pending).rejects.toThrow('Timeout');
 await vi.advanceTimersByTimeAsync(10001);await rejected;
 resolve({close,write});await Promise.resolve();await Promise.resolve();
 expect(close).toHaveBeenCalledOnce();expect(write).not.toHaveBeenCalled();
});
