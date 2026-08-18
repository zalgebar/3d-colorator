# 3D Colorator — redesign plan

Turning **SeedSigner Enclosure Designer** into **3D Colorator**, a general-purpose
"color any 3D print" app — while preserving the SeedSigner experience exactly.

| Doc | What's in it |
| --- | --- |
| [01-data-model.md](01-data-model.md) | Every file format: palette, prints, collections, share links, submissions. Migration of the current data. |
| [02-implementation-phases.md](02-implementation-phases.md) | Ordered, independently shippable phases with acceptance criteria. |
| [03-ui-behavior.md](03-ui-behavior.md) | Behavior specs for each UI surface, derived from the mockups. |

Interactive mockups of every surface live in [`mockups/`](../../mockups/) — open them in a
browser. They are the visual source of truth for this plan.

---

## The core idea

Everything SeedSigner-specific in this repo is either **naming** or **one data assumption**
(colors stored per piece). The three.js viewer, transform editor, owner gating and nostr
transport are already domain-agnostic.

So: **do not fork.** Generalize in place and make SeedSigner a *collection* — a filter plus
branding preset over the same codebase and the same deployment.

```
3D Colorator                     ← the app (all prints)
└── ?collection=seedsigner       ← "SeedSigner Designer" (its prints, its shop, its branding)
```

## Goals

1. **Generalize** "enclosure" → **print**; the app colors any multi-part 3D print.
2. **App-wide palette** of named, optionally translucent colors that pieces subset — replacing
   today's duplicated per-piece hex arrays.
3. **Preserve SeedSigner Designer** as a branded collection. Same code, same deploy, no fork.
4. **Share by link**, restricted to the shop's real colors, with honest reconciliation.
5. **Admin power tools**: duplicate an STL into independent instances; link pieces to share a color.
6. Keep it a **static site** — no build step, no backend, GitHub Pages as today.

## Non-goals (deliberately deferred)

- A live web UI for editing collections/palettes into the repo. The existing
  *edit in `?design` → download JSON → commit* loop stays.
- Paid custom off-palette colors. The data model and link grammar **reserve room** for it
  (see [01-data-model.md](01-data-model.md)), but no feature is built.
- Server-side short links or any backend.
- Curated per-collection print ordering, and `match: "all"` category intersection.

## Decisions log

Settled during design review. Each links to where it's specified.

| # | Decision | Why |
| --- | --- | --- |
| D1 | One codebase; SeedSigner is a collection preset | A fork doubles maintenance for a data-driven static app |
| D2 | Product name **3D Colorator**, tagline "Color any 3D print" | It's just the `name` of the `default` collection — cheap to change |
| D3 | Pieces reference colors by **palette id**, never raw hex | Names, opacity and "rename once, updates everywhere" all depend on it |
| D4 | **One global palette**; pieces store a subset | Matches the shop's real filament catalog |
| D5 | Absent/empty piece `palette` = **offer all** | Zero authoring effort for the common case |
| D6 | Share links carry **palette ids** | A link must never smuggle in a color the shop can't print |
| D7 | Unusable shared color → **dialog**; re-mixed color is undetectable | The link stores no snapshot, so there is nothing to diff |
| D8 | Submissions **do** embed a palette snapshot | A submission is an order record, not a live pointer |
| D9 | Linking is **color-only**; transforms stay per piece | Keeps groups a display/color concern |
| D10 | A duplicate is just another piece with the same `file` | No new schema; instances are derived |
| D11 | Feature flags resolve **global AND collection**, three-state | Global is a true kill-switch; collections inherit by default |
| D12 | `filter.categories` is an array, **any-match** | A storefront can span categories; a print can be in many |
| D13 | Manifest carries `{id, name, categories}`; prints load lazily | Today every enclosure JSON is fetched at startup — won't scale |
| D14 | Keep nsec in localStorage, with an **explicit inline warning** | Power-user convenience; the risk must be legible |

## Risks / things to watch

- **Translucent materials in three.js.** `transparent: true` with `opacity < 1` interacts badly
  with the shadow pass and with overlapping translucent parts (draw-order and `depthWrite`
  artifacts). A translucent piece will not look as clean as an opaque one. Handled in
  [03-ui-behavior.md](03-ui-behavior.md#opacity-rendering).
- **`js/app.js` is already 1137 lines** and this roughly doubles its responsibilities. Phase 1
  splits it into modules before the new features land, not after.
- **Breaking old share links / designs.** There are no published share links yet (the feature is
  new), but exported *design* JSON exists. Legacy import is kept — see
  [01-data-model.md](01-data-model.md#legacy-compatibility).

## Where to start

[Phase 0](02-implementation-phases.md#phase-0--preserve-the-current-app) — tag the current app,
branch, then Phase 1's rename + module split. Nothing else depends on decisions still open.
