import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({enabled:false,loaded:0}));
vi.mock('@/lib/aiFriends',()=>({useCompanion:()=>({enabled:fixture.enabled})}));
vi.mock('./PageCompanion',()=>{fixture.loaded++;return{PageCompanion:({userId}:any)=><span>Companion {userId}</span>};});
import {PageCompanion} from './PageCompanionGate';
afterEach(cleanup);
it('loads companion UI only after it is enabled',async()=>{
 const view=render(<PageCompanion userId="viewer"/>);expect(fixture.loaded).toBe(0);
 fixture.enabled=true;view.rerender(<PageCompanion userId="viewer"/>);expect(await screen.findByText('Companion viewer')).toBeTruthy();
 fixture.enabled=false;view.rerender(<PageCompanion userId="viewer"/>);expect(screen.queryByText('Companion viewer')).toBeNull();
});
