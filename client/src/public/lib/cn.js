// Tiny className joiner for the public surface. Filters out falsy values so
// conditional classes read cleanly: cn('base', active && 'is-active').
// No external dependency on purpose (keeps the public bundle lean).
export function cn(...parts) {
  return parts.filter(Boolean).join(' ');
}
