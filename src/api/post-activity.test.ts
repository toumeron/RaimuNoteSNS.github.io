import {beforeEach,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({blue:vi.fn(),twitter:vi.fn(),quotes:vi.fn(),reposts:vi.fn()}));
vi.mock('@/lib/bluesky',()=>({fetchBlueskyPostActivity:m.blue}));
vi.mock('@/lib/fxTwitter',()=>({fetchTwitterPostActivity:m.twitter}));
vi.mock('./posts',()=>({getPostQuotes:m.quotes,getPostReposters:m.reposts}));
vi.mock('@/lib/timelinePaging',()=>({normalizeTimelineBlueskyPost:(post:unknown)=>post}));
import {getExternalPostActivity} from './post-activity';
beforeEach(()=>{vi.clearAllMocks();m.blue.mockResolvedValue({users:[],posts:[],cursor:null});m.twitter.mockResolvedValue({users:[],posts:[],cursor:null});m.quotes.mockResolvedValue([]);m.reposts.mockResolvedValue([]);});
const post=(id:string,likesCount=1)=>({id,likesCount,createdAt:'2026-10-17'});
it('combines provider quotes with LimeNote quotes and follows only remaining cursors',async()=>{
 m.twitter.mockResolvedValueOnce({users:[],posts:[post('x:101')],cursor:'next'}).mockResolvedValueOnce({users:[],posts:[post('x:102')],cursor:null});m.quotes.mockResolvedValue([post('native',10)]);
 const first=await getExternalPostActivity('x:100','quotes','top');expect(first.posts.map(p=>p.id)).toEqual(['native','x:101']);expect(first.next).toMatchObject({remote:'next',localDone:true});
 const next=await getExternalPostActivity('x:100','quotes','top',first.next);expect(next.posts.map(p=>p.id)).toEqual(['x:102']);expect(next.next).toBeUndefined();expect(m.quotes).toHaveBeenCalledTimes(1);expect(m.twitter.mock.calls[1][2]).toBe('next');
});
it('merges external and LimeNote reposters and retains failed provider cursors for retry',async()=>{
 m.blue.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({users:[{id:'did:actor'}],posts:[],cursor:null});m.reposts.mockResolvedValue([{id:'native'}]);
 const first=await getExternalPostActivity('bsky:uri','reposts','latest');expect(first.users.map(u=>u.id)).toEqual(['native']);expect(first.next?.remoteDone).toBe(false);
 const next=await getExternalPostActivity('bsky:uri','reposts','latest',first.next);expect(next.users.map(u=>u.id)).toEqual(['did:actor']);expect(next.next).toBeUndefined();
});
it('reads Bluesky likes with provider pagination and never queries native post likes',async()=>{
 m.blue.mockResolvedValue({users:[{id:'did:actor'}],posts:[],cursor:'likes-next'});
 const page=await getExternalPostActivity('bsky:uri','likes','top');expect(page.users).toHaveLength(1);expect(page.next?.remote).toBe('likes-next');expect(m.quotes).not.toHaveBeenCalled();expect(m.reposts).not.toHaveBeenCalled();
});
it('never attempts to fetch twitter likes or present failures as empty results',async()=>{
 await expect(getExternalPostActivity('x:100','likes','top')).rejects.toThrow();expect(m.twitter).not.toHaveBeenCalled();
 m.twitter.mockRejectedValue(new Error('network'));await expect(getExternalPostActivity('x:100','quotes','top')).rejects.toThrow('network');
});

it('stops an empty external reposter page even when the provider sends a next cursor',async()=>{
 m.twitter.mockResolvedValue({users:[],posts:[],cursor:'empty-next'});
 const page=await getExternalPostActivity('x:200','reposts','top');expect(page.users).toEqual([]);expect(page.next).toBeUndefined();expect(m.twitter).toHaveBeenCalledTimes(1);
});
it('stops repeated users with changing cursors and never displays the same account twice',async()=>{
 m.twitter.mockResolvedValueOnce({users:[{id:'x-user:1'}],posts:[],cursor:'one'}).mockResolvedValueOnce({users:[{id:'x-user:1'}],posts:[],cursor:'two'});
 const first=await getExternalPostActivity('x:201','reposts','top');
 const second=await getExternalPostActivity('x:201','reposts','top',first.next);expect(second.users).toEqual([]);expect(second.next).toBeUndefined();expect(first.next?.seen).toEqual(['x-user:1']);
});
it('stops cyclic cursors even when repeated pages contain different accounts',async()=>{
 m.twitter.mockResolvedValueOnce({users:[{id:'x-user:1'}],posts:[],cursor:'one'}).mockResolvedValueOnce({users:[{id:'x-user:2'}],posts:[],cursor:'two'}).mockResolvedValueOnce({users:[{id:'x-user:3'}],posts:[],cursor:'one'});
 const first=await getExternalPostActivity('x:202','reposts','top');const second=await getExternalPostActivity('x:202','reposts','top',first.next);const third=await getExternalPostActivity('x:202','reposts','top',second.next);
 expect(third.users.map(u=>u.id)).toEqual(['x-user:3']);expect(third.next).toBeUndefined();expect(first.next?.remoteSeen).toEqual(['one']);
});
