// THE source cutover registry.
//
// Each external lead/order source moves from legacy to GOS INDIVIDUALLY. The
// one rule that must never be violated during that period:
//
//     NO SOURCE MAY HAVE TWO ACTIVE WRITERS.
//
// Two writers means the same Meta lead arrives once through Make → Pipedrive →
// the mirror, and once through the GOS ingress endpoint — producing two deals
// for one customer, or worse, two different answers about which is real.
// Neither the mirror nor the ingress platform can detect that on its own,
// because each one is behaving correctly in isolation. So the invariant is
// enforced HERE, in one place, before either of them runs.
//
// A source is in exactly one state:
//
//   legacy  — the source still writes into Pipedrive/Airtable, and GOS receives
//             it through the mirror. The GOS ingress endpoint for it is CLOSED.
//   direct  — the source writes straight into GOS ingress. The mirror must
//             IGNORE records arriving from it in legacy, because they are the
//             same events flowing the other way.
//   off     — not connected at all.
//
// The switch is deployment config (an env var), never a code change: cutting a
// source over is an operational decision that has to be reversible in seconds
// without a deploy, and reversibility is the whole point of doing them one at
// a time.

export const WRITER = Object.freeze({ LEGACY: 'legacy', DIRECT: 'direct', OFF: 'off' });

/**
 * The sources that move individually. `ingressSource` links a registry entry to
 * the adapter key the ingress platform already uses, so the two vocabularies
 * cannot drift; `legacyMarker` is how the same source is recognised on a record
 * that arrived via Pipedrive.
 */
export const SOURCES = Object.freeze([
  {
    key: 'meta',
    label: 'Meta (Facebook / Instagram)',
    env: 'SOURCE_WRITER_META',
    ingressSource: 'meta_lead_ads',
    legacyMarker: ['פייסבוק', 'אינסטגרם', 'פייסבוק/אינסטגרם ממומן', 'meta', 'fb', 'ig', 'facebook'],
    requires: ['META_APP_SECRET', 'META_VERIFY_TOKEN', 'META_PAGE_ACCESS_TOKEN'],
  },
  {
    key: 'woo_old',
    label: 'חנות ותיקה (WooCommerce)',
    env: 'SOURCE_WRITER_WOO_OLD',
    ingressSource: 'woocommerce',
    ingressSourceKey: 'primary',
    legacyMarker: ['אתר גרפיטיול'],
    requires: ['WOO_PRIMARY_WEBHOOK_SECRET'],
  },
  {
    key: 'woo_new',
    label: 'חנות חדשה (WooCommerce)',
    env: 'SOURCE_WRITER_WOO_NEW',
    ingressSource: 'woocommerce',
    // MUST match ingress/config.js WOO_STORES vocabulary ('primary'/'secondary').
    // The old value 'new' never matched a real storeKey, so the secondary store
    // fell through sourceForIngress' loose match and resolved to woo_old.
    ingressSourceKey: 'secondary',
    legacyMarker: [],
    requires: ['WOO_NEW_WEBHOOK_SECRET', 'WOO_NEW_BASE_URL'],
  },
  {
    key: 'website_forms',
    label: 'טפסים באתר',
    env: 'SOURCE_WRITER_WEBSITE_FORMS',
    ingressSource: 'website_form',
    legacyMarker: ['דף נחיתה', 'טופס לקוחות עסקיים', 'טופס סוכנים/מפיקים'],
    requires: ['WEBSITE_FORM_SECRET'],
  },
]);

const BY_KEY = new Map(SOURCES.map((s) => [s.key, s]));

const readEnv = (name, env) => String((env || process.env)[name] || '').trim().toLowerCase();

/**
 * Current writer for a source. Defaults to `legacy` — the safe default during
 * stabilization, because forgetting to set the variable must NOT silently open
 * a second writer.
 */
export function writerFor(key, env = process.env) {
  const spec = BY_KEY.get(key);
  if (!spec) return null;
  const raw = readEnv(spec.env, env);
  if (raw === WRITER.DIRECT) return WRITER.DIRECT;
  if (raw === WRITER.OFF) return WRITER.OFF;
  return WRITER.LEGACY;
}

