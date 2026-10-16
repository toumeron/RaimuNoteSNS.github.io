/** Presentation only: stored handles and profile routes retain their provider suffix. */
export function displayUsername(username:string|null|undefined):string{
 return (username??'').replace(/@(?:twitter|x)\.com$/i,'');
}
