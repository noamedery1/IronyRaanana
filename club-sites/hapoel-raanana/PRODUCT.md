# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Parents of boys in Ra'anana (kindergarten through youth age) deciding where their child will play football this season. They usually arrive on a phone, often from a WhatsApp link, and compare clubs on trust, convenience (days, times, pitch location) and atmosphere.

## Product Purpose
Public landing page for Hapoel Ra'anana football (boys' department; the girls' teams are a separate club under the same name and are excluded). Success = a parent finds a fitting team and submits the registration form; the secretary gets an email and calls back.

## Positioning
The club runs on Squadio: parents see the live team schedule and get push notifications when training changes. No neighbouring club page can truthfully claim this.

## Operating Context
- Static page hosted on GitHub Pages at https://hapoel-raanana.techbynoam.com (repo noamedery1/hapoel-raanana). It must never be served from the app origin, because the installed PWA captures in-scope URLs.
- Form posts to `https://squadio.techbynoam.com/api/fcraanana/signups` (CORS-allowed origin) → DB + email to the secretary.
- Crest: `https://squadio.techbynoam.com/api/fcraanana/icon/512`.

## Capabilities and Constraints
- Teams: 16 league teams (ילדים ×10, נוער ×6) + 5 early-age (בית ספר לכדורגל), 15 coaches, ~64 sessions/week, venues לב הפארק (מרטין דרוקר 1), מגרש הבייסבול (הסייפן 15), אצטדיון (ההסתדרות 44). Data is baked into the page as a snapshot (week of 4.10.2026) and kept fixed by request.
- Grade-per-team labels are approximations pending club review.
- Must keep: team browser with details dialog, registration form (consent + separate marketing opt-in, honeypot), privacy policy (Israeli Privacy Protection Law incl. amendment 13), terms, accessibility statement (IS 5568) with a11y toolbar, cookie notice, HTTPS only.

## Brand Commitments
Name הפועל רעננה, Hebrew RTL, club colour red. The content is final pending club review; redesigns are visual only.

## Evidence on Hand
No real photos yet (an `img/` slot exists for hero/team/kids). No testimonials, founding year, trophies or player counts: do not fabricate any.

## Product Principles
1. A parent must reach "this is my kid's team + register" in under a minute on a phone.
2. Truth over hype: only verifiable facts from the club's own schedule.
3. The live-schedule app (Squadio) is the differentiator; show it, don't just claim it.
4. Legal and accessibility pages are part of the product, not footnotes.

## Accessibility & Inclusion
Israeli accessibility regulations (IS 5568 / WCAG AA): keyboard nav, alt text, reduced-motion respect, text-size and contrast toggles.