/** May the GOS ingress endpoint for this source accept a payload right now? */
export function ingressEnabled(key, env = process.env) {
  return writerFor(key, env) === WRITER.DIRECT;
}

/** Should the mirror ignore legacy records originating from this source? */
export function mirrorShouldIgnore(key, env = process.env) {
  return writerFor(key, env) === WRITER.DIRECT;
}

/**
 * Resolve which registry source an ingress adapter call belongs to.
 * Used by the ingress endpoints to look up their own switch without hardcoding
 * a mapping in each adapter.
 */
export function sourceForIngress(ingressSource, sourceKey = null) {
  const exact = SOURCES.find((s) => s.ingressSource === ingressSource && s.ingressSourceKey === sourceKey);
  if (exact) return exact.key;
  const loose = SOURCES.find((s) => s.ingressSource === ingressSource && !s.ingressSourceKey);
  return loose?.key || null;
}

/**
 * Resolve which registry source a LEGACY record came from, by its lead-source
 * label. Returns null when the label matches nothing — an unknown label must
 * never be guessed into a source, because that would silently start ignoring
 * real records.
 */
export function sourceForLegacyLabel(label) {
  const l = String(label || '').trim().toLowerCase();
  if (!l) return null;
  for (const s of SOURCES) {
    if (s.legacyMarker.some((m) => m.toLowerCase() === l)) return s.key;
  }
  return null;
}

/**
 * Missing credentials for a source to run in `direct` mode.
 * Names only — never values.
 */
export function missingCredentials(key, env = process.env) {
  const spec = BY_KEY.get(key);
  if (!spec) return [];
  return spec.requires.filter((n) => !String((env || process.env)[n] || '').trim());
}

/**
 * THE invariant check. Returns every violation of "one active writer per
 * source", with the exact remedy.
 *
 * A source in `direct` mode with missing credentials is the dangerous case: the
 * legacy path has been switched off, the direct path cannot actually receive,
 * and leads fall on the floor silently. That is reported as a violation, not a
 * warning.
 */
export function validateRegistry(env = process.env) {
  const violations = [];
  for (const s of SOURCES) {
    const writer = writerFor(s.key, env);
    if (writer !== WRITER.DIRECT) continue;
    const missing = missingCredentials(s.key, env);
    if (missing.length) {
      violations.push({
        source: s.key,
        label: s.label,
        problem: 'direct_without_credentials',
        detail: `${s.label} is switched to direct ingress but ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not set — the legacy path is off and the direct path cannot receive. Leads would be lost.`,
        remedy: `set ${missing.join(', ')}, or set ${s.env}=legacy until they are configured`,
      });
    }
  }
  return { ok: violations.length === 0, violations };
}

/** Human-readable state of every source, for the admin surface and preflight. */
export function registryStatus(env = process.env) {
  return SOURCES.map((s) => {
    const writer = writerFor(s.key, env);
    return {
      key: s.key,
      label: s.label,
      writer,
      ingressEnabled: writer === WRITER.DIRECT,
      mirrorIgnores: writer === WRITER.DIRECT,
      missingCredentials: writer === WRITER.DIRECT ? missingCredentials(s.key, env) : [],
      env: s.env,
    };
  });
}

/**
 * The guard an ingress endpoint calls before accepting a payload.
 * Throws when the source is not in direct mode — a closed endpoint must refuse
 * loudly rather than quietly create a duplicate deal alongside the legacy path.
 */
export function assertIngressAllowed(ingressSource, sourceKey = null, env = process.env) {
  const key = sourceForIngress(ingressSource, sourceKey);
  if (!key) {
    const e = new Error(`unregistered_source: ${ingressSource}${sourceKey ? `/${sourceKey}` : ''}`);
    e.code = 'UNREGISTERED_SOURCE';
    e.status = 404;
    throw e;
  }
  const writer = writerFor(key, env);
  if (writer !== WRITER.DIRECT) {
    const e = new Error(
      `source_not_cut_over: ${key} is still written by "${writer}". ` +
      `Accepting here would give it two active writers.`,
    );
    e.code = 'SOURCE_NOT_CUT_OVER';
    e.status = 409;
    e.sourceKey = key;
    throw e;
  }
  return key;
}
