/* Updated workers refresh legacy PWA clients which have no update listener yet. */
(() => {
  const replacingWorker = Boolean(self.registration.active);
  const acknowledgements = new Set();
  self.addEventListener('message', event => {
    if (event.data?.type === 'LIME_PWA_UPDATE_ACK' && typeof event.data.token === 'string' && event.source?.id) {
      acknowledgements.add(`${event.data.token}:${event.source.id}`);
    }
  });
  self.addEventListener('activate', event => {
    if (!replacingWorker) return;
    event.waitUntil((async () => {
      const clients = await self.clients.matchAll({type:'window',includeUncontrolled:true});
      const token = `${Date.now()}:${Math.random()}`;
      const scope = new URL(self.registration.scope);
      const scoped = clients.filter(client => {
        const url = new URL(client.url);
        return url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
      });
      scoped.forEach(client => client.postMessage({type:'LIME_PWA_UPDATE',token}));
      // Current clients acknowledge then reload themselves; old clients need navigation.
      await new Promise(resolve => setTimeout(resolve,1500));
      await Promise.all(scoped.map(async client => {
        if (acknowledgements.has(`${token}:${client.id}`)) { acknowledgements.delete(`${token}:${client.id}`); return; }
        // Do not await navigation: its fetch may wait for activation to finish.
        try { const current=await self.clients.get(client.id); if(current)void current.navigate(current.url).catch(()=>{}); } catch { /* A closed client needs no refresh. */ }
      }));
    })());
  });
})();
