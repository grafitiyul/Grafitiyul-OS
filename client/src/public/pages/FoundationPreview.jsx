import Section from '../components/Section.jsx';
import Card from '../components/Card.jsx';
import Button from '../components/Button.jsx';
import Badge from '../components/Badge.jsx';
import Field from '../components/Field.jsx';
import Input from '../components/Input.jsx';
import Textarea from '../components/Textarea.jsx';
import Checkbox from '../components/Checkbox.jsx';
import Icon from '../components/Icon.jsx';
import { cerulean, breakerBay, cranberry, goldenTainoi, thunderbird, ink } from '../theme/tokens.js';

// Living preview of the Phase-1 foundation: tokens + primitives rendered
// inside the real shell (NavBar/Footer come from PublicLayout). This is review
// scaffolding only — it is NOT a real public page and gets removed when the
// real pages + routing land.

function Swatches({ title, scale }) {
  return (
    <div>
      <div className="mb-2 text-body font-medium text-ink-700">{title}</div>
      <div className="flex flex-wrap gap-1">
        {Object.entries(scale).map(([stop, hex]) => (
          <div key={stop} className="w-14 text-center">
            <div
              className="h-12 w-14 rounded-md border border-ink-200"
              style={{ background: hex }}
            />
            <div className="mt-1 text-caption text-ink-500">{stop}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Literal class names (not `text-${token}`) so Tailwind's content scanner
// actually generates each utility.
const TYPE_RAMP = [
  ['text-display', 'Display 46'],
  ['text-h1', 'Heading 1 — כותרת'],
  ['text-h2', 'Heading 2 — כותרת'],
  ['text-h3', 'Heading 3 — כותרת'],
  ['text-title', 'Title 22'],
  ['text-body-lg', 'Body large 18 — טקסט גוף'],
  ['text-body', 'Body 16 — טקסט גוף'],
  ['text-body-sm', 'Body small 14'],
  ['text-caption', 'Caption 12'],
];

export default function FoundationPreview() {
  return (
    <>
      {/* Hero band to show tones + buttons on a dark surface */}
      <Section tone="dark" space="lg">
        <Badge tone="highlight">Phase 1 · Foundation</Badge>
        <h1 className="mt-4 text-h1">מערכת העיצוב של האתר הציבורי</h1>
        <p className="mt-3 max-w-xl text-body-lg text-brand-100/90">
          טוקנים, טיפוגרפיה, צבעים ורכיבים בסיסיים — נבנו מתוך ה‑Figma, מוכנים ל‑SEO ול‑RTL.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="action">המשך להזמנה</Button>
          <Button variant="highlight">חפשו סיור</Button>
          <Button variant="outline">צרו קשר</Button>
        </div>
      </Section>

      {/* Colors */}
      <Section tone="white" space="md">
        <h2 className="text-h2">צבעים</h2>
        <div className="mt-6 grid gap-6">
          <Swatches title="Cerulean (brand)" scale={cerulean} />
          <Swatches title="Cranberry (action)" scale={cranberry} />
          <Swatches title="Golden Tainoi (highlight)" scale={goldenTainoi} />
          <Swatches title="Breaker Bay (accent)" scale={breakerBay} />
          <Swatches title="Thunderbird (danger)" scale={thunderbird} />
          <Swatches title="Ink (neutral)" scale={ink} />
        </div>
      </Section>

      {/* Typography */}
      <Section tone="light" space="md">
        <h2 className="text-h2">טיפוגרפיה — Fredoka</h2>
        <div className="mt-6 flex flex-col gap-3">
          {TYPE_RAMP.map(([cls, label]) => (
            <div key={cls} className={cls}>
              {label}
            </div>
          ))}
        </div>
      </Section>

      {/* Buttons + badges */}
      <Section tone="white" space="md">
        <h2 className="text-h2">כפתורים ותגיות</h2>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button size="sm" variant="action">Small</Button>
          <Button size="md" variant="action">Medium</Button>
          <Button size="lg" variant="action">Large</Button>
          <Button variant="brand" iconRight={<Icon name="arrowLeft" className="h-4 w-4" />}>
            Brand
          </Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="action" disabled>
            Disabled
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge tone="brand">סיור</Badge>
          <Badge tone="accent">סדנה</Badge>
          <Badge tone="highlight">מומלץ</Badge>
          <Badge tone="success">זמין</Badge>
          <Badge tone="danger">אזל</Badge>
          <Badge tone="neutral">כללי</Badge>
        </div>
      </Section>

      {/* Form primitives inside a card */}
      <Section tone="light" space="md">
        <h2 className="text-h2">טפסים וכרטיסים</h2>
        <Card className="mt-6 max-w-xl p-8">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="שם פרטי" htmlFor="fn" required>
              <Input id="fn" placeholder="ישראל" />
            </Field>
            <Field label="שם משפחה" htmlFor="ln" required>
              <Input id="ln" placeholder="ישראלי" />
            </Field>
            <Field label="אימייל" htmlFor="em" required error="כתובת אימייל לא תקינה">
              <Input id="em" type="email" invalid placeholder="name@example.com" />
            </Field>
            <Field label="טלפון" htmlFor="ph">
              <Input id="ph" type="tel" placeholder="050-0000000" />
            </Field>
          </div>
          <Field label="הערה" htmlFor="nt" className="mt-4">
            <Textarea id="nt" placeholder="ספרו לנו עוד…" />
          </Field>
          <div className="mt-4">
            <Checkbox id="terms" label="אני מאשר/ת את תקנון האתר" />
          </div>
          <Button className="mt-6" variant="action" fullWidth>
            שליחה
          </Button>
        </Card>
      </Section>
    </>
  );
}
