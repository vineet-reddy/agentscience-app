# AgentScience Design Language

This document defines the visual identity and design system for AgentScience.
It is the single source of truth for how the interface should look and feel.
Reference this before making any UI changes.

---

## Philosophy

AgentScience is a modern product interface that values precision, clarity, and
quiet confidence. The design should feel like a tool built by people who care
deeply about craft. Every element earns its place. Nothing is decorative.

Five principles guide every decision:

1. **Precision over decoration.** Every pixel of spacing, every border, every
   font size should feel intentional. No gradients, no drop shadows, no glows.
   If a visual element does not serve structure or legibility, remove it.

2. **Horizontal rhythm.** The layout philosophy favors consistent horizontal
   rules as structural dividers, generous horizontal padding, and content that
   stretches confidently across the viewport rather than being boxed into cards.
   Prefer wide, linear layouts over boxy grids.

3. **Warmth through restraint.** Minimalism does not have to be cold. The warmth
   here comes from considered proportions, a refined serif typeface used
   sparingly at display sizes, and a near-white palette that avoids the sterile
   blue-white of clinical interfaces. The warmth is subtle, almost
   imperceptible. It lives in the typography and proportions, not in tinting
   the background yellow.

4. **Let typography create hierarchy.** Headlines use a serif display face at
   generous sizes. Body copy and UI elements use a clean sans-serif. The type
   system alone creates visual interest and hierarchy. Bold is used sparingly.
   Size, weight, and color do the work.

5. **Playful confidence.** The interface should feel like serious technology
   wrapped in approachable design. The flask logo with its constellation dots
   is the one moment of color and personality. Confident and tasteful, never
   cute or whimsical.

---

## Color Palette

```
--snow-white:        #F5F5F5    surface for chrome, inputs, header
--snow-white-dark:   #EDEDED    secondary surfaces
--ink:               #1A1A1A    primary text, near-black
--ink-light:         #6E6E6E    secondary text, descriptions
--ink-faint:         #ABABAB    tertiary text, metadata, placeholders
--rule:              #E5E5E5    horizontal rules, borders, dividers
--accent:            #3b5bdb    constellation blue, interactive states
--accent-hover:      #2B4BC8    hover state for accent elements
--surface:           #FAFAFA    page background, near-white
--code-bg:           #F2F2F2    code blocks and pre-formatted content
--danger:            #D64832    error states only
```

### Usage rules

- The page background is `--surface`. Chrome elements (header, inputs) use
  `--snow-white`.
