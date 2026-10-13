import {renderHook} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {useTimelineContinuation} from './useTimelineContinuation';

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
