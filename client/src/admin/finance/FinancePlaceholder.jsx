// Honest placeholder for finance areas that are not built yet. States clearly
// that nothing is managed here — no fake data, no dead controls.
export default function FinancePlaceholder({ icon, title, description }) {
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white border border-gray-200 rounded-xl p-8 text-center">
        <div className="text-4xl mb-3" aria-hidden="true">{icon}</div>
        <h1 className="text-lg font-semibold text-gray-900 mb-2">{title}</h1>
        <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}
