// ONE definition of "which conversation is open" and how a conversation row
// shows it. Both the identity rule and the visual state live here so the inbox,
// the row component and any future conversation surface can never diverge.
//
// IDENTITY — a conversation is a WhatsAppChat ROW, and that row is unique per
// (accountId, externalChatId): the same remote number reached through two of our
// business numbers is TWO different conversations with two different ids. Row ids
// alone are therefore already account-safe; we still compare accountId whenever
// both sides carry it, so no future DTO change can make one account's selection
// light up the other account's row.

// True when `a` and `b` are the same conversation (account-scoped).
export function isSameChat(a, b) {
  if (!a || !b || !a.id || !b.id) return false;
  if (a.id !== b.id) return false;
  // Both known → they must agree. One unknown → the row id already carries the
  // account scope (DB-unique per account), so it stands on its own.
  if (a.accountId && b.accountId && a.accountId !== b.accountId) return false;
  return true;
}

// The row's selected state: is THIS chat the open conversation?
export function isChatSelected(chat, selected) {
  return isSameChat(chat, selected);
}

// Does a chat belong to the currently filtered business number? Used to drop a
// selection that no longer belongs to the visible account — switching accounts
// must never leave the previous account's conversation open (or its highlight
// stranded on a row that is no longer in the list).
export function chatMatchesAccountFilter(chat, accountFilter) {
  if (!chat) return true; // nothing selected — nothing to drop
  if (!accountFilter || accountFilter === 'all') return true;
  // Unprovable ownership drops the selection: showing the list is always safe,
  // showing another number's conversation is not.
  return !!chat.accountId && chat.accountId === accountFilter;
}

// ── Visual state ───────────────────────────────────────────────────────────
// SELECTED (the open conversation) is a soft, semi-transparent BLUE fill plus a
// blue inset ring and a solid blue accent bar on the leading edge — obvious at a
// glance across a long list, while every name / preview / timestamp / unread
// badge keeps its own colour and contrast (10% blue over white ≈ #eef4fe).
//
// Hover is PRESERVED, never allowed to erase the selection: a hovered selected
// row simply deepens (10% → 20%) instead of falling back to the neutral hover
// tint. Selection beats the keyboard cursor, which beats hover.
export const CHAT_ROW_BASE = 'group relative cursor-pointer px-3 py-2.5 transition';

export function chatRowStateClass({ active = false, cursor = false } = {}) {
  if (active) return 'bg-blue-500/10 ring-1 ring-inset ring-blue-300 hover:bg-blue-500/20';
  if (cursor) return 'bg-gray-100 hover:bg-gray-200/70';
  return 'hover:bg-gray-50';
}

// The selected row's accent bar — RTL leading edge (right), same blue family.
export const CHAT_ROW_ACCENT = 'absolute inset-y-0 right-0 w-[3px] bg-blue-500';

// Full class string for a conversation row.
export function chatRowClass(state) {
  return `${CHAT_ROW_BASE} ${chatRowStateClass(state)}`;
}
