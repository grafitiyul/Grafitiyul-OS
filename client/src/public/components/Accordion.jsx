import { useState } from 'react';
import { cn } from '../lib/cn.js';
import Icon from './Icon.jsx';

// FAQ accordion (Figma "Accordion V2"). Single-open behaviour; the first item
// starts open. `items` = [{ id, q, a }]. Interactive but self-contained, so it
// stays SSR-safe (renders the first item open on the server too).
export default function Accordion({ items = [] }) {
  const [openId, setOpenId] = useState(items[0]?.id ?? null);

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => {
        const isOpen = openId === item.id;
        return (
          <div
            key={item.id}
            className="overflow-hidden rounded-cta border border-ink-200 bg-white"
          >
            <button
              type="button"
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-start"
              aria-expanded={isOpen}
              onClick={() => setOpenId(isOpen ? null : item.id)}
            >
              <span className="text-body-lg font-medium text-brand-950">{item.q}</span>
              <Icon
                name="chevronDown"
                className={cn(
                  'h-5 w-5 shrink-0 text-ink-400 transition-transform',
                  isOpen && 'rotate-180',
                )}
              />
            </button>
            {isOpen && (
              <div className="px-5 pb-5 text-body text-ink-600">{item.a}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
