import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useRecommendationImpressions } from './useRecommendationImpressions';
import { readRecommendationImpressions } from '@/lib/recommendations';
let callback:IntersectionObserverCallback;
beforeEach(()=>{
  localStorage.clear();vi.useFakeTimers();
  vi.spyOn(document,'hidden','get').mockReturnValue(false);
  vi.stubGlobal('IntersectionObserver',class {
    constructor(cb:IntersectionObserverCallback){callback=cb;}
    observe(){} unobserve(){} disconnect(){}
  });
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
function Probe({enabled=true}:{enabled?:boolean}) {useRecommendationImpressions(enabled,'viewer');return <div data-lime-recommendation-post="post">投稿</div>;}
function visible(target:Element,height=300){act(()=>callback([{target,isIntersecting:height>0,intersectionRect:{height},boundingClientRect:{height:600}}] as any,{} as any));}
it('records only sufficiently visible posts after a sustained impression',()=>{
  const view=render(<Probe/>);const card=view.getByText('投稿');
  visible(card,80);act(()=>vi.advanceTimersByTime(2000));expect(readRecommendationImpressions('viewer')).toEqual({});
  visible(card);act(()=>vi.advanceTimersByTime(1499));expect(readRecommendationImpressions('viewer')).toEqual({});
  act(()=>vi.advanceTimersByTime(1));expect(readRecommendationImpressions('viewer').post.count).toBe(1);
  visible(card);act(()=>vi.advanceTimersByTime(2000));expect(readRecommendationImpressions('viewer').post.count).toBe(1);
});
it('does not count quick scrolls or impressions after leaving the recommended tab',()=>{
  const view=render(<Probe/>);const card=view.getByText('投稿');
  visible(card);act(()=>vi.advanceTimersByTime(500));visible(card,0);act(()=>vi.advanceTimersByTime(2000));
  expect(readRecommendationImpressions('viewer')).toEqual({});
  visible(card);view.rerender(<Probe enabled={false}/>);act(()=>vi.advanceTimersByTime(2000));
  expect(readRecommendationImpressions('viewer')).toEqual({});
});
it('cancels impressions when the browser tab becomes hidden',()=>{
  const view=render(<Probe/>);visible(view.getByText('投稿'));
  vi.spyOn(document,'hidden','get').mockReturnValue(true);
  act(()=>document.dispatchEvent(new Event('visibilitychange')));
  act(()=>vi.advanceTimersByTime(2000));
  expect(readRecommendationImpressions('viewer')).toEqual({});
});
