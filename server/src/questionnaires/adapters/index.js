// Registers every live subject adapter. Imported once by the service layer —
// the registry itself stays DB-free for unit tests. Future adapters (deal /
// organization / person_ref / contact / …) register here.

import { registerSubjectAdapter } from '../registry.js';
import { tourEventAdapter } from './tourEvent.js';
import { bookingAdapter } from './booking.js';

registerSubjectAdapter('tour_event', tourEventAdapter);
registerSubjectAdapter('booking', bookingAdapter);
