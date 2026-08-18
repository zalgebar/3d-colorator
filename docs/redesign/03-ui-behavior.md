# UI behavior specs

Derived from the interactive mockups in [`mockups/`](mockups/) — open those for the
visual reference; this file records the rules behind them.

Two audiences throughout:

- **Owner** — `?design`, the admin authoring the catalog.
- **Visitor** — the public page: choose colors, share, submit. Never edits the catalog.

---

## Palette editor (owner)

Mockup: [`palette-mockup.html`](mockups/palette-mockup.html)

A **modal dialog** opened from a *Palette* launcher in the sidebar. App-wide, so it persists
across print switches. It lives in a dialog rather than the sidebar because the sidebar is
narrow enough that a one-line color row crushes the name field, and because piece rows need
that space for the controls arriving in later phases.

Each row: `⠿` drag handle · swatch · name field · hex field (+ picker) · opacity `%` field · `✕`.

| Behavior | Rule |
| --- | --- |
| Reorder | Drag `⠿`. Palette order is the order visitors see when a piece offers everything. |
| Rename | Inline; display-only. The `id` never changes. |
| Hex | Color picker **and** a 6-char text field, kept in sync. |
| Opacity | Integer `%` field (no slider). Clamp 0–100 on blur; live update while typing. |
| Add | Appends a color, id slugged from the name and deduped. Focus + select the name field. |
| Delete (unused) | Immediate. |
| Delete (in use) | **Guard dialog** naming the affected pieces. On confirm: remove from the palette *and* every piece subset; any piece defaulting to it falls back to its first remaining offered color; summarize what changed. |
| Live propagation | Editing hex/opacity updates every piece referencing that id, immediately. |
| id | An always-visible field. See *Slug ids* below. |

Export: **Copy JSON** / **Download JSON** for `palette.json`, matching the existing
print-export flow.

### Opacity rendering

`opacity < 1` maps to a three.js material of `{ transparent: true, opacity }`. Known issues to
handle in Phase 2 rather than retrofit:

- **Shadows**: a transparent material still casts a fully opaque shadow. Either scale
  `shadowOpacity` down or accept it — decide once, consistently.
- **Seeing a piece's own internals**: a translucent print shows its interior ribs, bosses and
  far wall, and the preview must too — that definition is most of why someone picks translucent
  filament. Two things are needed together: `depthWrite: false`, so a near surface cannot
  depth-reject the surfaces behind it, and rendering interior wall faces at all rather than
  back-face culling them — see the two-pass draw below. (An earlier draft preferred
  `depthWrite: true` for a lone translucent part to stop it "showing through itself" — that is
  exactly the wrong call here, and it flattened parts into featureless shells.)
- **Draw order**: alpha blending is order-dependent, so with `depthWrite: false` the picture
  depends entirely on what is painted first. Two orderings have to be pinned down:
  - *Within a piece*: draw a **back-face pass then a front-face pass** (two meshes sharing one
    geometry, the back one a child so it inherits the transform). This puts a shell's far wall
    under its near wall, which arbitrary triangle order does not.
  - *Between pieces*: **paint in authored piece order**, via `renderOrder`, not by camera
    distance. three.js sorts transparent objects by centroid distance, which flips as you orbit
    nested pieces and makes the whole model visibly snap to a different apparent opacity at the
    crossover angle. A fixed order is an approximation — a piece may composite over one that is
    physically nearer — but a stable picture beats a correct-then-suddenly-different one. To
    tune which piece reads as "on top", reorder `pieces` in the print file.

  Fully correct per-pixel translucency needs order-independent transparency (depth peeling or
  weighted-blended OIT). That is a custom-shader/render-target project and is deliberately not
  attempted here.
- **Swatches**: draw translucent colors over a **checkerboard** in every UI surface (palette
  rows, chips, dropdowns) so translucency is legible at a glance.

---

## Piece subset editor (owner)

