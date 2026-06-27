import 'flag-icons/css/flag-icons.min.css';

// A real, colored SVG country flag — rendered identically on every OS (Windows,
// macOS, iOS, Android) because it does NOT use OS emoji flags. Backed by the
// `flag-icons` CSS (each flag is a small SVG, fetched only when shown). The `iso`
// code + `name` come from the shared phone utility (parsePhone) — this component
// holds no country detection, only the iso→flag mapping.
//
// Sizes with the surrounding font-size (flag-icons `.fi` is ~1.33em wide). When
// the country is unknown we show a neutral globe so the indicator never vanishes.
// Hovering shows the country name.
export default function CountryFlag({ iso, name, className = '' }) {
  const code = iso ? iso.toLowerCase() : '';
  const label = name || iso || undefined;

  if (!code) {
    return (
      <span role="img" aria-label={label} title={label} className={`leading-none ${className}`}>
        🌐
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`fi fi-${code} rounded-[2px] shadow-sm ring-1 ring-black/5 ${className}`}
    />
  );
}
