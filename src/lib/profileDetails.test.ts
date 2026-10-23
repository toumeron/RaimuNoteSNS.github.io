import { describe, expect, it } from 'vitest';
import { formatProfileBirthDate, isValidBirthDate, normalizeProfileWebsite } from './profileDetails';

describe('profile birthday and website', () => {
  it('validates calendar dates, leap days, and future dates', () => {
    for (const date of ['', '1998-05-10', '2000-02-29']) expect(isValidBirthDate(date, '2026-10-23')).toBe(true);
    for (const date of ['1900-02-29', '2026-02-30', '2026-13-01', '2026-00-01', '2026-10-24', '0000-01-01', '1998-5-10']) expect(isValidBirthDate(date, '2026-10-23')).toBe(false);
    expect(formatProfileBirthDate('1998-05-10')).toBe('1998年5月10日');
    expect(formatProfileBirthDate('1998-02-30')).toBe('');
  });
  it('supports removing a website and normalizes a bare domain', () => {
    expect(normalizeProfileWebsite(' ')).toBe('');
    expect(normalizeProfileWebsite(' lit.link/key_trend ')).toBe('https://lit.link/key_trend');
    expect(normalizeProfileWebsite('https://example.com/?q=日本語')).toContain('https://example.com/');
    expect(normalizeProfileWebsite('http://example.com')).toBe('http://example.com');
  });
  it('preserves Japanese domains, paths, queries and uppercase spelling', () => {
    for (const value of ['https://例え.テスト/日本語?検索=猫', 'HTTPS://Example.COM/MyPage?Key=Value', 'https://Example.COM/日本語']) expect(normalizeProfileWebsite(value)).toBe(value);
    expect(normalizeProfileWebsite('例え.テスト/日本語')).toBe('https://例え.テスト/日本語');
  });
  it.each(['1234', 'https:example.com', 'ただの文章', 'example', 'https://example', 'https://-bad.example.com', 'https://example.c', 'javascript:alert(1)', 'data:text/html,test', '//evil.test', 'https://user:secret@example.com', 'https://exa mple.com', 'https://example.com\\@evil.test', 'https://example.com\n/path', 'x'.repeat(2049)])('rejects unsafe or invalid URL %s', value => {
    expect(() => normalizeProfileWebsite(value)).toThrow();
  });
});
