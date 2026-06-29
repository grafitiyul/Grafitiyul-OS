import { createContext, useContext, useCallback, useState } from 'react';

// Platform inline-edit coordinator. Enforces the GOS rule: only ONE field is in
// edit mode at a time within a scope. A field opens via requestOpen(id); any other
// open field sees openId change away from itself and returns to read (discarding
// its unsaved draft). Wrap a card/panel in <InlineEditScope> and have each
// InlineField/collapsible consume it.
const Ctx = createContext({ openId: null, requestOpen: () => {}, close: () => {} });

export function InlineEditScope({ children }) {
  const [openId, setOpenId] = useState(null);
  const requestOpen = useCallback((id) => setOpenId(id), []);
  const close = useCallback(() => setOpenId(null), []);
  return <Ctx.Provider value={{ openId, requestOpen, close }}>{children}</Ctx.Provider>;
}

export function useInlineScope() {
  return useContext(Ctx);
}
