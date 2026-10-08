import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerPwa } from './registerPwa';

describe('PWA startup registration', () => {
  beforeEach(()=>vi.stubEnv('DEV',false));
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();vi.unstubAllEnvs(); });
  function worker() {
    const register = vi.fn().mockResolvedValue({});
    vi.stubGlobal('navigator', { serviceWorker: { register } });
    return register;
  }
  it('waits for page load and idle time instead of competing with startup', () => {
    const register = worker();
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    let idleCallback: IdleRequestCallback | undefined;
    vi.stubGlobal('requestIdleCallback', vi.fn((callback: IdleRequestCallback) => { idleCallback = callback; return 1; }));
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    const cancel = registerPwa();
    expect(register).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('load'));
    expect(register).not.toHaveBeenCalled();
    idleCallback!({ didTimeout: false, timeRemaining: () => 50 });
    expect(register).toHaveBeenCalledWith('/RaimuNoteSNS.github.io/sw.js', { scope: '/RaimuNoteSNS.github.io/', updateViaCache: 'none' });
    cancel();
  });
  it('uses the actual Vite development worker URL instead of the HTML fallback',()=>{
    vi.stubEnv('DEV',true);vi.useFakeTimers();const register=worker();
    vi.spyOn(document,'readyState','get').mockReturnValue('complete');vi.stubGlobal('requestIdleCallback',undefined);
    registerPwa();vi.runAllTimers();
    expect(register).toHaveBeenCalledWith('/RaimuNoteSNS.github.io/dev-sw.js?dev-sw',{scope:'/RaimuNoteSNS.github.io/',updateViaCache:'none'});
  });
  it('cancels registration and uses a delayed fallback without idle support', () => {
    vi.useFakeTimers();
    const register = worker();
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
    vi.stubGlobal('requestIdleCallback', undefined);
    const cancel = registerPwa();
    cancel(); vi.runAllTimers();
    expect(register).not.toHaveBeenCalled();
  });
  it('does not attach a controller-change reload handler', () => {
    const register = worker();
    vi.useFakeTimers();
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
    const listeners = vi.spyOn(window, 'addEventListener');
    registerPwa();
    expect(listeners.mock.calls.some(([name]) => name === 'controllerchange')).toBe(false);
    expect(register).not.toHaveBeenCalled();
  });
});
