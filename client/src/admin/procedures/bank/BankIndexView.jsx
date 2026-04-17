// Desktop-only empty work area shown when no item is selected on the bank tab.
// On mobile, when no item is selected, the list pane fills the screen instead
// (see BankHome) and this view is never rendered.
export default function BankIndexView() {
  return (
    <div className="w-full flex items-center justify-center p-10">
      <div className="text-center max-w-sm">
        <div className="text-5xl mb-4 opacity-40">☷</div>
        <div className="text-lg font-semibold text-gray-800 mb-1">
          בחרו פריט לעריכה
        </div>
        <div className="text-sm text-gray-500">
          או צרו פריט חדש מהרשימה מימין.
        </div>
      </div>
    </div>
  );
}
