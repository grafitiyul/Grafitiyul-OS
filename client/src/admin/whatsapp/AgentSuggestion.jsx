import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import ProposalCard from '../ai-agent/ProposalCard.jsx';
import { WHATSAPP_MESSAGE_SENT_EVENT } from './composerEvents.js';

// The AI suggestion, inside the conversation the operator is already in.
//
// Design constraints this component exists to satisfy (§25 of the spec):
//   • Operators must NOT have to live in the AI module to use the agent. The
//     module is for management; this is where the work happens.
//   • It must not overwhelm the conversation UI. It renders NOTHING at all when
//     there is no suggestion — the common case — and collapses to a single line
//     for shadow-mode records, which are informational only.
//   • It reuses the SAME ProposalCard the Review screen uses. A suggestion that
//     behaved differently in two places would be two features to learn.
//
// It is keyed on chatId by its parent, so switching conversations remounts it.
// That is what guarantees a suggestion can never leak from one customer to the
// next — the failure mode that sequential-chat-switching tests exist to catch.
export default function AgentSuggestion({ chatId }) {
  const [proposal, setProposal] = useState(null);
  const [loaded, setLoaded] = useState(false);
  // Shadow records start collapsed to one line; an actionable proposal is
  // always expanded — it is a task, not a note.
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    if (!chatId) return;
    try {
      const res = await api.aiAgent.proposalForChat(chatId);
      setProposal(res.proposal || null);
    } catch {
      // A failing agent must never break the WhatsApp conversation. No banner,
      // no retry storm — the card simply does not appear.
      setProposal(null);
    } finally {
      setLoaded(true);
    }
  }, [chatId]);

  useEffect(() => {
    setProposal(null);
    setLoaded(false);
    setExpanded(false);
    load();
  }, [chatId, load]);

  // A message going out on this conversation (from any composer) answers the
  // suggestion: the server marks it 'bypassed'. Re-read so the card reflects
  // reality instead of offering a send that is no longer wanted.
  useEffect(() => {
    function onSent(e) {
      if (e.detail?.chatId === chatId) load();
    }
    window.addEventListener(WHATSAPP_MESSAGE_SENT_EVENT, onSent);
    return () => window.removeEventListener(WHATSAPP_MESSAGE_SENT_EVENT, onSent);
  }, [chatId, load]);

  if (!loaded || !proposal) return null;

  const isShadow = proposal.status === 'shadow';

  // Shadow records are a management artefact, not an operator task: one quiet
  // line that can be opened, never a card competing with the composer.
  if (isShadow && !expanded) {
    return (
      <div className="border-t border-gray-200 bg-slate-50 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center gap-2 text-start text-[12px] text-slate-600 transition hover:text-slate-800"
        >
          <span aria-hidden>🤖</span>
          <span>
            הסוכן ניתח את השיחה במצב צל
            {proposal.run?.intent ? ` — ${proposal.run.intent}` : ''}
          </span>
          <span className="ms-auto underline">הצג</span>
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-gray-200 bg-blue-50/40 p-3">
      <ProposalCard proposal={proposal} compact onHandled={load} />
      {isShadow && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-2 text-[12px] text-slate-600 underline transition hover:text-slate-800"
        >
          הסתר
        </button>
      )}
    </div>
  );
}
