import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useRecommendationImpressions } from "@/hooks/useRecommendationImpressions";
import { readRecommendationImpressions } from "@/lib/recommendations";
import { useTrendViews, readTrendViews } from "@/hooks/useTrendViews";
import { useTimelineContinuation } from "@/hooks/useRecommendationImages";

describe("useRecommendationImpressions", () => {
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
});

describe("useTrendViews", () => {
let useTrendViewsTestCallback:IntersectionObserverCallback;
beforeEach(()=>{
  localStorage.clear();vi.useFakeTimers();
  vi.spyOn(document,'hidden','get').mockReturnValue(false);
  vi.stubGlobal('IntersectionObserver',class {
    constructor(cb:IntersectionObserverCallback){useTrendViewsTestCallback=cb;}
    observe(){} unobserve(){} disconnect(){}
  });
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
function UseTrendViewsTestProbe({enabled=true}:{enabled?:boolean}) {useTrendViews(enabled,expect.getState().currentTestName!);return <div data-lime-trend-post="post">投稿</div>;}
function useTrendViewsTestVisible(target:Element,height=300){act(()=>useTrendViewsTestCallback([{target,isIntersecting:height>0,intersectionRect:{height},boundingClientRect:{height:600}}] as any,{} as any));}
it('records only sufficiently visible posts after a sustained impression',()=>{
  const view=render(<UseTrendViewsTestProbe/>);const card=view.getByText('投稿');
  useTrendViewsTestVisible(card,80);act(()=>vi.advanceTimersByTime(2000));expect(readTrendViews(expect.getState().currentTestName!)).toEqual(new Set());
  useTrendViewsTestVisible(card);act(()=>vi.advanceTimersByTime(1499));expect(readTrendViews(expect.getState().currentTestName!)).toEqual(new Set());
  act(()=>vi.advanceTimersByTime(1));expect(readTrendViews(expect.getState().currentTestName!).has('post')).toBe(true);
  useTrendViewsTestVisible(card);act(()=>vi.advanceTimersByTime(2000));expect(readTrendViews(expect.getState().currentTestName!).has('post')).toBe(true);
});
it('does not count quick scrolls or impressions after leaving the trend tab',()=>{
  const view=render(<UseTrendViewsTestProbe/>);const card=view.getByText('投稿');
  useTrendViewsTestVisible(card);act(()=>vi.advanceTimersByTime(500));useTrendViewsTestVisible(card,0);act(()=>vi.advanceTimersByTime(2000));
  expect(readTrendViews(expect.getState().currentTestName!)).toEqual(new Set());
  useTrendViewsTestVisible(card);view.rerender(<UseTrendViewsTestProbe enabled={false}/>);act(()=>vi.advanceTimersByTime(2000));
  expect(readTrendViews(expect.getState().currentTestName!)).toEqual(new Set());
});
it('cancels impressions when the browser tab becomes hidden',()=>{
  const view=render(<UseTrendViewsTestProbe/>);useTrendViewsTestVisible(view.getByText('投稿'));
  vi.spyOn(document,'hidden','get').mockReturnValue(true);
  act(()=>document.dispatchEvent(new Event('visibilitychange')));
  act(()=>vi.advanceTimersByTime(2000));
  expect(readTrendViews(expect.getState().currentTestName!)).toEqual(new Set());
});
});

describe("useTimelineContinuation", () => {
it('retries a failed continuation once per new scroll gesture without a request loop',()=>{
 const fetchNextPage=vi.fn(async()=>{});
 const options={enabled:true,inView:true,hasNextPage:true,isFetching:false,isFetchNextPageError:true,automaticPaused:false,scrollIntent:0,pageCount:4,fetchNextPage};
 const view=renderHook(props=>useTimelineContinuation(props),{initialProps:options});
 expect(fetchNextPage).not.toHaveBeenCalled();
 view.rerender({...options,scrollIntent:1});expect(fetchNextPage).toHaveBeenCalledTimes(1);
 view.rerender({...options,scrollIntent:1,isFetching:true});
 view.rerender({...options,scrollIntent:1,pageCount:5});expect(fetchNextPage).toHaveBeenCalledTimes(1);
 view.rerender({...options,scrollIntent:2,pageCount:5});expect(fetchNextPage).toHaveBeenCalledTimes(2);
 view.unmount();
});

it('continues each prepared scroll batch even when fetching resolves before React can render its loading state',()=>{
 const fetchNextPage=vi.fn(async()=>{});
 const options={enabled:true,inView:true,hasNextPage:true,isFetching:false,isFetchNextPageError:false,automaticPaused:false,scrollIntent:0,pageCount:0,fetchNextPage};
 const view=renderHook(props=>useTimelineContinuation(props),{initialProps:options});
 expect(fetchNextPage).toHaveBeenCalledTimes(1);
 for(let pageCount=1;pageCount<=20;pageCount++){
  view.rerender({...options,pageCount});expect(fetchNextPage).toHaveBeenCalledTimes(pageCount+1);
 }
 view.rerender({...options,pageCount:21,hasNextPage:false});expect(fetchNextPage).toHaveBeenCalledTimes(21);view.unmount();
});
});
