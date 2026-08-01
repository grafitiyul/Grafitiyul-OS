// Queue source adapters — READ ONLY, one per existing queue.
//
// Each adapter answers exactly two questions about its own table:
//   list({ channel, scope, limit })  → QueueItem[]
//   and nothing else.
//
// No adapter writes. No adapter sends. Adding a fifth sending subsystem later
// is one file here plus one line below — the queue screen never changes.

import { communicationSource } from './communication.js';
import { whatsappScheduledSource } from './whatsappScheduled.js';
import { emailScheduledSource } from './emailScheduled.js';
import { adminReportSource } from './adminReports.js';

export const SOURCES = [
  communicationSource,
  whatsappScheduledSource,
  emailScheduledSource,
  adminReportSource,
];

export function sourcesForChannel(channel) {
  return SOURCES.filter((s) => s.channels.includes(channel));
}
