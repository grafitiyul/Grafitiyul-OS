import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import SettingsChrome from '../settings/SettingsChrome.jsx';
import QueueList from './QueueList.jsx';
import SendingWindowsPanel from './SendingWindowsPanel.jsx';

// תור שליחה — WhatsApp + Email.
//
// One READ-ONLY view over the four queues that already exist (Communication
// Center, scheduled WhatsApp, scheduled email, admin reports). Nothing is sent
// or cancelled from here: each row links back to the module that owns it, so
// there is still exactly one write path per subsystem.
//
// The screen answers, in order: is anything stuck, why, and when will it go.

const TABS = [
  { key: 'whatsapp', labelHe: 'WhatsApp', icon: '💬' },
  { key: 'email', labelHe: 'אימייל', icon: '✉️' },
];

export default function QueuePage() {
  const [channel, setChannel] = useState('whatsapp');
  const [scope, setScope] = useState('pending');
  const [overview, setOverview] = useState(null);

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await api.queue.overview());
    } catch {
      setOverview(null);
    }
  }, []);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 w-full" dir="rtl">
      <SettingsChrome />
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">תור שליחה</h1>
        <p className="mt-1 text-[14px] leading-relaxed text-gray-500">
          כל ההודעות היוצאות מהמערכת במקום אחד — מרכז התקשורת, הודעות מתוזמנות,
          אימיילים מתוזמנים ודיווחי מנהלים. התצוגה לקריאה בלבד; פעולות מתבצעות
          במודול שאליו ההודעה שייכת.
        </p>
      </header>

      {/* Channel tabs, each carrying its own live counters. */}
      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((t) => {
          const counts = overview?.[t.key];
          const on = channel === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setChannel(t.key)}
              className={`rounded-xl border px-4 py-2.5 text-start transition ${
                on ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="text-[14px] font-medium">{t.icon} {t.labelHe}</span>
              {counts ? (
                <span className={`mt-0.5 block text-[11.5px] ${on ? 'text-gray-300' : 'text-gray-500'}`}>
                  {counts.waiting} ממתינות
                  {counts.held > 0 ? ` · ${counts.held} מוחזקות` : ''}
                  {counts.failed > 0 ? ` · ${counts.failed} נכשלו` : ''}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { key: 'pending', labelHe: 'בהמתנה' },
          { key: 'history', labelHe: 'היסטוריה' },
        ].map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setScope(s.key)}
            className={`rounded-full border px-3 py-1 text-[12.5px] ${
              scope === s.key ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            {s.labelHe}
          </button>
        ))}
      </div>

      <QueueList channel={channel} scope={scope} onChanged={loadOverview} />

      <SendingWindowsPanel onSaved={loadOverview} />
    </div>
  );
}
