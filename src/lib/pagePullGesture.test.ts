import { afterEach, expect, it } from 'vitest';
import { isPagePullBlocked } from './pagePullGesture';
afterEach(()=>document.body.replaceChildren());
it('leaves ordinary page pull-to-refresh available',()=>{
 const page=document.createElement('main');document.body.append(page);
 expect(isPagePullBlocked(page)).toBe(false);
});
it.each(['role="dialog" aria-modal="true"','data-lime-audience-sheet','data-lime-mobile-composer','class="lime-media-lightbox"'])('blocks window-level refresh under a portaled surface (%s)',attributes=>{
 document.body.innerHTML=`<main><p id="page">背面</p></main><section ${attributes}><button>ハンドル</button></section>`;
 expect(isPagePullBlocked(document.querySelector('button'))).toBe(true);
 expect(isPagePullBlocked(document.querySelector('#page'))).toBe(true);
 expect(isPagePullBlocked()).toBe(true);
 document.querySelector('section')!.remove();expect(isPagePullBlocked()).toBe(false);
});
it('does not refresh while editing an inline composer',()=>{
 document.body.innerHTML='<textarea></textarea>';
 expect(isPagePullBlocked(document.querySelector('textarea'))).toBe(true);
});
