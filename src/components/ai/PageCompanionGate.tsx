import {lazy,Suspense} from 'react';
import {useCompanion} from '@/lib/aiFriends';
const Companion=lazy(()=>import('./PageCompanion').then(module=>({default:module.PageCompanion})));
/** Disabled companions do not load settings/model UI on the initial timeline. */
export function PageCompanion({userId}:{userId:string}){
 const prefs=useCompanion(userId);
 return prefs.enabled?<Suspense fallback={null}><Companion userId={userId}/></Suspense>:null;
}
