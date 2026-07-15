import { useEffect, useState } from 'react';

// Debounce a fast-changing value (a search box) down to one settled value.
// The pending timer is cleared on every change, so a burst of keystrokes costs
// exactly one request — the one after the user stops typing.
export default function useDebouncedValue(value, delay = 250) {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  return settled;
}
