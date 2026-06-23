# Homepage — Deferred Backlog (frozen)

> Status: **Homepage frozen at ~78% fidelity** (2026-06-23). Do not continue
> polishing unless a future asset batch / Figma API access / image tooling
> becomes available. This file tracks every deferred gap and improvement.

Preview: `/__preview/home` · Accessibility statement: `/__preview/accessibility`

## Deferred gaps

### Missing assets (need Figma API reset or designer/brand hand-off)
- **Company-logo wall (~21 client logos)** in Why-Us — also **legal/licensing**: third-party trademarks must be **brand-supplied**, not recreated.
- **Press / media logos** (Press section).
- **8 Why-Us value icons** — not in the theme `icons/` folder; *maybe* recoverable from the backup DB/uploads (ACF media) — worth a targeted check before assuming Figma-only.
- **Testimonial avatars** + Google-review styling.

### Implementation / tooling
- **Full-bleed background textures** (`hero_bg`, `why_us_bg`, `contact bg`) — present in the WP theme but 4.8–9.4 MB PNGs; need a **WebP/transcode step** (no image tooling in the current environment) before shipping.
- **Photo optimization → WebP** (e.g. `gallery-1` ~2 MB) and **spray-font subsetting** (RubikSprayPaint ~941 KB).
- **Decorative fine-positioning** — arrow / highlight-blob / stats-deco exact coordinates vs the Figma 1440 artboard; per-section spacing tuning.
- **Wire already-copied-but-unused decor** — extra arrows (`arrow_2/3/4`), `patch_1–6`, `text_lines`, `blot_golden*`, `monkeys_el`, `hash_tag`, `product_reviews_blot`.

### Content (in the WordPress backup DB)
- **Real testimonials** (copy + reviewers) from the `reviews` CPT.
- **Exact per-card tour copy** from the `tours`/`product` data (currently representative).

### Intentional differences (not pursuing)
- **Pixel-identical at every viewport** — responsive ≠ a fixed 1440 canvas; matched at artboard breakpoints.
- **Graffiti lettering** ("PRIVATE"/"NO RULES") rendered as **live RubikSprayPaint text**, not images — accessible and self-hosted by design.

## Accessibility follow-ups (homepage)
- Full **keyboard-only** + **screen-reader (NVDA/VoiceOver, Hebrew/RTL)** walkthrough.
- **axe/Lighthouse** automated audit; **200%/400% zoom** reflow check.
- Mobile menu **focus-trap** (Esc + focus-return already done).
- Wrap inline English inside Why-Us values ("Google", "Tripadvisor") in `lang="en"`.
- **Accessibility statement**: complete legal references + accessibility-coordinator details (currently draft); legal/business sign-off before launch.

## When to revisit
Batch this when **(a)** the Figma API resets (logos, icons, exact positioning together), **(b)** the brand supplies company/press logos, and **(c)** an image-optimization (WebP) step is available — then do one consolidated homepage asset-completion pass.
