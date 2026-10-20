import {useEffect,useState} from 'react';
import {searchTermSuggestions} from '@/lib/searchTermSuggestions';

export function useSearchTermSuggestions(query:string,enabled=true){
 const [terms,setTerms]=useState<string[]>([]);
 useEffect(()=>{
  setTerms([]);if(!enabled||!query.trim())return;
  const controller=new AbortController();
  const timer=setTimeout(()=>{void searchTermSuggestions(query,controller.signal).then(values=>{if(!controller.signal.aborted)setTerms(values);}).catch(()=>{});},250);
  return()=>{controller.abort();clearTimeout(timer);};
 },[query,enabled]);
 return terms;
}
