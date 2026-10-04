const SPACE_LINK = /https?:\/\/[^\s<>]+\/spaces\/([\w-]+)(?:\?[^\s<>]*)?/g;
export function spaceLinkIn(content: string): { id: string; text: string } | null {
  for (const match of content.matchAll(SPACE_LINK)) {
    try {
      const url = new URL(match[0]);
      if ((url.hostname === 'toumeron.github.io' && url.pathname.startsWith('/RaimuNoteSNS.github.io/spaces/')) || (url.origin === window.location.origin && url.pathname.startsWith(`${import.meta.env.BASE_URL}spaces/`))) return { id: match[1], text: content.replace(match[0], '').trim() };
    } catch { /* Ignore malformed links. */ }
  }
  return null;
}
export const spacePublicLink = (id: string) => `https://toumeron.github.io/RaimuNoteSNS.github.io/spaces/${encodeURIComponent(id)}`;
