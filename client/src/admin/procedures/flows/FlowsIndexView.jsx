// Desktop-only empty state shown when no flow is open.
// On mobile, the list fills the screen and this view is never rendered.
export default function FlowsIndexView() {
  return (
    <div className="w-full flex items-center justify-center p-10">
      <div className="text-center max-w-sm">
        <div className="text-5xl mb-4 opacity-40">◫</div>
        <div className="text-lg font-semibold text-gray-800 mb-1">
          בחרו זרימה לעריכה
        </div>
        <div className="text-sm text-gray-500">
          או צרו זרימה חדשה מהרשימה מימין.
        </div>
      </div>
    </div>
  );
}
