// PwaDiagnostics — visible-on-page runtime probe for PWA launch
// debugging. Surfaces every signal we'd otherwise need DevTools to
// inspect:
//
//   * window.location.href / pathname / search   — what URL did the
//     PWA actually launch at?
//   * navigator.standalone (iOS)                 — is this the
//     standalone home-screen launch context?
//   * matchMedia('(display-mode: standalone)')   — same question on
//     Chrome / Android / desktop.
//   * localStorage / sessionStorage portal token — did our token
//     reach this storage container, or is the PWA isolated?
//   * <link rel="manifest"> href                 — what manifest URL
//     does the document currently reference?
//
// Rendered on the no-token screens (Landing's MissingPortalScreen
// and InstallGuidePage's NoTokenScreen). Keeps zero state, just
// reads the live runtime values on every render. Wrapped in a
// <details> so it's compact by default and expandable on tap.
export default function PwaDiagnostics() {
  const probes = readProbes();
  return (
    <details className="mt-4 max-w-md w-full bg-white border border-gray-200 rounded-lg text-[12px] text-gray-700">
      <summary className="px-3 py-2 cursor-pointer text-gray-500">
        פרטי איתור (Diagnostics)
      </summary>
      <dl className="px-3 py-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 font-mono">
        {probes.map((p) => (
          <FragmentRow key={p.label} label={p.label} value={p.value} />
        ))}
      </dl>
    </details>
  );
}

function FragmentRow({ label, value }) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd dir="ltr" className="text-gray-900 break-all">
        {value}
      </dd>
    </>
  );
}

function readProbes() {
  const out = [];
  try {
    out.push({ label: 'href', value: window.location.href });
    out.push({ label: 'pathname', value: window.location.pathname || '/' });
    out.push({ label: 'search', value: window.location.search || '(none)' });
  } catch {
    out.push({ label: 'location', value: '(unavailable)' });
  }
  try {
    const ios = window.navigator?.standalone;
    out.push({
      label: 'navigator.standalone',
      value:
        ios === true ? 'true' : ios === false ? 'false' : '(undefined)',
    });
  } catch {
    out.push({ label: 'navigator.standalone', value: '(error)' });
  }
  try {
    const m =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches;
    out.push({
      label: 'display_mode_standalone',
      value: m ? 'true' : 'false',
    });
  } catch {
    out.push({ label: 'display_mode_standalone', value: '(error)' });
  }
  try {
    const s = localStorage.getItem('gos.portalToken');
    out.push({
      label: 'localStorage_token',
      value: s ? `present (${s.length} chars)` : 'none',
    });
  } catch {
    out.push({ label: 'localStorage_token', value: '(error)' });
  }
  try {
    const s = sessionStorage.getItem('gos.portalToken');
    out.push({
      label: 'sessionStorage_token',
      value: s ? `present (${s.length} chars)` : 'none',
    });
  } catch {
    out.push({ label: 'sessionStorage_token', value: '(error)' });
  }
  try {
    const link = document.querySelector('link[rel="manifest"]');
    out.push({
      label: 'manifest_href',
      value: link?.getAttribute('href') || '(none)',
    });
  } catch {
    out.push({ label: 'manifest_href', value: '(error)' });
  }
  try {
    out.push({
      label: 'user_agent',
      value: (navigator.userAgent || '').slice(0, 120),
    });
  } catch {
    out.push({ label: 'user_agent', value: '(error)' });
  }
  return out;
}
