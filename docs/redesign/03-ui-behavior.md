# UI behavior specs

Derived from the interactive mockups in [`mockups/`](mockups/) — open those for the
visual reference; this file records the rules behind them.

Two audiences throughout:

- **Owner** — `?design`, the admin authoring the catalog.
- **Visitor** — the public page: choose colors, share, submit. Never edits the catalog.

---

## Palette editor (owner)

Mockup: [`palette-mockup.html`](mockups/palette-mockup.html)

A collapsible sidebar section above Pieces. App-wide, so it persists across print switches.

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
| id visibility | Shown subtly (mono, on hover) — it is what share links contain. |

Export: **Copy JSON** / **Download JSON** for `palette.json`, matching the existing
print-export flow.

### Opacity rendering

`opacity < 1` maps to a three.js material of `{ transparent: true, opacity }`. Known issues to
handle in Phase 2 rather than retrofit:

- **Shadows**: a transparent material still casts a fully opaque shadow. Either scale
  `shadowOpacity` down or accept it — decide once, consistently.
- **Overlapping translucent parts**: back-to-front sort issues. Setting `depthWrite: false` on
  translucent materials fixes stacking but can let a part show through itself. Trade-off:
  prefer `depthWrite: true` for single translucent parts; only disable if two translucent
  pieces overlap in practice.
- **Swatches**: draw translucent colors over a **checkerboard** in every UI surface (palette
  rows, chips, dropdowns) so translucency is legible at a glance.

---

## Piece subset editor (owner)

Curates *which* palette colors a piece offers. Colors are **created only in the palette
editor** — the old free color input and `+` button on piece rows are removed.

**Offering: `Offer all` | `Restrict`**

- **Offer all** (default for a new piece) — label reads
  **"Offer All — no colors selected"**, chips render dashed/implicit showing the whole palette.
  Stored as *no* `palette` key.
- **Restrict** — explicit ordered chips.

| Behavior | Rule |
| --- | --- |
| Chip | swatch + name. `★`/`☆` sets the piece default; `✕` removes from this piece only. |
| Reorder | Drag chips. This is the order visitors see. |
| Drag while "Offer all" | **Promotes to Restrict** with the dragged order — implicit order is palette order until you override it. |
| Add | `+ add color ▾` menu of palette colors not yet offered. The future paid **Custom color…** entry lives at the bottom of this menu. |
| Minimum | Cannot remove the last chip in Restrict mode. |
| Reset | "↺ Offer all instead" returns to the unrestricted state. |

---

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
[ full-width color dropdown             ▾ ]
```

The unlink button appears only on linked pieces. There is **no per-row group-name badge** — the
group name lives on the group header only.

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

| Control | Behavior |
| --- | --- |
| `⧉` | Duplicate once — new id, `"Label N"`, offset transform, fully independent. |
| Layers icon | **Duplicate & Link** dialog: integer count (1–24) + "Link all copies (and the original) so they always share one color" (default on). |
| `⧉ n/N` badge | Derived by grouping pieces on `file`. Shown only when N > 1. |
| STL chip | Mono filename, full path on hover — makes the shared source obvious. |
| Trash | Removes an instance. **Disabled when it is the only instance of that STL**, with a tooltip pointing at the print/repo instead. |

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

Dropdowns list that piece's **currently offered** colors. **Apply** commits; **Cancel** applies
nothing.

Copy rule: never claim to know what an unknown id looked like.

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
