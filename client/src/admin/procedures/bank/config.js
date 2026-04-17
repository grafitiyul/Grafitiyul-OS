// Stable keys for bank items — logic references these, never labels.

export const ITEM_KINDS = {
  CONTENT: 'content',
  QUESTION: 'question',
};

export const ANSWER_TYPES = {
  OPEN_TEXT: 'open_text',
  SINGLE_CHOICE: 'single_choice',
};

// Display labels. Free to change without touching any logic.
export const ITEM_KIND_LABELS = {
  [ITEM_KINDS.CONTENT]: 'תוכן',
  [ITEM_KINDS.QUESTION]: 'שאלה',
};

export const ANSWER_TYPE_LABELS = {
  [ANSWER_TYPES.OPEN_TEXT]: 'טקסט חופשי',
  [ANSWER_TYPES.SINGLE_CHOICE]: 'בחירה יחידה',
};

// Filter chips in the list pane. Keys are stable.
export const LIST_FILTERS = [
  { key: 'all', label: 'הכל' },
  { key: ITEM_KINDS.CONTENT, label: 'תוכן' },
  { key: ITEM_KINDS.QUESTION, label: 'שאלות' },
];
