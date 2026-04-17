export default function TopBar() {
  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center px-4 shrink-0 shadow-sm">
      <div className="font-bold text-gray-900 text-[15px]">Grafitiyul OS</div>
      <div className="hidden lg:flex items-center gap-3 ms-6 text-sm">
        <span className="text-gray-300">/</span>
        <span className="text-gray-700">נהלים</span>
      </div>
      <div className="flex-1" />
    </header>
  );
}
