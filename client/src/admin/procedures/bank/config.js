// Stable keys for bank items — logic references these, never labels.

export const ITEM_KINDS = {
  CONTENT: 'content',
  QUESTION: 'question',
};

// Display labels. Free to change without touching any logic.
export const ITEM_KIND_LABELS = {
  [ITEM_KINDS.CONTENT]: 'תוכן',
  [ITEM_KINDS.QUESTION]: 'שאלה',
};

// ANSWER_TYPES / ANSWER_TYPE_LABELS were removed when the question
// item moved to the unified model (options + allowTextAnswer +
// requirement). See client/src/lib/questionRequirement.js for the
// replacement. The server still writes `answerType` during the
// rollback window as a deprecated mirror column.

// Filter chips in the list pane. Keys are stable.
export const LIST_FILTERS = [
  { key: 'all', label: 'הכל' },
  { key: ITEM_KINDS.CONTENT, label: 'תוכן' },
  { key: ITEM_KINDS.QUESTION, label: 'שאלות' },
];
