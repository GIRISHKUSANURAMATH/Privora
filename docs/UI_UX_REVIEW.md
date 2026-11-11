# UI / UX Review

Review of the built application in a real Chromium browser (Playwright), on 8 November 2026.
Screenshots are in [`../assets/screenshots/`](../assets/screenshots/).

## Design system

| Token | Dark (default) | Light | Use |
|---|---|---|---|
| `--c-bg` | `#090d1c` midnight | `#f3f5fb` | page background with a faint 32 px "privacy grid" lattice |
| `--c-surface` / `--c-raised` | `#111830` / `#172040` | `#ffffff` / `#f6f7fd` | panels, inputs |
| `--c-indigo` | `#7c7bff` | `#5b57e8` | primary actions, active navigation |
| `--c-blue` | `#58a6ff` | `#1f6fe0` | conventional models, data |
| `--c-violet` | `#b18cff` | `#7c4fe0` | anything privacy / ε / DP |
| `--c-signal` / `--c-amber` / `--c-rose` | green / amber / rose | darker variants | good / caution / risk |

* **Type:** IBM Plex Sans (UI) with tabular numerals for every metric; IBM Plex Mono only for
  raw data cells. Bundled locally via `@fontsource`, so the app works offline and the CSP needs
  no font CDN.
* **Colour carries meaning consistently:** blue = conventional, violet = DP/privacy, green =
  federated / good, rose = risk / attack success. Status is never colour-only: badges have
  text, the participation grid has screen-reader labels, risk has a number and a word.
* **Signature element:** the ε dial in the DP Studio (log scale 0.1–50, green→violet→amber→rose)
  and the matching ε rail on the overview. Everything around it is kept quiet.
* **Radius hierarchy:** 14 px panels, 8 px controls, 6 px badges — not one radius everywhere.
* **Motion:** used only in response to actions (toasts, dialog, progress bar, theme switch).
  `prefers-reduced-motion` disables transitions.

## Page-by-page

| Page | What was checked | Result |
|---|---|---|
| Overview | Hero, ε rail, 6 KPIs, privacy-vs-accuracy scatter, recent activity, attack-resistance bars, quick actions, empty states | All values from `/api/dashboard`; empty states verified on a fresh data dir before experiments ran |
| Dataset Studio | Synthetic generation, drag-and-drop/keyboard upload, column table with sensitivity badges, histogram/top-values, missing-value chart, pagination, export, delete confirmation | Working; upload errors surface as toasts with the server's reason |
| Privacy Inspector | Risk score, findings with evidence, per-column action editor, preview, save copy, before/after tables, k-anonymity chart, protection experiment | Working |
| DP Studio | Mode switch, ε slider / σ slider, δ validation against 1/n, live calculator (σ, q, steps, ε curve, 3 accountants), results, privacy ledger, clip-fraction chart | Calculator values match the backend accountant; run results identical to Experiments page |
| Federated Studio | Topology (clients on a ring, live dash animation while running), parameters, privacy modes with plain-language explanations, results, participation grid, per-client cards | Working |
| Attack Lab | Threat model panel, configuration, findings cards, ROC, AUC by technique, precision/recall/advantage, confidence histogram, full metric table, attribute inference | Working |
| Experiments | Filter tabs, list, detail with config, results, report, delete, saved artifacts with "Reload & evaluate" | Reload verified against the API |
| Analytics | Cross-experiment scatter, ε trend, attack AUC, FL vs centralized, selectable model comparison | Working |
| Reports | Generate, preview Markdown, download HTML/MD/JSON, delete with confirmation | Downloads verified with HTTP 200 and correct `Content-Disposition` |
| Settings | Theme, runtime versions, limits, clear studio state | Working |
| Documentation | Sectioned methodology, limitations | Working |

Automated check across 18 captures (11 pages, light theme, 390 px phone, 820 px tablet,
1280 × 720 laptop, 1440 px desktop): 0 console errors, 0 page errors, 0 horizontal overflow.

**Correction (second verification pass):** those captures loaded each page directly. A later
click-through workflow from an empty install found a crash the captures could not see:
navigating between pages threw `destroy is not a function` because the scroll-to-top effect
returned the Promise that current Chromium returns from `window.scrollTo`. Fixed (block-bodied
effects everywhere), covered by two Vitest regressions, and the 12-step workflow now passes
with 0 console errors — see `VERIFICATION_REPORT.md` §7.

**Correction (post-publication audit):** the "0 horizontal overflow" result above was measured
incorrectly. With phone emulation, Chromium widens the layout viewport to fit the content, and
the check compared the page width with that widened viewport instead of the requested 390 px.
Two phone-width overflows were hidden by this:
`16-mobile-attack.png` was 411 px wide, and Federated Studio results were 520 px wide at 390 px.
Both are fixed (see the table below). The check now compares against the requested width, and
`scripts/capture_screenshots.py` fails any capture that is wider than its viewport.

## Responsive behaviour

* ≥ 1024 px: fixed sidebar (252 px, collapsible to 72 px icon rail; choice remembered).
* < 1024 px: top bar with menu button opening a drawer; grids collapse to one or two columns.
* Wide tables scroll horizontally inside their panel instead of the page.
* Charts use `ResponsiveContainer` and keep readable axis labels down to 390 px.

## Accessibility

* Skip-to-content link; landmarks (`nav`, `main`, `header`); one `h1` per page.
* Visible `:focus-visible` ring on all interactive elements; every control reachable by keyboard
  (upload zone responds to Enter/Space; dialogs focus the confirm button and close on Escape).
