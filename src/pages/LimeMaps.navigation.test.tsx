import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import {MemoryRouter,useLocation} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
vi.mock('@/api/posts',()=>({getMapPosts:vi.fn(),getPostById:vi.fn()}));
vi.mock('@/api/external-map-posts',()=>({getExternalMapPostPage:vi.fn(),getExternalMapPostDetail:vi.fn(),MapRateLimitError:class extends Error{}}));
vi.mock('@/App',()=>({PostOverlay:()=>null}));
vi.mock('@/components/maps/LimeMap',()=>({default:({onPost})=><button onClick={()=>onPost({id:'post/one'})}>ポストを見る</button>}));
import LimeMaps from './LimeMaps';
function Location(){return <output data-testid="location">{useLocation().pathname}</output>}
it('opens the actual post page directly instead of a map side preview',()=>{
 render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/maps']}><LimeMaps/><Location/></MemoryRouter></QueryClientProvider>);
 fireEvent.click(screen.getByText('ポストを見る'));
 expect(screen.getByTestId('location').textContent).toBe('/post/post%2Fone');
 expect(screen.queryByLabelText('選択したポスト')).toBeNull();
});
