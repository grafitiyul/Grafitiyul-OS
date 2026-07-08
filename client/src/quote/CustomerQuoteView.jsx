import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import QuoteDocumentRenderer, { blockHasContent, QuoteViewContext } from './QuoteBlockRenderer.jsx';
import SignaturePopup from './SignaturePopup.jsx';
import SignedStatusPanel from './SignedStatusPanel.jsx';

// ── Public customer-facing quote page ────────────────────────────────────────
// Wraps the SHARED proposal renderer (unchanged) with the customer chrome:
// a sticky bottom action bar, a top-right floating menu, a Table-of-Contents
// drawer, a WhatsApp/Email contact menu, and print-to-PDF. Presentation only —
// the proposal itself is not redesigned. Signing (Phase 2) plugs into the
// primary action + the Signature section.

const SIGN_BLUE = '#2563eb';
// The proposal SENDER (our brand) — used for the signature popup title. This is
// the sender, never the customer's organization. (Matches the hero's "by".)
const SENDER = { he: 'גרפיטיול', en: 'Grafitiyul' };
// Fixed on-screen document width — a large A4-style proposal sheet that dominates
// the page (the gray background is secondary), NOT a fluid web layout. ~1280px on
// desktop (comfortable side margins remain); shrinks to fit on small screens. The
// paper and the sticky bar both use this, so they stay exactly matched. Print/PDF
// is unaffected (the print CSS overrides max-width to full page).
const DOC_WIDTH = 'max-w-[1280px]';

const L = {
  he: {
    sign: 'חתימה על ההצעה', contact: 'צור קשר', pdf: 'הורדת PDF', toc: 'תוכן עניינים',
    whatsapp: 'וואטסאפ', email: 'אימייל', close: 'סגירה', signed: 'נחתם',
    loading: 'טוען הצעה…', notFound: 'ההצעה לא נמצאה', notFoundHint: 'ייתכן שהקישור אינו תקין או שפג תוקפו.',
  },
  en: {
    sign: 'Sign the proposal', contact: 'Contact', pdf: 'Download PDF', toc: 'Contents',
    whatsapp: 'WhatsApp', email: 'Email', close: 'Close', signed: 'Signed',
    loading: 'Loading proposal…', notFound: 'Proposal not found', notFoundHint: 'The link may be invalid or expired.',
  },
};

// ── Minimal inline icons (no icon dependency) ────────────────────────────────
const Icon = {
  pen: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>),
  chat: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 11.5a8.4 8.4 0 0 1-11.9 7.6L3 21l1.9-6.1A8.4 8.4 0 1 1 21 11.5Z" /></svg>),
  download: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 3v12" /><path d="m7 12 5 5 5-5" /><path d="M5 21h14" /></svg>),
  list: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>),
  whatsapp: (p) => (<svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M17.5 14.4c-.3-.2-1.7-.8-2-.9-.3-.1-.5-.2-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.7-.9-2.9-1.6-4-3.5-.3-.5.3-.5.8-1.6.1-.2 0-.4 0-.5 0-.1-.7-1.7-1-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1 2.9 1.2 3.1c.2.2 2.1 3.2 5 4.5 1.8.8 2.5.9 3.4.7.5-.1 1.7-.7 1.9-1.4.2-.6.2-1.2.2-1.3-.1-.2-.3-.2-.6-.4Z" /><path d="M12 2a10 10 0 0 0-8.5 15.3L2 22l4.8-1.5A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-2.9.9.9-2.8-.2-.3A8.2 8.2 0 1 1 12 20.2Z" /></svg>),
  mail: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>),
  x: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="m6 6 12 12M18 6 6 18" /></svg>),
  check: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20 6 9 17l-5-5" /></svg>),
};

