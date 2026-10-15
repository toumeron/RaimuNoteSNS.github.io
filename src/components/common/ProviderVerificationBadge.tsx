import type {User} from '@/types';
/** Reuse LimeNote's badge artwork without changing the account's official status. */
export function ProviderVerificationBadge({verification,className='ml-1 h-4 w-4 inline-block align-text-bottom'}:{verification?:User['providerVerification'];className?:string}){
 if(!verification)return null;
 return <img src={`${import.meta.env.BASE_URL}verified.png`} alt="twitter認証済み" className={className}/>;
}
