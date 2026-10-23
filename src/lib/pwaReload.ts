import { flushPostDrafts } from './postDrafts';

export type PwaReloadPreparation = { waitUntil: (operation: Promise<unknown>) => void };
/** Give mounted composers a chance to commit media bytes before replacing the document. */
export async function preparePwaReload() {
  const pending: Promise<unknown>[] = [];
  window.dispatchEvent(new CustomEvent<PwaReloadPreparation>('lime-pwa-before-reload', {detail:{waitUntil:operation => pending.push(operation)}}));
  await Promise.all(pending);
  await flushPostDrafts();
}
