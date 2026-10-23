import { formatProfileBirthDate, normalizeProfileWebsite } from '@/lib/profileDetails';

export function ProfileDetails({websiteUrl, birthDate}: {websiteUrl?: string; birthDate?: string}) {
  let href = '';
  try { href = normalizeProfileWebsite(websiteUrl ?? ''); } catch { /* Hide invalid legacy URLs. */ }
  const birthday = formatProfileBirthDate(birthDate ?? '');
  return <>
    {href && <span className="inline-flex min-w-0 max-w-full items-center gap-1.5" style={{fontSize: 'inherit', lineHeight: 'inherit'}}>
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m10 6 2.1-2.1a5.66 5.66 0 0 1 8 8L18 14M6 10l-2.1 2.1a5.66 5.66 0 0 0 8 8L14 18M8 16l8-8" /></svg>
      <a style={{fontSize: 'inherit', lineHeight: 'inherit'}} href={href} target="_blank" rel="noopener noreferrer" className="min-w-0 break-words text-primary hover:underline [overflow-wrap:anywhere]">{href.replace(/^https?:\/\//i, '').replace(/\/$/, '')}</a>
    </span>}
    {birthday && <span className="inline-flex min-w-0 max-w-full items-center gap-1.5" style={{fontSize: 'inherit', lineHeight: 'inherit'}}>
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M12 1C6.8 1 3.5 5.7 3.5 11S6.8 21 12 21s8.5-4.7 8.5-10S17.2 1 12 1Zm0 2C8.2 3 5.5 6.6 5.5 11s2.7 8 6.5 8 6.5-3.6 6.5-8S15.8 3 12 3Z"/><path d="M11 5c-2.2.4-3.5 2.5-3.5 5h2c0-1.7.8-2.8 1.8-3ZM12 20l-3 4h6Z"/></svg>
      <span>誕生日: {birthday}</span>
    </span>}
  </>;
}
