import { Link } from 'react-router-dom';

// Square category cards, Challenge-system style. Active cards link somewhere;
// placeholder cards show a "בקרוב" badge and are not clickable.

export function CategoryGrid({ children }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">{children}</div>
  );
}

export function CategoryCard({ to, icon, title, description, comingSoon }) {
  const inner = (
    <div
      className={`h-full min-h-[140px] rounded-xl border p-5 flex flex-col gap-2 transition ${
        comingSoon
          ? 'border-gray-200 bg-gray-50'
          : 'border-gray-200 bg-white shadow-sm hover:shadow-md hover:border-blue-300'
      }`}
    >
      <div className="text-3xl leading-none">{icon}</div>
      <div className="font-semibold text-gray-900 text-[15px]">{title}</div>
      <div className="text-[12px] text-gray-500 leading-relaxed flex-1">
        {description}
      </div>
      {comingSoon && (
        <span className="self-start rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-500">
          בקרוב
        </span>
      )}
    </div>
  );

  if (comingSoon || !to) {
    return <div className="cursor-default opacity-75">{inner}</div>;
  }
  return (
    <Link to={to} className="block">
      {inner}
    </Link>
  );
}
