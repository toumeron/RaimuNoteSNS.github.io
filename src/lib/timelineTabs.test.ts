import {expect,it} from 'vitest';
import { AVAILABLE_TIMELINE_TABS, isFeedTabValue, normalizeTimelineTabs } from "@/components/feed/TimelineTabBar";

it('removes a saved recommended tab while preserving followed feeds, lists, and topics',()=>{
 const list='list:01234567-89ab-cdef-0123-456789abcdef';
 expect(normalizeTimelineTabs(['recommended','following',list,'topic:digital-illustration'])).toEqual(['following',list,'topic:digital-illustration']);
 expect(isFeedTabValue('recommended')).toBe(false);
 expect(AVAILABLE_TIMELINE_TABS.some(tab=>String(tab.value)==='recommended')).toBe(false);
});
it('restores the remaining default tabs when only the retired tab was saved',()=>{
 expect(normalizeTimelineTabs(['recommended'])).toEqual(['all','following','trending']);
});
