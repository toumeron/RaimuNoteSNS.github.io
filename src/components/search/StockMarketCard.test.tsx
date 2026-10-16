import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({get:vi.fn()}));
vi.mock('@/lib/marketData',async importOriginal=>({...await importOriginal<any>(),getMarketQuote:mocks.get}));
import {StockMarketCard,StockSuggestion} from './StockMarketCard';
import {matchMarketAsset} from '@/lib/marketData';
const asset=matchMarketAsset('AAPL')!;
const quote={symbol:'AAPL',name:'Apple Inc.',exchange:'NASDAQ',price:102,currency:'USD',previousClose:100,change:2,changePercent:2,asOf:1792180801,points:[{time:10,price:100,volume:1,extended:false},{time:20,price:102,volume:2,extended:false}],range:'1D'};
function mount(node:React.ReactNode){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>{node}</QueryClientProvider>);}
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('renders real price, attribution and an independently fetched period chart',async()=>{
 mocks.get.mockImplementation(async(_symbol,range)=>({...quote,range}));mount(<StockMarketCard asset={asset}/>);
 expect(await screen.findByText('$102.00')).toBeInTheDocument();expect(screen.getByRole('link',{name:'Yahoo Finance'})).toHaveAttribute('href','https://finance.yahoo.com/quote/AAPL/');
 expect(screen.getByRole('img',{name:/株価チャート/})).toBeInTheDocument();
 expect(document.querySelector('.lime-stock-heading img,.lime-stock-mark')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'1Y'}));
 await waitFor(()=>expect(mocks.get).toHaveBeenCalledWith('AAPL','1Y',expect.any(AbortSignal)));
 expect(screen.getByRole('button',{name:'1Y'})).toHaveAttribute('aria-pressed','true');
});
it('shows quote values in the suggestion without a second search flow',async()=>{
 mocks.get.mockResolvedValue(quote);mount(<StockSuggestion asset={asset}/>);
 expect(await screen.findByText('$102.00')).toBeInTheDocument();expect(screen.getByText('+2.00%')).toBeInTheDocument();expect(document.querySelector('.lime-stock-mark,img')).toBeNull();
});
it('does not invent prices when the provider is unavailable',async()=>{
 mocks.get.mockRejectedValue(new Error('unavailable'));mount(<StockMarketCard asset={asset}/>);
 expect(await screen.findByRole('button',{name:'再読み込み'})).toBeInTheDocument();expect(screen.queryByText('$102.00')).not.toBeInTheDocument();
});
