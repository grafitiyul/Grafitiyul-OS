// The shared admin card shell.
//
// Extracted from DealDetail so the Deal workspace and the cards that live
// inside it render through ONE implementation. `variant="panel"` is the tighter
// right-panel form (smaller radius, denser padding, 13px title); the default is
// the roomier main-column card.
export default function PanelCard({ title, action, children, variant = 'default' }) {
  const panel = variant === 'panel';
  return (
    <section
      className={`bg-white border border-gray-200 ${panel ? 'rounded-xl' : 'rounded-2xl shadow-sm'}`}
    >
      <div
        className={`flex items-center justify-between gap-2 border-b border-gray-100 ${
          panel ? 'px-4 pt-3 pb-2.5' : 'px-5 pt-4 pb-3'
        }`}
      >
        <h2 className={`font-semibold text-gray-900 ${panel ? 'text-[13px]' : 'text-[15px]'}`}>
          {title}
        </h2>
        {action}
      </div>
      <div className={panel ? 'p-4' : 'p-5'}>{children}</div>
    </section>
  );
}