* Form fields have associated labels; invalid numeric input sets `aria-invalid` and a red border.
* Segmented controls use `radiogroup`/`radio` + `aria-checked`; tabs use `tablist`/`tab` +
  `aria-selected`; switches use `role="switch"`.
* Progress bars expose `aria-valuenow`; run status uses `aria-live="polite"`; toasts use
  `status`/`alert`.
* Each chart is a `<figure>` with an `aria-label` and a screen-reader caption summarising data.
* Contrast: **corrected in the release audit.** The earlier version of this review checked a
  handful of colour pairs by hand and claimed AA. An axe-core scan then found 20 failing pairs
  (small muted/semantic text on tinted badges and panels, mostly in the light theme). Text tokens
  were recomputed to reach ≥ 4.5:1 against every surface they sit on, including their own
  10–15 % badge tints; for example, light muted is now `#565c7e` and dark muted `#9ba1bd`.
* **axe-core 4.14 (WCAG 2.0/2.1 A + AA + best practice): 0 violations.** The pre-release scan
  covered all 11 pages in both themes, plus the DP/FL/attack result views, the inspector
  before/after preview and the mobile navigation drawer. The post-publication re-run covered the
  11 pages in both themes only. The release audit also fixed unlabelled table inputs, keyboard-inaccessible
  scroll regions (now focusable named regions), unnamed chart points (SVG `<title>`), a
  name/label mismatch on the upload zone, and an `aria-label` on a non-landmark `div`.

## Issues found during review and fixed

| Issue | Fix |
|---|---|
| Privacy-utility line zig-zagged because points were drawn in creation order | Points sorted by ε; explicit log-scale ticks |
| Overview connected DP models from different experiments with a line, implying a trend | `connect={false}` on cross-experiment charts |
| Segmented controls stretched to full width inside form fields | `w-fit self-start` |
| ε dial needle crossed the ε value | Needle drawn only on the outer ring with a knob |
| ROC y-axis title overlapped tick labels | Wider axis, offset label |
| "(1e-5)" wrapped under ε in metric tables | `whitespace-nowrap` |
| Redundant "Open in Experiments" link on the Experiments page itself | Hidden there |
| "Gap to non-private" showed positive gaps without a sign | Signed values, column renamed "Δ vs non-private" |
| Route change crashed the app ("destroy is not a function") when `window.scrollTo` returns a Promise | Effects rewritten with block bodies; regression + static guard tests |
| Attack Lab scrolled sideways at 390 px: grids had no explicit column below `xl`, so a long `<select>` option widened the track | `grid-cols-1` (`minmax(0, 1fr)`) on every `xl`/`2xl` grid; static guard test |
| Federated Studio results widened the page to 520 px at 390 px: `sr-only` labels in the participation table escaped its unpositioned scroll box | Every horizontal scroll container is `relative`; static guard test |
| ROC axes printed 0.0, 0.3, 0.5, 0.8, 1.0 at ticks Recharts had placed at 0, 0.25, 0.5, 0.75, 1 | Explicit ticks 0, 0.2, ..., 1.0 on both axes; rendered-SVG test checks labels against pixel positions |
| Percent and decimal axes printed rounded labels at non-round positions (for example "63%" at 63.5 %) | Ticks chosen from 1/2/5 x 10^k steps and kept only if the chart's own formatter prints them exactly |
| Histogram bins 1.5 wide were labelled 15, 16, 18 ... (rounded to whole numbers) | Bin labels use the fewest decimals within 2 % of a bin; at most about five labels per histogram |
| Long category labels ran into each other (Attack Lab "Entropy threshold" / "Shadow models" at 390 px, federated run names in Analytics) | Labels wrap onto up to three lines inside their own band; the font steps down to 9 px only if a single word would not fit |
| Analytics chips and model labels were cut mid-word (`slice(0, 28)`) | Shortened at a word boundary with an ellipsis; full name in the tooltip |
| "Non-private" and "Centralized" reference labels were drawn inside the plot, where data points covered them | Explained in a legend line below the chart |
| ROC x-axis title touched the legend | Axis band sized for tick labels plus the title |
| Overview "Start something" cards were 7 px wider than their panel at 390 px (grid without a base column below `sm`) | `grid-cols-1` on every responsive grid; the static guard now covers sm, md, lg, xl and 2xl |
| Sidebar needed 747 px, so at 1280 x 720 "Documentation" sat half under the Collapse bar | Compact spacing (687 px in total), menu scrolls on its own (`min-h-0`), brand and footer never shrink; tested at 720, 600 and 480 px |
| Reports screenshot generated a duplicate report and showed its toast | Saved reports have a Preview button; the capture previews an existing report and waits for notifications to close |
| Data quality axis printed "100000000%" with invisible bars (a `${v}%` formatter read as a fraction formatter by the new tick helper) | Formatter scale inferred; ticks never widen past the data range |
| Analytics at 390 px intermittently scrolled sideways: a hidden chart tooltip sat past the viewport | Chart frames clip horizontally |

## Known UI limitations

* Charts are rendered with Recharts (SVG), not Plotly; there is no chart-level zoom or PNG
  export. Reports provide the exportable artefact.
* Live progress uses 1-second polling rather than WebSockets.
* The light theme is complete but was reviewed less extensively than the default dark theme.
* axe-core is automated. No manual test with a screen reader (NVDA, JAWS, VoiceOver) has been done.
