// Single load point for Baileys v7 (ESM-only). The bridge itself is ESM so a
// static import would work, but we keep the proven load-once/boot-order
// pattern from the Challenge System: loadBaileys() is awaited once at boot
// BEFORE anything touches the socket or the auth store; everything else calls
// getBaileys() synchronously (the auth store needs BufferJSON/initAuthCreds/
// proto without being async at every call site).

let loaded = null;

export async function loadBaileys() {
  if (!loaded) {
    loaded = await import('@whiskeysockets/baileys');
  }
  return loaded;
}

export function getBaileys() {
  if (!loaded) {
    throw new Error('baileys_not_loaded: loadBaileys() must be awaited during boot before the socket is used');
  }
  return loaded;
}
