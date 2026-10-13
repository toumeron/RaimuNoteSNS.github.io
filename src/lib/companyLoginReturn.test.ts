import { expect, it } from 'vitest';
import { companyReturnUrl } from './companyLoginReturn';
const origin = 'https://toumeron.github.io';
it('preserves the original company page, query and anchor', () => {
 expect(companyReturnUrl('/LimeNoteJP/company/profile/?tab=info#top', origin)).toBe(origin+'/LimeNoteJP/company/profile/?tab=info#top');
});
it('accepts an absolute URL on the same origin', () => {
 expect(companyReturnUrl(origin+'/LimeNoteJP/', origin)).toBe(origin+'/LimeNoteJP/');
});
it('supports the same-origin development proxy', () => {
 expect(companyReturnUrl('/LimeNoteJP/', 'http://localhost:5173')).toBe('http://localhost:5173/LimeNoteJP/');
});
it.each([null, '', '//evil.example/LimeNoteJP/', 'https://evil.example/LimeNoteJP/', 'javascript:alert(1)', '/RaimuNoteSNS.github.io/auth', '/LimeNoteJP-evil/', '/LimeNoteJP/../auth', 'https://user:password@toumeron.github.io/LimeNoteJP/'])('rejects an unapproved login return target %s', value => {
 expect(companyReturnUrl(value, origin)).toBeNull();
});
