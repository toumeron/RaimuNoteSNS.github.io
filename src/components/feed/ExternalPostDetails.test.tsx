import {render,screen,cleanup} from '@testing-library/react';import{expect,it,afterEach}from'vitest';
import {ExternalPostDetails}from'./ExternalPostDetails';import{ProviderVerificationBadge}from'@/components/common/ProviderVerificationBadge';
import type{PostWithAuthor}from'@/types';
afterEach(cleanup);
it('does not render view, repost, quote or bookmark summary text',()=>{const {container}=render(<ExternalPostDetails post={{externalDetails:{views:4811,reposts:0,quotes:0,bookmarks:0}} as PostWithAuthor}/>);expect(container).toBeEmptyDOMElement();});
it('renders poll results and community notes with no native voting request',()=>{render(<ExternalPostDetails post={{blueskyUrl:'https://twitter.com/artist/status/20',externalDetails:{poll:{options:[{label:'A',votes:2},{label:'B',votes:3}],endsAt:'2099-01-01T00:00:00Z'},communityNote:'参考情報'}} as PostWithAuthor}/>);expect(screen.getByText('40%')).toBeInTheDocument();expect(screen.getByRole('link',{name:'twitterで投票する'})).toHaveAttribute('href','https://twitter.com/artist/status/20');expect(screen.getByText('参考情報')).toBeInTheDocument();});
it('displays provider verification independently of the LimeNote official badge',()=>{render(<ProviderVerificationBadge verification={{provider:'twitter',type:'organization'}}/>);expect(screen.getByRole('img',{name:'twitter認証済み'})).toHaveAttribute('src',`${import.meta.env.BASE_URL}verified.png`);});
