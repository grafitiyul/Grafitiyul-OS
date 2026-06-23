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
        const btnId = `faq-btn-${item.id}`;
        const panelId = `faq-panel-${item.id}`;
        return (
          <div
            key={item.id}
            className="overflow-hidden rounded-cta border border-ink-200 bg-white"
          >
            <h3 className="m-0">
              <button
                type="button"
                id={btnId}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-start text-body-lg font-medium text-brand-950"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpenId(isOpen ? null : item.id)}
              >
                <span>{item.q}</span>
                <Icon
                  name="chevronDown"
                  className={cn(
                    'h-5 w-5 shrink-0 text-ink-500 transition-transform',
                    isOpen && 'rotate-180',
                  )}
                />
              </button>
            </h3>
            <div
              id={panelId}
              role="region"
              aria-labelledby={btnId}
              hidden={!isOpen}
              className="px-5 pb-5 text-body text-ink-600"
            >
              {item.a}
            </div>
          </div>
        );
      })}
    </div>
  );
}
