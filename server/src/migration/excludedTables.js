// The ONE source of truth for legacy content that must never be read, snapshotted,
// or browsed. Lives outside the API sources so consumers (extraction AND the
// Review Center) can share it without importing a legacy API client.
//
// `גישה, סיסמאות` is the Airtable passwords table (61 rows). Its contents have
// never been read and must never be.
export const EXCLUDED_TABLE_NAME = 'גישה, סיסמאות';
