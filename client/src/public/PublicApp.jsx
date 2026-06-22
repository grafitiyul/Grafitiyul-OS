import PublicLayout from './shell/PublicLayout.jsx';
import Seo from './seo/Seo.jsx';
import FoundationPreview from './pages/FoundationPreview.jsx';

// Entry point for the public surface.
//
// Phase 1/2 deliverable: it currently renders the foundation preview inside the
// real shell. When the public router lands (Step 3/4, Vike), this becomes the
// place that maps routes → pages and provides per-page <Seo>. The shell and
// primitives below it do not change.
export default function PublicApp() {
  return (
    <PublicLayout dir="rtl">
      <Seo
        title="מערכת עיצוב"
        description="תצוגת בסיס — טוקנים, רכיבים ושלד האתר הציבורי של גרפיטיול."
        path="/"
        noindex
      />
      <FoundationPreview />
    </PublicLayout>
  );
}
