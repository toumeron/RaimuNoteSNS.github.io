import {useEffect,useRef} from 'react';

/** Keep paging a visible bottom without overlapping reads. Empty source bursts
 * are paused by the feed and require one new gesture to try again. */
export function useTimelineContinuation({enabled,inView,hasNextPage,isFetching,isFetchNextPageError,automaticPaused,scrollIntent,pageCount,fetchNextPage}:{
 enabled:boolean;inView:boolean;hasNextPage:boolean;isFetching:boolean;isFetchNextPageError:boolean;
 automaticPaused:boolean;scrollIntent:number;pageCount:number;fetchNextPage:(options:{cancelRefetch:boolean})=>Promise<unknown>;
}) {
 const consumedIntent=useRef(0);
 useEffect(()=>{
  if(!enabled||!inView||!hasNextPage||isFetching)return;
  if((automaticPaused||isFetchNextPageError)&&scrollIntent<=consumedIntent.current)return;
  consumedIntent.current=scrollIntent;
  void fetchNextPage({cancelRefetch:false});
 // A warmed page may resolve before React publishes isFetching=true.
 // Its page count still advances, so the visible bottom must be rechecked.
 },[enabled,inView,hasNextPage,isFetching,isFetchNextPageError,automaticPaused,scrollIntent,pageCount,fetchNextPage]);
}
