// Resolve how to display a timeline item's origin (note, comment, and future
// kinds all share this). Every item is attributable: a human 'user' shows their
// name; any non-human origin shows an explicit source label + a small typed
// badge. Nothing is ever anonymous.

// Badges for non-'user' origins. 'user' shows no badge — just the person's name.
export const ACTOR_BADGES = {
  api: { label: 'API', cls: 'bg-violet-100 text-violet-700' },
  automation: { label: 'אוטומציה', cls: 'bg-cyan-100 text-cyan-700' },
  system: { label: 'מערכת', cls: 'bg-gray-200 text-gray-700' },
  import: { label: 'ייבוא', cls: 'bg-amber-100 text-amber-700' },
};

// { name, badge } for an item carrying actorType / actorLabel / createdByName.
export function actorDisplay(item) {
  const type = item?.actorType || 'user';
  if (type === 'user') {
    return { name: item?.createdByName || 'משתמש', badge: null };
  }
  return {
    name: item?.actorLabel || ACTOR_BADGES[type]?.label || 'מקור',
    badge: ACTOR_BADGES[type] || null,
  };
}
