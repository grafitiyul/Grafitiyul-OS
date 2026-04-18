// Empty state shown in the work area when no attempt is selected.
export default function ApprovalsIndexView() {
  return (
    <div className="hidden lg:flex flex-1 items-center justify-center bg-gray-50 p-10">
      <div className="text-center max-w-sm">
        <div className="text-5xl mb-4 opacity-40">✓</div>
        <div className="text-lg font-semibold text-gray-800 mb-1">
          בחרו תשובה לאישור
        </div>
        <div className="text-sm text-gray-500">
          לחצו על ניסיון מהרשימה כדי לראות את כל השאלות והתשובות, ולאשר או לדחות לפי שאלה.
        </div>
      </div>
    </div>
  );
}
