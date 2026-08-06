import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  applyListParams,
  decodeListState,
  hasUrlState,
  nextListState,
  listStateEquals,
  readSticky,
  writeSticky,
  pageCountOf,
  clampPage,
} from './listState.js';
import {
  findScrollParent,
  makeListReturn,
  readScrollTop,
  resolveListReturn,
  saveScrollTop,
  scrollKey,
} from './listNav.js';

// React bindings for the durable-list-state contract. The rules themselves are
// in listState.js / listNav.js (pure, unit-tested); this file only wires them
// to the router and the DOM.
//
// A list screen uses three things:
//
//   const list = useListState({ key: 'deals', fields: { … } });   // URL owner
//   const anchor = useListScrollRestore(!loading);                 // scroll
//   const origin = useListOrigin();     // pass as navigate(..., { state })
//
// and a record screen uses one:
//
//   const back = useListReturn('/admin/crm/deals');  // <BackButton {...back} />

// ── useListState ────────────────────────────────────────────────────────────
// Returns the decoded state spread flat (list.page, list.search, …) plus:
//   set(patch)      merge + REPLACE history (refinement of the same view);
//                   any field other than the page resets the page to 1
//   setPage(n)      PUSH history, so browser Back walks back a page
//   reset()         every field to its declared default
export function useListState(config) {
  const { key, fields, pageField = 'page' } = config;
  const [searchParams, setSearchParams] = useSearchParams();

  // Sticky filters may seed only a first mount whose URL says nothing about
  // this list. Once seeded (or if the URL is authoritative) the URL is the
  // sole source — otherwise clearing a filter would be undone on the next
  // render by the remembered value.
  const seeded = useRef(false);
  const urlOwned = hasUrlState(fields, searchParams);

  const state = useMemo(() => {
    const sticky = !seeded.current && !urlOwned ? readSticky(key) : null;
    return decodeListState(fields, searchParams, sticky);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, key, fields, urlOwned]);

  // Canonicalise the URL once: after a sticky seed the address bar must show
  // what is actually on screen, so Back/refresh/copy-link all agree.
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    const next = applyListParams(fields, searchParams, state);
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const write = useCallback(
    (nextState, { replace }) => {
      writeSticky(key, fields, nextState);
      // Built from the CURRENT params so anything this list doesn't own (a
      // sibling feature's query flag) survives every state change.
      const params = applyListParams(fields, searchParams, nextState);
      setSearchParams(params, { replace });
    },
    [key, fields, searchParams, setSearchParams],
  );

  const set = useCallback(
    (patch) => {
      const next = nextListState(fields, state, patch, pageField);
      if (listStateEquals(fields, next, state)) return;
      write(next, { replace: true });
    },
    [fields, state, pageField, write],
  );

  const setPage = useCallback(
    (n) => {
      const page = Math.max(1, Number(n) || 1);
      if (page === state[pageField]) return;
      write({ ...state, [pageField]: page }, { replace: false });
    },
    [state, pageField, write],
  );

  const reset = useCallback(() => {
    const next = {};
    for (const [name, spec] of Object.entries(fields)) next[name] = spec.default;
    write(next, { replace: true });
  }, [fields, write]);

  return useMemo(
    () => ({ ...state, set, setPage, reset }),
    [state, set, setPage, reset],
  );
}

// ── useListScrollRestore ────────────────────────────────────────────────────
// Attach the returned ref to any element inside the list; the hook finds the
// real scrolling ancestor from it. `ready` should flip true once the rows are
// rendered — restoring before the table has height would silently clamp to 0.
export function useListScrollRestore(ready) {
  const anchorRef = useRef(null);
  const { pathname, search } = useLocation();
  const key = scrollKey(pathname, search);
  const restoredFor = useRef(null);

  // Suppresses saving while a restore is mid-flight: setting scrollTop fires
  // scroll events, and a clamped intermediate value must not overwrite the
  // target we are still trying to reach.
  const restoring = useRef(false);

  // Record scroll CONTINUOUSLY, and never re-read the element at teardown.
  //
  // Production bug this shape exists to prevent: the first version also saved
  // `el.scrollTop` in the effect cleanup. By the time React unmounts the list,
  // its rows are already gone, the container has collapsed, and the browser
  // has clamped scrollTop to 0 — so the cleanup faithfully saved 0 over the
  // good value the listener had just written. Verified live: the store held
  // 600 while scrolling and 0 the moment the deal page opened.
  //
  // So the LAST VALUE OBSERVED WHILE ALIVE is what gets written, and teardown
  // only flushes that remembered number.
  useEffect(() => {
    const el = findScrollParent(anchorRef.current);
    if (!el) return undefined;
    let frame = 0;
    let lastTop = null;
    const onScroll = () => {
      if (restoring.current) return;
      lastTop = el.scrollTop; // captured NOW, while the element is still real
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        saveScrollTop(key, lastTop);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      // Flush the remembered value — NOT a fresh read of a dying element.
      if (lastTop != null) saveScrollTop(key, lastTop);
      el.removeEventListener('scroll', onScroll);
    };
  }, [key]);

  useEffect(() => {
    if (!ready || restoredFor.current === key) return undefined;
    const el = findScrollParent(anchorRef.current);
    if (!el) return undefined;
    restoredFor.current = key;
    const top = readScrollTop(key);
    if (top <= 0) {
      el.scrollTop = 0;
      return undefined;
    }
    // Rows can settle over a few frames (images, measured columns), so retry
    // until the container is tall enough to actually hold the saved offset.
    restoring.current = true;
    let tries = 0;
    let frame = 0;
    const attempt = () => {
      el.scrollTop = top;
      tries += 1;
      if (Math.abs(el.scrollTop - top) > 1 && tries < 12) {
        frame = requestAnimationFrame(attempt);
      } else {
        restoring.current = false;
      }
    };
    frame = requestAnimationFrame(attempt);
    return () => {
      cancelAnimationFrame(frame);
      restoring.current = false;
    };
  }, [ready, key]);

  return anchorRef;
}

// ── useListOrigin ───────────────────────────────────────────────────────────
// The location `state` a list attaches when it opens a record, so the record's
// Back control knows where the operator actually came from.
export function useListOrigin() {
  const location = useLocation();
  return useMemo(
    () => makeListReturn(location),
    [location.pathname, location.search], // eslint-disable-line react-hooks/exhaustive-deps
  );
}

// ── useListReturn ───────────────────────────────────────────────────────────
// For record pages. Spread onto <BackButton {...back} /> (or any Link):
//   • plain click  → history back when a real origin exists, so the list comes
//                    back with its page, filters AND scroll intact
//   • ctrl/⌘/middle click → opens the list URL, leaving this tab alone
//   • no origin (pasted URL, new tab, deep link) → the canonical list root
export function useListReturn(fallbackTo, label) {
  const location = useLocation();
  const navigate = useNavigate();
  const resolved = resolveListReturn(location.state, fallbackTo);
  const onClick = useCallback(
    (e) => {
      if (resolved.mode !== 'back') return;
      if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1)) return;
      e?.preventDefault();
      navigate(-1);
    },
    [resolved.mode, navigate],
  );
  return { to: resolved.to, onClick, label, mode: resolved.mode };
}

export { pageCountOf, clampPage };