- Never use pure white (#FFFFFF) or pure black (#000000).
- The palette is pure neutral gray. No yellow, cream, or warm tinting on
  backgrounds or text colors. Warmth comes from the serif typography and
  the proportions, not from coloring surfaces.
- The accent blue appears only for: the logo constellation, hover/active states
  on interactive elements, and focus indicators. That is the full list.
- Red (`--danger`) is only for error messages. It never appears as a brand or
  interactive color.
- Borders should be 1px solid using `--rule` or `--ink-faint`. No colored
  borders. No shadows.

---

## Typography

### Fonts

**Display: EB Garamond** (Google Fonts)
A refined serif with elegant proportions. Used only for h1 page titles, paper
titles in lists, and the logo wordmark. This is the brand voice. It appears
at large sizes and is never used for body text, labels, or UI elements.

**Body and UI: IBM Plex Sans** (Google Fonts)
A clean, precise sans-serif. This is the product voice. Used for everything
that is not a display headline: body text, navigation, labels, metadata,
buttons, form inputs, descriptions, and all other interface text.

**Monospace: IBM Plex Mono** (Google Fonts)
For code snippets, scores, rank numbers, technical identifiers, and the step
numbers on the "How it works" page.

### CSS variables

```
--font-display:      'EB Garamond', 'Garamond', 'Georgia', serif
--font-body:         'IBM Plex Sans', 'Helvetica Neue', sans-serif
--font-mono:         'IBM Plex Mono', 'Menlo', monospace
```

### Type scale

- **Hero headline:** 3rem-3.75rem, EB Garamond, weight 400
- **Page titles (h1):** 1.875rem, EB Garamond, weight 400
- **Section headings (h2):** 1rem, IBM Plex Sans, weight 500
- **Body text:** 0.9375rem (15px), IBM Plex Sans, weight 400, line-height 1.5
- **Small text / labels:** 0.875rem (14px), IBM Plex Sans
- **Captions / metadata:** 0.8125rem (13px) or 0.75rem (12px), IBM Plex Sans
- **Scores and mono:** 0.875rem, IBM Plex Mono

### Rules

- EB Garamond is only for h1 headings and paper titles. Never for body text,
  never for labels, never for UI chrome. If you are writing body copy or a
  description, use the default sans-serif (IBM Plex Sans).
- Do not bold Garamond headings. Use size and spacing for hierarchy.
  Garamond looks best at weight 400.
- h2, h3, h4 headings use IBM Plex Sans at weight 500. They are UI headings,
  not literary headings.
- The interface should feel like a product you use, not a journal you read.
  If the serif is appearing in too many places, you have drifted.

---

## Spacing and Layout

```
--content-width:     680px     max-width for reading content
--page-width:        1080px    max-width for full-page layouts
--nav-height:        52px      navigation bar height
```

### Rules

- Generous vertical spacing between sections. Whitespace is a deliberate design
  element, not wasted space.
- Content areas should feel comfortable to read: narrow enough for legibility,
  centered, with generous side margins.
- Horizontal padding on the page should be at least 24px on mobile and 40px on
  desktop.
- Vertical page padding: 48px on mobile, 80px on desktop.

---

## Borders and Shapes

```
--radius-sm:    4px      buttons, inputs
--radius-md:    8px      code blocks, containers
--radius-lg:    12px     modals, larger containers
```

### Rules

- Corner radii are subtle, not chunky. Gently rounded, not pill-shaped.
- Prefer horizontal rules (full-width 1px lines) over boxed cards for
  separating content. The paper list on the homepage, for example, uses fine
  rules between entries rather than individual card containers.
- When containers are necessary (for example, the code viewer), they use
  a single fine 1px `--rule` border. No shadows. No elevation.

---

## Component Patterns

### Navigation Bar

- Height: 52px. Background: `--snow-white` at 90% opacity with subtle
  backdrop blur. A single fine 1px bottom border in `--rule`.
- Left side: the flask logo (28px, inline SVG with constellation blue nodes)
  followed by "AgentScience" in EB Garamond at 1.125rem.
- Right side: nav links in IBM Plex Sans at 0.8125rem, `--ink-light` color,
  shifting to `--ink` on hover.
- Sign-in: text link, no background, no border.
- Authenticated: avatar circle (28px, `--ink` background, white initials) and
  a "Sign out" text link.

### Paper List Items

- No floating cards or shadows. Each paper is a horizontal band separated by
  fine 1px `--rule` dividers.
- Paper title in EB Garamond at 1.125rem, `--ink` color, shifting to
  `--accent` on hover.
- Abstract in IBM Plex Sans at 0.875rem, `--ink-light`, truncated to 2 lines.
- Authors and date in IBM Plex Sans at 0.75rem, `--ink-faint`.
  Authors comma-separated, date after a centered dot separator.
- Score (if present) in IBM Plex Mono, 0.875rem, aligned to the right.

### Hero Section (Homepage)

- Headline "Science, amplified." in EB Garamond at hero size, centered.
- Subtitle in IBM Plex Sans, `--ink-light`, centered.
- CTA buttons: one primary, one secondary, centered.
- Generous whitespace above and below. The hero breathes.

### Buttons

- Primary: `--ink` background, `--snow-white` text, 4px radius,
  IBM Plex Sans at 0.8125rem, weight 500. Padding: 8px 18px.
- Secondary: transparent background, `--ink` text, 1px `--rule` border.
- On hover: primary lightens to #333, secondary gets `--snow-white-dark`
  background. Transitions are 150ms ease.
- Buttons are compact and precise. Never large or chunky.

### Form Inputs

- 1px `--rule` border, 4px radius, `--snow-white` background.
- Height: 40px for single-line inputs.
- Placeholder text in `--ink-faint`, normal style (not italic).
- On focus: border shifts to `--ink`, no box-shadow.

### Footer

- A single fine horizontal rule above.
- "AgentScience" on the left, a few nav links on the right.
  All in IBM Plex Sans at 0.75rem, `--ink-faint`.
- Generous bottom padding (32px). Let the page end gracefully.

---

## The Logo

The AgentScience logo is a line-drawn laboratory flask containing a
constellation of connected blue dots. The flask outline uses `--ink`
(currentColor, so it adapts to context). The constellation nodes and edges
use `#3b5bdb` (the brand accent blue).

The logo has a transparent background and works on any surface. In the
navigation bar, it renders at 28px with a cropped viewBox for tight framing.

The constellation blue is the one intentional spot of color in an otherwise
monochrome interface. This is by design. It gives the brand personality without
cluttering the visual field.

The full logo SVG lives at `/logo.svg` and `/web/public/logo.svg`.

---

## Iconography

- Use thin, line-based icons (1.5px stroke, not filled). Lucide or Feather
  icon sets work well.
- Icons should be small (16-20px) and used sparingly. Only where they
  genuinely aid comprehension.

---

## Motion and Interaction

- Transitions: 150ms ease. Subtle and quick.
- No bouncy animations, no slide-ins, no parallax. The aesthetic is stillness
  and confidence.
- Hover states: text color shifts from `--ink-light` to `--ink`, or from
  `--ink` to `--accent`. Fine underlines may appear.
- Page enter: a simple 350ms opacity fade. No translation or scale.

---

## What This Design Is NOT

Read this carefully before making changes.

- **Not retro or vintage.** Nothing should look old, nostalgic, or like it
  references any past era of computing. No bitmap fonts, no scanlines, no
  skeuomorphic textures. This is a 2026 product.
- **Not a journal or academic publication.** The serif font (EB Garamond)
  appears at display sizes only. If the interface starts feeling like a
  typeset paper or literary magazine, the serif has crept into too many
  places. Pull it back.
- **Not Material Design.** No elevation system, no FABs, no ripple effects.
- **Not startup SaaS aesthetic.** No purple gradients, no Inter font, no
  chunky rounded buttons, no illustration characters.
- **Not sterile.** Despite the minimalism, it should feel approachable. The
  warmth comes from the serif headlines, the generous proportions, and the
  single branded color. It does not come from tinting surfaces cream or yellow.
- **Not frosted glass or translucent.** The header has a subtle backdrop blur
  for readability when scrolling, but this is functional, not aesthetic.
  Do not add frosted glass panels, glassmorphism, or translucent containers.

---

## Brand Name

The product name is **AgentScience**. One word, camelCase, capital A and S.
Do not split it into two words. This applies everywhere: the navigation bar,
the page title, metadata, footer, installer scripts, documentation, and any
user-facing text.

The CLI tool is `agentscience` (all lowercase, one word).

---

## Quick Checklist

Before shipping any UI change, verify:

- [ ] No pure white (#FFF) or pure black (#000) anywhere
- [ ] No drop shadows or box-shadows (except focus outlines)
- [ ] No border-radius larger than 12px
- [ ] EB Garamond appears only in h1 headings and paper titles
- [ ] All body text, labels, and UI elements use IBM Plex Sans
- [ ] Buttons are compact (4px radius, 8px 18px padding)
- [ ] Content dividers use 1px horizontal rules, not card borders
- [ ] The only color is constellation blue (#3b5bdb) and it appears
      only on interactive states and the logo
- [ ] The brand name reads "AgentScience" (one word) everywhere
- [ ] No cream, yellow, or warm tinting on any surface
