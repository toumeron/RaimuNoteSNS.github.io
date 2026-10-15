/** Twitter's avatar suffix selects a thumbnail; omit it to use the uploaded image. */
export function twitterAvatarUrl(value: string | undefined): string | undefined {
  if (!value) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'pbs.twimg.com' || !url.pathname.startsWith('/profile_images/')) return value;
    url.pathname = url.pathname.replace(/_(?:normal|bigger|mini|\d+x\d+)(\.[a-z0-9]+)$/i, '$1');
    return url.href;
  } catch { return value; }
}
