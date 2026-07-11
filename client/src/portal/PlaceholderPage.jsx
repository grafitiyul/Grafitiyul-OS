// Honest placeholder for portal destinations whose backing module isn't
// live yet. States exactly what exists and what doesn't — the portal never
// pretends a module is ready.

export default function PlaceholderPage({ icon, title, description }) {
  return (
    <div>
      <h1 className="mb-3 px-1 text-[17px] font-bold text-gray-900">{title}</h1>
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
        <div className="mb-3 text-4xl opacity-60">{icon}</div>
        <div className="mb-1 text-base font-semibold text-gray-800">בקרוב</div>
        <div className="mx-auto max-w-xs text-sm leading-relaxed text-gray-500">
          {description}
        </div>
      </div>
    </div>
  );
}
