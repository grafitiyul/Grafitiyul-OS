# WordPress theme fix — "המועדים הקרובים" card showed the 3 FARTHEST dates

**Site:** theguy4u.co.il (WordPress + WooCommerce, theme `frontend`)
**File:** `wp-content/themes/frontend/custom.php` → `get_closest_tour_dates($product_id)`
**Rendered by:** `wp-content/themes/frontend/loop-templates/tours-listing.php` (page
`templates/tours.php`, slug `סיורים-וסדנאות`) as `<ul class="closest-dates">`.

This lives OUTSIDE the GOS repo and is not reachable from GOS deploys (GOS talks
to the store only via the WooCommerce REST API). The corrected function is
recorded here so it can be uploaded to the theme (SFTP or Appearance → Theme File
Editor). Nothing on the GOS side needs to change — the Woo data is already
correct and chronological.

## Root cause

The card reads the product's published variation children, derives one entry per
distinct `pa_תאריך` + `pa_שעה` (date+time), then **sorted DESCENDING** and took the
latest day first — so it returned the three FARTHEST occurrences. It also never
excluded past occurrences and never filtered non-published (cancelled/draft)
variations. Proven live against product #167:

- Before (buggy): `12/09/2026 11:00`, `11/09/2026 10:00`, `10/09/2026 18:00`
- After (fixed):  `15/07/2026 18:00`, `16/07/2026 18:00`, `17/07/2026 13:00`

## The fix (drop-in replacement for `get_closest_tour_dates`)

```php
function get_closest_tour_dates($product_id)
{
    $product = wc_get_product($product_id);
    if (!$product || !$product->is_type('variable')) return null;

    $variations = $product->get_children();
    if (empty($variations)) return null;

    // "Now" in the site timezone, so past occurrences are excluded consistently.
    $tz  = wp_timezone();
    $now = new DateTime('now', $tz);

    $items = [];

    foreach ($variations as $variation_id) {
        $variation = wc_get_product($variation_id);
        if (!$variation) continue;

        // Only currently SELLABLE occurrences count. GOS drafts a variation when
        // its occurrence is cancelled / replaced / expired / completed, so a
        // non-published child is not a real upcoming date.
        if ($variation->get_status() !== 'publish') continue;

        $time_term = get_attr_term($variation, 'pa_שעה');
        $date_term = get_attr_term($variation, 'pa_תאריך');
        if (!$time_term || !$date_term) continue;

        // Canonical occurrence date+time (from the taxonomy terms — never the
        // variation id or menu_order).
        $dateObj = DateTime::createFromFormat(
            'd/m/Y H:i',
            $date_term->name . ' ' . $time_term->name,
            $tz
        );
        if (!$dateObj) continue;

        // Exclude past occurrences.
        if ($dateObj < $now) continue;

        // Dedupe the SAME date+time even when several pricing variations
        // (מבוגר/ילד, סיור/סיור+סדנה) exist for that one occurrence.
        $key = $dateObj->format('Y-m-d H:i');
        $items[$key] = [
            'datetime' => $dateObj,
            'date'     => $date_term->name,
            'time'     => $time_term->name,
        ];
    }

    if (empty($items)) return null;

    // The three NEAREST upcoming occurrences: date ascending, then time
    // ascending (a single chronological comparison of the parsed datetime).
    // Do NOT reverse, and do NOT take the tail of the list.
    $items = array_values($items);
    usort($items, function ($a, $b) {
        return $a['datetime'] <=> $b['datetime'];
    });

    // Fewer than three is fine when fewer valid occurrences exist.
    return array_slice($items, 0, 3);
}
```

This is the single canonical "upcoming dates" selector; `tours-listing.php` only
iterates its output (`$date['date'] | $date['time']`), so no template change is
needed. It satisfies: date asc then time asc, exclude past, exclude
non-published (cancelled/draft/hidden), dedupe date+time across pricing
variations, allow multiple times per day, fewer than three when fewer exist, no
reversing, no tail-slicing, and it uses the canonical date/time terms rather than
variation ids / menu_order.

## Deploy

Upload the edited `wp-content/themes/frontend/custom.php` to the live server, then
purge the LiteSpeed page cache for the tours listing. Verify the card on
`/סיורים-וסדנאות/` shows the three nearest dates ascending.
