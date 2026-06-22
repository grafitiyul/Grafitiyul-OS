import '../styles/public.css';
import { cn } from '../lib/cn.js';

// The single wrapper that establishes the public surface: it applies the
// `.public-root` scope (Fredoka font + RTL + public colours, all defined in
// public.css) and sets the text direction.
//
// Hebrew-first → `dir` defaults to "rtl". When English ships, a page simply
// renders <PublicRoot dir="ltr">; nothing else in the tree needs to change.
//
// Everything public renders INSIDE this wrapper, which is why the public
// styles can be fully scoped and never touch the admin/learner/portal UI.
export default function PublicRoot({ children, dir = 'rtl', className }) {
  return (
    <div dir={dir} className={cn('public-root min-h-screen flex flex-col', className)}>
      {children}
    </div>
  );
}
