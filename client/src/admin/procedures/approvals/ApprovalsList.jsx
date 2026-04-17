import { useState } from 'react';
import { APPROVAL_VIEWS } from '../config.js';

// Placeholder until slice 4 (approvals). Keeps the shared list-pane +
// work-area shape.
export default function ApprovalsList() {
  const [viewKey, setViewKey] = useState(APPROVAL_VIEWS[0].key);
  const emptyCopy = {
    inbox: {
      title: 'תיבת הנכנסות ריקה',
      sub: 'תשובות חדשות הממתינות לאישור יופיעו כאן.',
    },
    by_flow: {
      title: 'לפי זרימה',
      sub: 'בחרו זרימה כדי לראות את כל הניסיונות שלה.',
    },
    by_person: {
      title: 'לפי אדם',
      sub: 'חפשו לפי שם או תפקיד כדי לראות את התשובות שהוגשו.',
    },
  }[viewKey];

  return (
    <div className="h-full flex">
      <aside className="flex w-full lg:w-[360px] lg:shrink-0 lg:border-l lg:border-gray-200 bg-white flex-col min-h-0">
        <div className="p-3 border-b border-gray-200 bg-white">
          <div className="flex gap-1 bg-gray-100 rounded-md p-1">
            {APPROVAL_VIEWS.map((v) => (
              <button
                key={v.key}
                onClick={() => setViewKey(v.key)}
                className={`flex-1 text-center px-2 py-1.5 text-[12px] rounded transition ${
                  viewKey === v.key
                    ? 'bg-white shadow-sm text-gray-900 font-semibold'
                    : 'text-gray-600'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div className="max-w-xs">
            <div className="text-4xl mb-3 opacity-50">✓</div>
            <div className="font-semibold text-gray-800 mb-1">
              {emptyCopy.title}
            </div>
            <div className="text-sm text-gray-500">{emptyCopy.sub}</div>
          </div>
        </div>
      </aside>
      <section className="hidden lg:flex flex-1 items-center justify-center bg-gray-50 p-10">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-4 opacity-40">✓</div>
          <div className="text-lg font-semibold text-gray-800 mb-1">
            בחרו תשובה לאישור
          </div>
          <div className="text-sm text-gray-500">
            זרימת אישור מלאה תתווסף בשלב הבא.
          </div>
        </div>
      </section>
    </div>
  );
}