Curates *which* palette colors a piece offers. Colors are **created only in the palette
editor** — the old free color input and `+` button on piece rows are removed.

Lives in a **per-piece dialog**, opened from a launcher on the piece row that shows the piece's
current color and how many colors it offers. Piece rows accumulate controls as linking and
duplication land, so the color offering gets its own surface rather than competing for sidebar
width.

The offering is a **vertical list of full-width rows**, one per offered color — the same shape
the visitor sees in the dropdown. Rows are used rather than inline chips because chip width
tracks the color's name, so a chip layout reflows as it is reordered and changes size between
the two modes; a uniform row list keeps the dialog a fixed size while dragging.

Each row: `⠿` drag handle · swatch · name · `%` (translucent only) · `★` · `✕`.

**Offering: `Offer all` | `Restrict`**

- **Offer all** (default for a new piece) — every palette color, in palette order. Stored as
  *no* `palette` key. Rows carry **no drag handle and no remove button**: there is nothing to
  curate, and the order is the palette's.
- **Restrict** — an explicit, ordered subset.

| Behavior | Rule |
| --- | --- |
| Set default | Click the row. `★` marks it; that color is what the viewport shows and what exports as `defaultColor`. |
| Reorder | Drag `⠿`, **Restrict only**. This is the order visitors see. |
| Remove | `✕`, **Restrict only** — removes from this piece, never from the palette. |
| Add one | "+ Add a color" opens a menu of palette colors not yet offered. The future paid **Custom color…** entry lives at the bottom of it. |
| Add the rest | "Add remaining (N)" appends every color the piece does not offer yet, **staying in Restrict** and keeping the curated order in front. Distinct from the *Offer all* tab, which discards the explicit list. |
| Minimum | Cannot remove the last remaining color. |

**Save / Cancel.** Edits apply live so the viewport previews them, so the dialog snapshots the
piece's offering, default and current color on open. **Save** keeps them; **Cancel** and
**Escape** restore the snapshot. Switching tabs stashes the curated subset rather than
discarding it, so *Restrict → Offer all → Restrict* returns the same list.

Note the dismissal paths are wired explicitly rather than through the dialog's `close` event —
that event does not fire reliably in every target environment, so relying on it silently lost
the revert.

The action area is rendered in both modes — the two buttons under *Restrict*, an explanatory
hint under *Offer all* — so switching tabs does not resize the dialog. Rows also reserve the
remove-button slot when it is not shown, keeping row height identical across modes.

Editor dialogs are **top-anchored**, not vertically centred, and the offered-colors list keeps a
floor height. Removing colors still shrinks the dialog, but only downward — so repeatedly
clicking `✕` does not walk the button out from under the pointer.