function scrollToKey(key) {
  const el = document.getElementById(`qs-${key}`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export default function CustomerQuoteView() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [phase, setPhase] = useState('loading'); // loading | ready | error
  const [tocOpen, setTocOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [activeKey, setActiveKey] = useState(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [signing, setSigning] = useState(false);

  useEffect(() => {
    let alive = true;
    setPhase('loading');
    api.publicQuote
      .get(token)
      .then((r) => { if (alive) { setData(r); setPhase('ready'); } })
      .catch(() => { if (alive) setPhase('error'); });
    return () => { alive = false; };
  }, [token]);

  const lang = data?.model?.language || 'he';
  const t = L[lang] || L.he;
  const rtl = lang !== 'en';

  // Visible body sections (skip hero + empties) — drives BOTH the render and the ToC.
  const bodyBlocks = useMemo(() => {
    const blocks = data?.model?.blocks || [];
    return blocks.filter((b) => b.type !== 'hero' && !b.hidden && blockHasContent(b));
  }, [data]);

  const renderModel = useMemo(() => {
    if (!data?.model) return null;
    const hero = data.model.blocks.find((b) => b.type === 'hero' && !b.hidden);
    return { language: lang, blocks: [hero, ...bodyBlocks].filter(Boolean) };
  }, [data, bodyBlocks, lang]);

  const toc = useMemo(
    () => bodyBlocks.map((b) => ({ key: b.key, title: b.data?.title || b.key })),
    [bodyBlocks],
  );
  const hasSignatureSection = bodyBlocks.some((b) => b.type === 'signature');
  const signature = data?.signature || null; // the audit record once signed
  const locked = !!data?.doc?.locked || !!signature;
  const contact = data?.contact || { whatsapp: '', email: '' };
  const header = data?.header || {};

  // Scroll-spy: highlight the section nearest the top of the viewport.
  useEffect(() => {
    if (phase !== 'ready' || !toc.length) return;
    const els = toc.map((s) => document.getElementById(`qs-${s.key}`)).filter(Boolean);
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActiveKey(vis[0].target.id.replace('qs-', ''));
      },
      { rootMargin: '-25% 0px -65% 0px', threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [phase, toc]);

  // Media-print safety sweep. Chromium composites cross-origin iframes into the
  // print output even when print CSS hides them (out-of-process frames are
  // rasterized separately and land pages away, detached). The video block's own
  // player is unmounted by React (useIsPrinting in the renderer); this sweep
  // covers what React cannot see — author-written rich HTML ([data-rich], set
  // via dangerouslySetInnerHTML): any embed inside it is physically removed for
  // the duration of printing and restored afterwards. Lazy images are flipped
  // to eager so pagination never captures a not-yet-loaded image.
  useEffect(() => {
    const removed = [];
    const onBeforePrint = () => {
      document.querySelectorAll('.cq-paper [data-rich] iframe').forEach((frame) => {
        const marker = document.createComment('iframe-removed-for-print');
        frame.replaceWith(marker);
        removed.push([marker, frame]);
      });
      document.querySelectorAll('.cq-paper img[loading="lazy"]').forEach((img) => { img.loading = 'eager'; });
    };
    const onAfterPrint = () => {
      while (removed.length) {
        const [marker, frame] = removed.pop();
        if (marker.parentNode) marker.replaceWith(frame);
      }
    };
    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', onAfterPrint);
    return () => {
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', onAfterPrint);
    };
  }, []);

  const downloadPdf = () => window.print();
  // Sticky "sign" scrolls to the section (Prospero flow) — it never opens the popup.
  const goSign = () => (hasSignatureSection ? scrollToKey('signature') : null);

  async function handleSign(payload) {
    setSigning(true);
    try {
      const timezone = (() => {
        try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; }
      })();
      await api.publicQuote.sign(token, { ...payload, timezone });
      const fresh = await api.publicQuote.get(token); // authoritative locked state + frozen snapshot
      setData(fresh);
      setPopupOpen(false);
    } catch (e) {
      if (e?.status === 409) {
        // Someone already signed — reload into the locked state instead of erroring.
        const fresh = await api.publicQuote.get(token);
        setData(fresh);
        setPopupOpen(false);
        return;
      }
      throw e; // surfaced inside the popup
    } finally {
      setSigning(false);
    }
  }

  if (phase === 'loading') {
    return <div className="flex min-h-screen items-center justify-center bg-gray-100 text-gray-400">{L.he.loading}</div>;
  }
  if (phase === 'error' || !renderModel) {
    return (
      <div dir="rtl" className="flex min-h-screen flex-col items-center justify-center bg-gray-100 px-6 text-center">
        <div className="text-lg font-semibold text-gray-700">{L.he.notFound}</div>
        <div className="mt-1 text-sm text-gray-400">{L.he.notFoundHint}</div>
      </div>
    );
  }

  return (
    <div dir={rtl ? 'rtl' : 'ltr'} className="cq-root min-h-screen bg-gray-100">
      {/* Print rules. The PDF must be a FROZEN photograph of the on-screen proposal,
          not a printer re-layout. Two things break that by default and we fix both:

          1. Reflow. The browser normally shrinks the page to the paper width (~A4),
             recomputing every width so the layout looks different. We stop that by
             making the printed PAGE exactly the on-screen document width (1280px) and
             pinning the document to that width — so nothing reflows. The page is just
             the document, paginated. (@page size is honoured by Chromium/Edge — the
             common Save-as-PDF path; other engines fall back to a scaled fit.)
          2. Ink-saving background stripping. print-color-adjust:exact keeps the hero
             image, overlays, teal accents and every card exactly as on screen.

          We reset NOTHING else (no black-text override, no spacing/typography change)
          and remove ONLY the interactive chrome (.cq-no-print). */}
      <style>{`
      @media print {
        @page { size: 1280px 1811px; margin: 0; }
        *, *::before, *::after {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .cq-no-print { display: none !important; }
        html, body { background: #fff !important; margin: 0 !important; }
        .cq-root { background: #fff !important; min-height: 0 !important; }
        /* Freeze the exact desktop layout — the document keeps its on-screen width
           and never reflows to the paper. */
        .cq-page { width: 1280px !important; max-width: 1280px !important; margin: 0 auto !important; padding: 0 !important; }
        .cq-paper { width: 1280px !important; box-shadow: none !important; border-radius: 0 !important; }
        /* Keep whole sections together across page breaks when they fit. */
        .cq-paper section { break-inside: avoid; }
        /* Media never splits across pages, and no live iframe ever reaches the
           PDF — a cross-origin frame prints as an empty box with its content
           painted pages away. The video block ships its own print poster card
           (VideoPrintCard); this backstop also covers embeds inside rich text. */
        .cq-paper iframe { display: none !important; }
        .cq-paper figure, .cq-paper img { break-inside: avoid; page-break-inside: avoid; }
      }
      `}</style>

      {/* Top-right floating menu — Contents + PDF. Physical top-right (RTL-correct). */}
      <div className="cq-no-print fixed right-4 top-4 z-40 flex items-center gap-1 rounded-full border border-gray-200 bg-white/95 p-1 shadow-lg backdrop-blur">
        <button
          type="button"
          onClick={() => setTocOpen(true)}
          title={t.toc}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium text-gray-700 transition hover:bg-gray-100"
        >
          <Icon.list className="h-4 w-4" /> <span className="hidden sm:inline">{t.toc}</span>
        </button>
        <span className="h-5 w-px bg-gray-200" />
        <button
          type="button"
          onClick={downloadPdf}
          title={t.pdf}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium text-gray-700 transition hover:bg-gray-100"
        >
          <Icon.download className="h-4 w-4" /> <span className="hidden sm:inline">{t.pdf}</span>
        </button>
      </div>

      {/* Signed audit panel — permanent, floating on the LEFT (desktop). */}
      {signature && (
        <div className="cq-no-print fixed bottom-28 left-5 z-30 hidden lg:block">
          <SignedStatusPanel signature={signature} header={header} lang={lang} />
        </div>
      )}

      {/* The proposal — centered premium sheet; the print target. The signing
          context is supplied ONLY here, so the Signature section's button opens the
          popup (and once signed, renders the captured signature). */}
      <main className={`cq-page mx-auto ${DOC_WIDTH} px-3 py-6 sm:py-10`}>
        {/* On mobile the audit panel sits inline above the proposal. */}
        {signature && (
          <div className="cq-no-print mb-4 lg:hidden">
            <SignedStatusPanel signature={signature} header={header} lang={lang} className="w-full" />
          </div>
        )}
        <div className="cq-paper overflow-hidden rounded-2xl bg-white shadow-xl">
          <QuoteViewContext.Provider
            value={{ signature, onSignClick: locked ? undefined : () => setPopupOpen(true) }}
          >
            <QuoteDocumentRenderer model={renderModel} />
          </QuoteViewContext.Provider>
        </div>
        <div className="cq-no-print h-28" aria-hidden />
      </main>

      {/* Table of Contents drawer. */}
      {tocOpen && (
        <div className="cq-no-print fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setTocOpen(false)} />
          <aside
            dir={rtl ? 'rtl' : 'ltr'}
            className="absolute inset-y-0 right-0 flex w-[300px] max-w-[85vw] flex-col bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <span className="text-sm font-semibold text-gray-800">{t.toc}</span>
              <button type="button" onClick={() => setTocOpen(false)} title={t.close} className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                <Icon.x className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-2">
              {toc.map((s, i) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => { scrollToKey(s.key); setTocOpen(false); }}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm transition hover:bg-gray-50 ${
                    activeKey === s.key ? 'font-semibold text-gray-900' : 'text-gray-600'
                  }`}
                >
                  <span className="w-5 shrink-0 text-[11px] tabular-nums text-gray-300">{i + 1}</span>
                  <span className="truncate">{s.title}</span>
                </button>
              ))}
            </nav>
          </aside>
        </div>
      )}

      {/* Sticky bottom action bar — a full-viewport-width application toolbar,
          DECOUPLED from the proposal width (no DOC_WIDTH). The proposal centers
          independently above it. Actions on the (physical) left; owner on the right. */}
      <div className="cq-no-print fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 shadow-[0_-10px_34px_-14px_rgba(0,0,0,0.28)] backdrop-blur">
        <div className="flex w-full items-center justify-between gap-6 px-5 py-4 sm:px-10">
          {/* Owner info — physical right (reading start in RTL). */}
          <div className="min-w-0">
            {header.customerName && <div className="truncate text-[16px] font-semibold text-gray-900">{header.customerName}</div>}
            {header.organizationName && <div className="truncate text-[13px] text-gray-400">{header.organizationName}</div>}
          </div>

          {/* Primary actions — physical left. */}
          <div className="flex shrink-0 items-center gap-3 sm:gap-4">
            {hasSignatureSection && !locked && (
              <button
                type="button"
                onClick={goSign}
                className="flex items-center gap-2 rounded-xl px-7 py-3.5 text-[15px] font-semibold text-white shadow-sm transition hover:brightness-105"
                style={{ backgroundColor: SIGN_BLUE }}
              >
                <Icon.pen className="h-5 w-5" /> {t.sign}
              </button>
            )}
            {locked && (
              <span className="flex items-center gap-2 rounded-xl bg-emerald-50 px-6 py-3.5 text-[15px] font-semibold text-emerald-700">
                <Icon.check className="h-5 w-5" /> {t.signed}
              </span>
            )}

            <div className="relative">
              <button
                type="button"
                onClick={() => setContactOpen((o) => !o)}
                className="flex items-center gap-2 rounded-xl border border-gray-200 px-5 py-3 text-[14px] font-medium text-gray-700 transition hover:bg-gray-50"
              >
                <Icon.chat className="h-[18px] w-[18px]" /> {t.contact}
              </button>
              {contactOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setContactOpen(false)} />
                  <div className="absolute bottom-full z-20 mb-2 end-0 w-48 overflow-hidden rounded-xl border border-gray-100 bg-white py-1 shadow-xl">
                    {contact.whatsapp && (
                      <a
                        href={`https://wa.me/${contact.whatsapp}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => setContactOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <Icon.whatsapp className="h-4 w-4 text-[#25D366]" /> {t.whatsapp}
                      </a>
                    )}
                    {contact.email && (
                      <a
                        href={`mailto:${contact.email}`}
                        onClick={() => setContactOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <Icon.mail className="h-4 w-4 text-gray-500" /> {t.email}
                      </a>
                    )}
                    {!contact.whatsapp && !contact.email && (
                      <div className="px-4 py-2.5 text-[12px] text-gray-400">—</div>
                    )}
                  </div>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={downloadPdf}
              title={t.pdf}
              className="hidden items-center gap-2 rounded-xl px-5 py-3 text-[14px] font-medium text-gray-600 transition hover:bg-gray-100 sm:flex"
            >
              <Icon.download className="h-[18px] w-[18px]" /> {t.pdf}
            </button>
          </div>
        </div>
      </div>

      {/* Signature popup — opened from the Signature section's blue button. */}
      {popupOpen && !locked && (
        <SignaturePopup
          company={SENDER[lang] || SENDER.he}
          lang={lang}
          busy={signing}
          onSubmit={handleSign}
          onClose={() => setPopupOpen(false)}
        />
      )}
    </div>
  );
}
