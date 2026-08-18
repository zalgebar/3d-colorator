# Implementation phases

Ordered so each phase is **independently shippable** — the app works and is deployable at the
end of every one. Later phases depend on earlier ones; the reverse is never true.

| Phase | Outcome | Risk |
| --- | --- | --- |
| [0](#phase-0--preserve-the-current-app) | Current app tagged and safe | none |
| [1](#phase-1--rename-restructure-lazy-load) | "Print" vocabulary, modules, lazy loading — *behavior unchanged* | low |
| [2](#phase-2--the-palette-model) | Global palette, id references, opacity | **highest** |
| [3](#phase-3--palette-editor--subset-ui) | Owner authoring + visitor swatch dropdowns | medium |
| [4](#phase-4--piece-linking) | Color-locked groups | medium |
| [5](#phase-5--stl-duplication) | Independent instances of one STL | low |
| [6](#phase-6--share-links--reconciliation) | Shareable colorings | medium |
| [7](#phase-7--collections--branding) | SeedSigner preserved as a collection; generic submit | medium |
| [8](#phase-8--cleanup--docs) | Docs, warnings, legacy paths | low |

Phases 2 and 3 are the heart of it. Everything after is additive.

---

## Phase 0 — preserve the current app

```bash
git tag -a seedsigner-designer-v1.0 -m "SeedSigner Enclosure Designer, pre-3D-Colorator"
git checkout -b print-designer
```

The tag is the restore point: the app exactly as it shipped, regardless of how far the rename
goes. Do this before touching a file.

**Done when:** `git show seedsigner-designer-v1.0` resolves and work happens on `print-designer`.

---

## Phase 1 — rename, restructure, lazy-load

Pure refactor. **No user-visible change** beyond wording — do it in one pass so later phases
land in a clean structure rather than fighting a 1137-line `app.js`.

### 1a. Vocabulary and files

| From | To |
| --- | --- |
| `enclosures/` | `prints/` |
| `enclosures/manifest.json` | `prints/manifest.json` (now `{id, name, categories}` entries) |
| `enclosure` in code/UI | `print` |
| `state.configs` / `setEnclosure()` | `state.prints` / `setPrint()` |

Write a throwaway migration script (`scripts/migrate-v1.mjs`, deleted after) that emits
`palette.json` and `prints/*.json` from the current files using the tables in
[01-data-model.md](01-data-model.md#migration-of-the-current-data). Commit the *output*, not
the script's ongoing use.

### 1b. Module split

`js/app.js` becomes bootstrap + wiring only:

```
js/
  app.js              bootstrap, wiring, keyboard shortcuts
  scene.js            renderer, lights, grid, axes, framing, screenshot
  editor.js           (unchanged) transform gizmo
  nostr.js            transport only — no SeedSigner strings
  data/
    palette.js        load/normalize/validate; id lookup; three.js color+opacity
    prints.js         manifest, print load/normalize, piece + link normalization, geometry cache
    collections.js    config load, flag resolution, branding, print filtering
  ui/
    paletteEditor.js  owner: global palette CRUD
    pieceList.js      piece rows: subset, linking, duplication, visitor dropdowns
    share.js          link encode/decode + reconciliation dialog
    submit.js         submit dialog
```

`js/config.js` folds into `data/prints.js`.

### 1c. Lazy loading

Build the sidebar from `prints/manifest.json` alone. Fetch `prints/<id>.json` and its STLs
only when a print is selected (D13). Cache parsed geometry by `file` path.

**Done when:** the app behaves identically to `seedsigner-designer-v1.0`, first paint issues
one manifest fetch, and no file mentions "enclosure" outside legacy-import code.

---

## Phase 2 — the palette model

The one-way door. Everything else depends on it.

1. `palette.json` + `data/palette.js`: load, validate, normalize; `byId()`; a
   `toMaterial(colorId)` that returns `{ color, transparent, opacity }`.
2. Pieces resolve `defaultColor` and `palette` as **ids**. Add the `Chosen` union
   (`string | {custom}`) now, even though `{custom}` is never produced yet.
3. Effective offering per piece: absent/empty `palette` → whole palette in palette order.
4. Repair on load: a `defaultColor` outside the offering falls back to the first offered color
   (warn in console, don't crash).
5. **Opacity rendering** — see [03-ui-behavior.md](03-ui-behavior.md#opacity-rendering) for the
   three.js specifics; get this right here rather than retrofitting.
6. Existing swatch UI keeps working, just driven by ids.

**Done when:** both migrated prints render identically to Phase 1, a color edited in
`palette.json` changes every piece using it, and a translucent color renders translucent.

---

## Phase 3 — palette editor & subset UI

Mockup: [`mockups/palette-mockup.html`](mockups/palette-mockup.html).
Spec: [03-ui-behavior.md](03-ui-behavior.md#palette-editor-owner).

1. **Palette editor** (owner, collapsible section): reorder, rename, hex picker + text field,
   integer `%` opacity field, add, delete-with-guard, live propagation.
2. **Per-piece subset editor** (owner): Offer all / Restrict toggle, chips with drag-reorder,
   `★` default, `+ add color ▾`, per-chip remove. Remove the old free `<input type="color">`
   and `+` from piece rows — colors are created only in the palette editor.
3. **Visitor swatch dropdown** replacing the swatch grid: swatch + name, checkerboard behind
   translucent colors.
4. Export: **Copy/Download `palette.json`** alongside the existing print JSON export.

**Done when:** a full catalog can be authored in-browser and downloaded as
`palette.json` + `prints/<id>.json` that reload cleanly.

---

## Phase 4 — piece linking

Mockup: [`mockups/linking-mockup.html`](mockups/linking-mockup.html).
Spec: [03-ui-behavior.md](03-ui-behavior.md#piece-linking).

1. `links[]` in the print schema; normalize + validate (≥2 members, no piece in two groups).
2. Owner: checkbox selection → **New group** (2+) / **Add to group ▾**; rename; Collapsed |
   Separate; per-member unlink; whole-group unlink; auto-dissolve below 2.
3. Visitor: collapsed → one item under the group name; separate → member rows, color-locked.
   Blank group label renders no name.
4. Setting a group's color writes through to every member.

**Done when:** a group survives a JSON export/import round trip and the visitor list matches
the mockup in both modes.

---

## Phase 5 — STL duplication

Mockup: [`mockups/duplication-mockup.html`](mockups/duplication-mockup.html).
Spec: [03-ui-behavior.md](03-ui-behavior.md#stl-duplication).

1. `⧉` duplicate once — new unique id, `"Label N"`, small transform offset, independent color.
2. **Duplicate & Link** dialog: integer count + "link all copies" checkbox. When checked,
   create the copies then form a link group (reuse Phase 4 — do not re-implement).
3. `⧉ n/N` instance badge derived by grouping pieces on `file`.
4. Delete an instance, **disabled when it is the only instance of its STL**.
5. Confirm the Phase 1 geometry cache: N instances = one fetch, one parse.

**Done when:** duplicating a piece 3× adds no network requests and each instance can be
transformed and colored independently.

---

## Phase 6 — share links & reconciliation

Mockup: [`mockups/sharing-mockup.html`](mockups/sharing-mockup.html).
Spec: [03-ui-behavior.md](03-ui-behavior.md#share--reconcile).

1. **Encode**: build the URL from the current coloring (`ui/share.js`); a **Copy link** button
   in the Share section.
2. **Decode on load**: parse params, resolve ids against the current catalog.
3. **Reconciliation dialog** per the table in
   [01-data-model.md](01-data-model.md#reconciliation-on-open-d7) — nearest pre-pick for
   unoffered, no pre-pick for unknown, Apply/Cancel.
4. Accept and ignore the reserved `~hex` form for now (treat as unknown) so a future link
   never hard-errors.

**Done when:** a link round-trips exactly; deleting a used color makes that link open with the
dialog; renaming a color changes nothing.

---

## Phase 7 — collections & branding

Mockup: [`mockups/collections-mockup.html`](mockups/collections-mockup.html).
Spec: [03-ui-behavior.md](03-ui-behavior.md#collections--branding).

1. `collections.json` + `data/collections.js`: load, resolve `?collection=`, **unknown id
   falls back to `default`**.
2. Branding: `<title>`, topbar brand + tagline, About section from the active collection.
3. Filter the print list by `filter.categories` (any-match).
4. **Genericize submit** (`ui/submit.js` + `nostr.js`):
   - `app: "3d-colorator"`, `type: "print-design"`, version 2, with the palette `snapshot`.
   - Subject line, `orderIdLabel`, `recipient` and `shops[]` from the resolved collection.
   - Two-level gate: hide the whole Share/submit section when `global && collection` is false.
   - Remove hardcoded SeedSigner strings from [`index.html`](../../index.html) and
     [`js/nostr.js`](../../js/nostr.js) (e.g. `"Order a SeedSigner here first!"`,
     `"SeedSigner enclosure design - order …"`).
5. localStorage key → `colorator.nsec`, reading `seedsigner.nsec` as a fallback and writing
   forward.
6. Verify `?collection=seedsigner` reproduces today's experience.

**Done when:** the bare URL is 3D Colorator with every print, `?collection=seedsigner` is
SeedSigner Designer, and the global submit switch hides submission everywhere.

---

## Phase 8 — cleanup & docs

1. Rewrite [`README.md`](../../README.md): new name, collections, palette, "adding a print",
   "adding a collection". Keep the SeedSigner trademark disclosure.
2. **nsec warning** inline beside the "Remember this key" checkbox
   ([03-ui-behavior.md](03-ui-behavior.md#nsec-storage-warning)).
3. Legacy `enclosure-design` import path + a test file to prove it.
4. Delete the migration script and any dead per-piece-hex code.
5. Decide the fate of `seedsigner-designer.md` (the original requirements scratch) — fold
   anything still open into this plan, then remove.

**Done when:** a newcomer can add a print and a collection using only the README.

---

## Testing without a framework

The repo has no test runner and shouldn't gain a build step. Practical coverage:

- **Round-trip check**: load → export → reload → deep-equal. Catches most normalization bugs.
- **A `?selftest` mode** running assertions over pure functions (flag resolution, category
  matching, link encode/decode, reconciliation classification, nearest-color) and printing
  pass/fail to the console. All of these are pure and easy to assert.
- **Manual matrix** per phase: owner ✕ visitor ✕ each collection ✕ a translucent color.
