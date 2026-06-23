import { useState, useMemo } from 'react';
import PublicLayout from '../../shell/PublicLayout.jsx';
import Seo from '../../seo/Seo.jsx';
import Section from '../../components/Section.jsx';
import SectionHeading from '../../components/SectionHeading.jsx';
import Input from '../../components/Input.jsx';
import Select from '../../components/Select.jsx';
import Button from '../../components/Button.jsx';
import Icon from '../../components/Icon.jsx';
import TourCatalogCard from '../../components/TourCatalogCard.jsx';
import {
  toursPage,
  tours,
  cities,
  activityTypes,
  durations,
  dateRanges,
} from '../../content/tours.js';

const EMPTY = { search: '', city: '', activity: '', duration: '', date: '' };

// Tours Catalog (Figma "Our Tours" + WP tours-listing.php). Mock data, no DB /
// WooCommerce / booking. Filters run client-side. Native styled selects + a
// simple date filter (approved V1 decisions). a11y: labelled controls, live
// result count, accessible cards, keyboardable filter panel.
export default function ToursPage() {
  const [filters, setFilters] = useState(EMPTY);
  const [open, setOpen] = useState(false); // mobile filter panel
  const set = (key) => (value) => setFilters((f) => ({ ...f, [key]: value }));
  const isFiltered = Object.values(filters).some(Boolean);

  const results = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return tours.filter((t) => {
      if (q && !(`${t.title} ${t.excerpt}`.toLowerCase().includes(q))) return false;
      if (filters.city && !t.cities.includes(filters.city)) return false;
      if (filters.activity && t.activityType !== filters.activity) return false;
      if (filters.duration) {
        const bucket = durations.find((d) => d.id === filters.duration);
        if (bucket && !bucket.match(t.durationMin)) return false;
      }
      if (filters.date && filters.date !== 'all') {
        // Mock month filter: today is month 06 → this-month=06, next-month=07.
        const month = filters.date === 'next-month' ? '/07' : '/06';
        if (!t.closestDates.some((d) => d.date.endsWith(month))) return false;
      }
      return true;
    });
  }, [filters]);

  return (
    <PublicLayout dir="rtl">
      <Seo
        title={toursPage.title}
        description={toursPage.subtitle}
        path="/tours"
        noindex
      />
      <Section tone="light" space="lg">
        <SectionHeading title={toursPage.title} subtitle={toursPage.subtitle} />

        {/* Mobile filters toggle */}
        <div className="mt-8 lg:hidden">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-brand-700"
            aria-expanded={open}
            aria-controls="tours-filters"
            onClick={() => setOpen((v) => !v)}
            iconRight={<Icon name="chevronDown" className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />}
          >
            פילטרים
          </Button>
        </div>

        {/* Filter panel */}
        <form
          id="tours-filters"
          className={`mt-4 rounded-card bg-white p-5 shadow-card lg:mt-8 lg:block ${open ? 'block' : 'hidden'}`}
          onSubmit={(e) => e.preventDefault()}
          role="search"
          aria-label="סינון סיורים וסדנאות"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="relative sm:col-span-2 lg:col-span-1">
              <label htmlFor="tour-search" className="sr-only">חיפוש סיורים וסדנאות</label>
              <Input
                id="tour-search"
                type="search"
                placeholder="חיפוש סיורים וסדנאות"
                value={filters.search}
                onChange={(e) => set('search')(e.target.value)}
                className="pr-10"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-ink-400" aria-hidden="true">
                <Icon name="search" className="h-5 w-5" />
              </span>
            </div>
            <Select label="עיר" value={filters.city} onChange={set('city')} options={cities} />
            <Select label="סוג פעילות" value={filters.activity} onChange={set('activity')} options={activityTypes} />
            <Select
              label="משך פעילות"
              value={filters.duration}
              onChange={set('duration')}
              options={durations.map((d) => ({ value: d.id, label: d.label }))}
            />
            <Select
              label="תאריך"
              value={filters.date}
              onChange={set('date')}
              options={dateRanges.map((d) => ({ value: d.id, label: d.label }))}
            />
          </div>
          {isFiltered && (
            <div className="mt-4 flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY)}>
                נקה הכל
              </Button>
            </div>
          )}
        </form>

        {/* Live result count */}
        <p aria-live="polite" className="mt-6 text-body-sm text-ink-600">
          {results.length} תוצאות
        </p>

        {/* Results */}
        {results.length > 0 ? (
          <div className="mt-4 flex flex-col gap-6">
            {results.map((t) => (
              <TourCatalogCard key={t.id} tour={t} />
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-card border border-dashed border-ink-300 bg-white p-12 text-center">
            <p className="text-title text-brand-950">לא נמצאו תוצאות</p>
            <p className="mt-2 text-body text-ink-600">נסו לשנות את הסינון או לנקות את הפילטרים.</p>
            <Button variant="brand" size="sm" className="mt-5" onClick={() => setFilters(EMPTY)}>
              נקה הכל
            </Button>
          </div>
        )}
      </Section>
    </PublicLayout>
  );
}
