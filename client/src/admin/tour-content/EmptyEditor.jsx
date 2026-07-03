// Placeholder shown in the main pane before a station is selected. Keeps the
// 3-pane frame balanced instead of leaving a blank void.
export default function EmptyEditor({ hint }) {
  return (
    <div dir="rtl" className="h-full grid place-items-center text-center p-10">
      <div>
        <div className="text-4xl mb-3 opacity-60">🗺️</div>
        <div className="text-[15px] font-semibold text-gray-500">{hint}</div>
        <div className="text-[13px] text-gray-400 mt-1">סיור ← תחנה ← עריכת החלקים</div>
      </div>
    </div>
  );
}