Popup menus (the add-color list, and the visitor's dropdown) are **fixed-positioned and
parented to the open dialog**. Absolute positioning let a scrolling ancestor — the sidebar, or
the offered-colors list — clip them. Fixed positioning is laid out against the viewport so
`overflow` cannot clip it, and parenting to the `<dialog>` keeps the menu clickable, since a
modal dialog makes the rest of the document inert.

Reordering is deliberately absent from *Offer all*: "offer everything in a custom order" can
only be stored as an explicit list, which is precisely what *Restrict* is. An earlier build let
a drag silently switch the mode, which read as the UI changing a setting the user had not
touched. Switch to *Restrict* to order colors.

---

## Slug ids

Colors, link groups and pieces are referenced by a slug **id** — by piece subsets, by group
colors, and by share links. Ids are lower-case letters, numbers and underscores, unique within
their kind, and shown as an **always-visible field** in the palette editor and the group header.

| Rule | Behavior |
| --- | --- |
| Created | Slugged from the name, deduped (`smoke`, `smoke_2`). |
| Renaming the name | **Never** moves an existing id — that is what makes renaming a filament safe. |
| New group, still unnamed | Its id tracks the name as you type, so naming a group gives it a readable id instead of a placeholder. |
| Fixed | Editing the id by hand, or loading one from a file, fixes it — it stops tracking the name. Carried in memory as `idFixed`, stripped on export. |
| Editing an id | Validated for charset and uniqueness, then **every reference is rewritten together**: piece subsets, piece defaults, group colors and live records. |
| Cost | Changing an id breaks any share link already using it — the link reconciles to the piece default instead. The toast says so. |

Why not auto-derive ids from names continuously: renaming would then silently break links, which
is exactly what referencing by id exists to prevent.

## Viewport navigation

Identical in both modes: **left-drag orbits, right-drag pans, wheel/middle dollies.** Design
mode does not remap the mouse. The transform gizmo takes precedence when the pointer goes down
on one of its handles, because `TransformControls` disables the orbit controls for the duration
of a handle drag — three.js's own recommended pairing.

## Sidebar

Resizable by dragging its right edge (minimum 260px, maximum 60% of the window), double-click
to reset. The width persists in `localStorage`. It is applied as a CSS custom property, so the
viewport's `ResizeObserver` picks the change up without an explicit relayout.

## Visitor color control

A **swatch dropdown**, not a grid (a native `<select>` can't show swatches):

- Closed: swatch + color name + caret.
- Open: the piece's offered colors in offering order, swatch + name, check on current.
- Translucent entries drawn over a checkerboard.

---

## Piece linking

Mockup: [`linking-mockup.html`](mockups/linking-mockup.html)

Linked pieces **always share one color**. Transforms and visibility stay per piece.

### Uniform piece row

Every piece — standalone or linked — uses the same two-line row:

```
[checkbox]  Piece Name                    [unlink] [👁]
[ color control                         ▾ ]
```

The second line is the visitor's swatch dropdown, or the owner's colors launcher. The unlink
button appears only on linked pieces, and the checkbox only for the owner. There is **no
per-row group-name badge** — the group name lives on the group header only.

A group's color is limited to the colors **every member offers** (the intersection of their
subsets), since the group can only show a color all its pieces can be. If the subsets have
nothing in common the first member's offering is used and a warning is logged.

### Owner controls

| Action | Behavior |
| --- | --- |
| Select + **New group** | Enabled at 2+ selected. New group starts **unnamed**, Collapsed, taking the first piece's color. |
| Select + **Add to group ▾** | Adds just the ticked pieces to an existing group — no need to re-tick current members. Pieces are pulled out of any other group; a group left under 2 members dissolves. |
| Rename | Inline in the group header; placeholder "Name this group". |
| **Collapsed \| Separate** | How the group appears to visitors. |
| Per-member unlink | Frees one piece, keeping the group intact (dissolves if it would drop below 2). Freed piece keeps the group's current color. |
| **Unlink** (header) | Dissolves the group; all members keep the group's color. |

In Collapsed mode the owner sees an "All parts" summary row plus an expander for per-part
visibility and transform.

### Visitor view

| Mode | Rendering |
| --- | --- |
| Collapsed | Group name on **its own header line** (chain glyph + name + *(N parts)*), then a single shared color dropdown. |
| Separate | Same header line, then each member as its own row; changing any one changes all. |

**A blank group label renders no name** — just the chain glyph and part count. Never
substitute a placeholder like "Untitled group".

---

## STL duplication

Mockup: [`duplication-mockup.html`](mockups/duplication-mockup.html)

Duplication is a primary authoring action, so it sits **on the piece row**, not behind a menu.

| Control | Where | Behavior |
| --- | --- | --- |
| `⧉ n/N` badge | row | Derived by grouping pieces on `file`. Shown only when N > 1. |
| **Duplicate** `⧉` | row | One copy — new id, `"Label N"`, stepped along X by the STL's own width, fully independent. Copies do **not** inherit the original's link group. |
| **Duplicate several** (layers) | row → dialog | Integer count (1–24) + "Link all copies (and the original) so they always share one color" (default on). When checked it forms a real link group by reusing the Phase 4 mechanism. |
| **Remove** (trash) | row | **Disabled when it is the only instance of that STL**, with a tooltip pointing at the print/repo instead. |
| `⋯` | row → dialog | The occasional things only: the piece's **Name**, its editable slug **id**, and the STL filename with its full path. Renaming the id rewrites link membership and the live record. |

A duplicate's label is generated (`"Thumbstick 2"`), so its **id is left unfixed and tracks the
label**: renaming the copy to "Left Thumbstick" also moves its id to `left_thumbstick`. Editing
the id by hand fixes it, and a piece loaded from a file is fixed on arrival — the same
`idFixed` rule groups use.

The offset steps from how many instances already exist, not from a loop counter, so duplicating
one at a time marches copies along rather than restacking them at the same spot.

A piece row can now carry selection, an instance badge, four actions, unlink and visibility.
The trailing controls are one flex group so a narrow sidebar drops the whole cluster to a second
line rather than stranding a single button, and the label ellipsises instead of wrapping.

The offset steps from how many instances already exist, not from a loop counter, so duplicating
one at a time marches copies along rather than restacking them at the same spot.

When "link" is checked the copies plus the original form a normal link group — the same
mechanism as [Piece linking](#piece-linking), not a parallel one.

---

## Share & reconcile

Mockup: [`sharing-mockup.html`](mockups/sharing-mockup.html)
Grammar + classification table: [01-data-model.md](01-data-model.md#share-links-d6-d7)

### Composing

A **Copy link** button in the Share section builds the URL from the current coloring. Because
values are palette ids, the link is short and can only ever express colors the shop offers.

### Opening

Classify every param, then:

- **All fine** → apply silently. No banner, no dialog. (A renamed or re-mixed color is
  indistinguishable from an unchanged one — see D7 — so there is nothing to announce.)
- **Any unusable** → **modal dialog** listing each affected piece:

| Case | Dialog row |
| --- | --- |
| Not offered for this piece | Shows the shared color's swatch + name, reason, and a dropdown **pre-picked to the nearest offered color**. |
| Not in the catalog | Shows the raw id as text (**no swatch** — we can't draw a color we no longer know), reason "we can't match a color to it, so choose one", dropdown starting at the piece default. |

Dropdowns list that piece's **currently offered** colors — for a piece inside a link group that
means the group's intersection, since setting one member sets them all. **Apply** commits;
**Cancel** applies nothing.

Copy rule: never claim to know what an unknown id looked like.

Opening a link never marks the session dirty: a link describes a coloring to look at, not an
edit to save. A `~rrggbb` custom request parses but classifies as *unknown* until the paid
feature ships, so a future link degrades into a choice rather than a hard error.

---

## Collections & branding

Mockup: [`collections-mockup.html`](mockups/collections-mockup.html)
Schema: [01-data-model.md](01-data-model.md#collectionsjson)

The active collection drives:

| Surface | Source |
| --- | --- |
| `<title>`, topbar brand + tagline | `name`, `tagline` |
| Which prints appear | `filter.categories` (any-match); `null` = all |
| Submit section visible? | `global.submit.enabled && collection` (three-state) |
| Order field label, recipient, shop links | merged `submit` config |
| Custom color entry | `global.customColors.enabled && collection` |

Rules:

- **Unknown `?collection=` → fall back to `default`.** Never an empty app.
- When submit is hidden, say **which level** hid it — a global kill-switch and a collection
  opt-out are different situations and the owner needs to tell them apart.
- `shops[]` is a list, so a collection can point at Etsy *and* a direct shop.

---

## nsec storage warning

Keep the "Remember this key in this browser" checkbox, but put the risk at the point of
decision — inline beside the checkbox, not in a footnote:

> ⚠ Your secret key will be stored unencrypted in this browser. Only do this on a device you
> control. Not sure what an nsec is? Leave this unchecked.

Rationale: it's a genuine power-user convenience, and the people who shouldn't use it are
exactly the ones who won't recognize the term.
