import Dialog from '../common/Dialog.jsx';
import CompletionModes from './CompletionModes.jsx';

// Standalone wrapper around the shared CompletionModes body (also embedded in the
// progressive registration modal). One implementation of the three modes.
export default function RegistrationCompletionModal({ deal, tour, context, onClose, onDone }) {
  return (
    <Dialog open onClose={onClose} title="השלמת ההרשמה" size="lg">
      <div className="space-y-4">
        {tour && (
          <div className="rounded-lg bg-gray-50 px-3 py-2 text-[13px] text-gray-600">
            סיור נבחר: <span className="font-medium text-gray-800">{tour.date} · {tour.startTime}</span>
            {tour.product?.nameHe && <span> · {tour.product.nameHe}</span>}
          </div>
        )}
        <CompletionModes
          deal={deal}
          tourEventId={tour?.id}
          phone={deal?.customerPhone || ''}
          context={context || {}}
          onDone={() => { onDone?.(); onClose?.(); }}
        />
      </div>
    </Dialog>
  );
}
