// Ingress Platform — the adapter registry.
//
// The extension point. A new source is added by writing one adapter module and
// registering it here; nothing else in the platform changes. Routes, replay,
// observability and the config report all read this registry, so a source
// cannot exist in one of them and be missing from another.

import { metaAdapter } from './meta.js';
import { wooAdapter } from './woocommerce.js';
import { websiteFormAdapter } from './websiteForm.js';
import { metaConfigured, wooStoreConfigured, websiteFormConfigured, WOO_STORES } from '../config.js';

export const ADAPTERS = Object.freeze({
  [metaAdapter.key]: metaAdapter,
  [wooAdapter.key]: wooAdapter,
  [websiteFormAdapter.key]: websiteFormAdapter,
});

export function getAdapter(key) {
  return ADAPTERS[key] || null;
}

// Configuration state per source, used by the admin surface and the boot report.
export function adapterStatus() {
  return [
    { key: metaAdapter.key, label: metaAdapter.label, configured: metaConfigured() },
    {
      key: wooAdapter.key,
      label: wooAdapter.label,
      configured: WOO_STORES.some(wooStoreConfigured),
      instances: WOO_STORES.map((k) => ({ key: k, configured: wooStoreConfigured(k) })),
    },
    { key: websiteFormAdapter.key, label: websiteFormAdapter.label, configured: websiteFormConfigured() },
  ];
}
