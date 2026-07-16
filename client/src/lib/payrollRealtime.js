// Payroll real-time client — now a thin alias over the SHARED realtime core
// (lib/realtime.js), which was extracted from this file verbatim when the CRM
// Tasks workspace became the second consumer (decision #7: one realtime
// system, never two).
//
// The original names are preserved so every payroll surface (Guide Portal Pay
// page + Admin Finance screens) and payrollRealtime.test.js keep working
// untouched — the test suite is the regression net proving the extraction
// changed nothing.

export {
  DEFAULT_DEBOUNCE_MS,
  createRealtimeStream as createPayrollRealtime,
  useRealtime as usePayrollRealtime,
} from './realtime.js';
