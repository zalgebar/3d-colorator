# Data model

Every file format in 3D Colorator, plus how today's data migrates into it.

```
palette.json                 ← the shop's filament catalog (app-wide)
collections.json             ← branding + feature flags per storefront
prints/manifest.json         ← index: id, name, categories (drives the sidebar)
prints/<id>.json             ← one print: pieces, links, per-piece color offerings
stls/<print>/<Part>.stl      ← geometry (unchanged)
```

---

## palette.json

The single app-wide catalog. **Colors are objects with a stable `id`** — that id is what
pieces and share links reference, so renaming a color never breaks anything.

```jsonc
{
  "version": 1,
  "colors": [
    { "id": "ss_orange", "name": "SeedSigner Orange", "hex": "#f75403", "opacity": 1 },
    { "id": "purple",    "name": "Purple",            "hex": "#9a57bd", "opacity": 1 },
    { "id": "smoke",     "name": "Smoke",             "hex": "#202020", "opacity": 0.45 }
  ]
}
```

| Field | Rules |
| --- | --- |
| `id` | `^[a-z0-9_]+$`, unique. Slugged from the first name, deduped with `_2`, `_3`… Editable in `?design`, which rewrites every reference at once — but any share link already using the old id will reconcile to a default. |
| `name` | Free text, display only. Editing it is always safe. |
| `hex` | `^#[0-9a-f]{6}$` (lowercase on write, accept any case on read). |
| `opacity` | `0`–`1`, default `1`. Values `< 1` render translucent. |

**Order matters** — it is the order visitors see when a piece offers the whole palette (D5).

Editing a color's `hex`/`opacity` propagates live to every piece referencing that id. That is
intended: the catalog is the source of truth.

---

## collections.json

Branding and feature flags. `global` holds the **defaults every collection inherits**; a
collection overrides only what differs.

```jsonc
{
  "version": 1,

  "global": {
    "submit": {
      "enabled": true,
      "channel": "nostr",
      "recipient": "zalgebar",
      "orderIdLabel": "Order ID",
      "shops": [ { "label": "Browse the shop", "url": "https://zalgebar.com/shop" } ]
    },
    "customColors": { "enabled": false }
  },

  "collections": {
    "default": {
      "name": "3D Colorator",
      "tagline": "Color any 3D print",
      "filter": null
    },
    "seedsigner": {
      "name": "SeedSigner Designer",
      "tagline": "Enclosure coloring",
      "filter": { "categories": ["seedsigner"] },
      "submit": { "shops": [ { "label": "Order a SeedSigner", "url": "https://zalgebar.com/shop" } ] },
      "customColors": { "enabled": false }
    },
    "shop": {
      "name": "Zalgebar Shop",
      "filter": { "categories": ["seedsigner", "accessories"] },
      "submit": { "orderIdLabel": "Etsy order #", "shops": [ /* … */ ] }
    }
  }
}
```

### Flag resolution (D11)

Three states, resolved as **global AND collection**:

| Collection says | Meaning |
| --- | --- |
| key omitted | **inherit** global |
| `"enabled": false` | opt out, even when global is on |
| `"enabled": true` | on — but still requires global on |

```js
const own     = o => (o && o.enabled !== undefined) ? o.enabled : undefined;
const enabled = (g, c) => g && (own(c) === undefined ? true : own(c));
```

Non-`enabled` keys **shallow-merge** over global, so a collection can override just `shops`
while inheriting `recipient` and `channel`.

### Filtering (D12)

`filter: null` means every print. Otherwise a print matches if it carries **any** of the
listed categories (union). Both sides are arrays, so one print can appear in several
collections.

```js
const matches = (print, coll) =>
  !coll.filter || coll.filter.categories.some(c => print.categories.includes(c));
```

**Unknown `?collection=` id falls back to `default`** — never render an empty app.

---

## prints/manifest.json

The index the sidebar is built from. Carries only what listing and filtering need, so the app
does **not** fetch every print file at startup (D13 — today [`app.js`](../../js/app.js) fetches
all of them before first paint).

```jsonc
{
  "version": "2.0.0",
  "prints": [
    { "id": "open_pill_mini_w_coverplate", "name": "Open Pill Mini w/ Coverplate", "categories": ["seedsigner"] },
    { "id": "open_pill_mini",              "name": "Open Pill Mini",               "categories": ["seedsigner"] }
  ]
}
```

`categories` here is a denormalization — each print's own file declares them as source of
truth. Keep them in sync when editing a print (the export writes both).

---

## prints/&lt;id&gt;.json

One print. Replaces `enclosures/<id>.json`.

```jsonc
{
  "id": "open_pill_mini_w_coverplate",
  "name": "Open Pill Mini w/ Coverplate",
  "description": "Multi-piece enclosure with buttons, lid coverplate and thumbstick.",
  "categories": ["seedsigner"],
  "axes": { "up": "z" },
  "camera": null,

  "links": [
    { "id": "shell", "label": "Shell", "members": ["main_chassis", "lid"],
      "collapsed": true, "color": "ss_orange" }
  ],

  "pieces": [
    {
      "id": "main_chassis",
      "label": "Main Chassis",
      "file": "stls/open_pill_mini_w_coverplate/Main_Chassis.stl",
      "position": [0, 0, 0],
      "rotation": [-1.5707963267948966, 0, -1.5707963267948966],
      "scale": [1, 1, 1],
      "centerOrigin": true,
      "defaultColor": "ss_orange"
    },
    {
      "id": "buttons",
      "label": "Buttons",
      "file": "stls/open_pill_mini_w_coverplate/Buttons.stl",
      "position": [11.5, 0.58, 26.57],
      "rotation": [0, -1.5707963267948966, 0],
      "scale": [1, 1, 1],
      "palette": ["white", "black", "ss_orange"],
      "defaultColor": "white"
    }
  ]
}
```

### What changed from the enclosure format

| Was | Now |
| --- | --- |
| `defaultColor: "#f75403"` | `defaultColor: "ss_orange"` — a palette **id** (D3) |
| `colors: ["#f75403", …]` (hex array, duplicated on every piece) | `palette: ["white", …]` — **ids**, and **optional** |
| — | `categories`, `links` added |

### Piece color offering (D5)

| `palette` field | Behavior |
| --- | --- |
| absent, or `[]` | **Offer all** — the whole palette, in palette order |
| `["white", "black"]` | **Restrict** — exactly these, in this order |

A restricted list must contain at least one id. `defaultColor` must be a member of the
effective offering; the loader repairs it to the first offered color if not.

### Links (D9)

Color-only groups. Members keep their own transform and visibility.

| Field | Meaning |
| --- | --- |
| `id` | unique within the print |
| `label` | display name; **blank shows no name at all** |
| `members` | ≥ 2 piece ids; a group that drops below 2 dissolves |
| `collapsed` | `true` = one item in the visitor's list; `false` = separate rows, color-locked |
| `color` | the shared palette id — wins over each member's `defaultColor` |

A piece may belong to **at most one** link group.

### Duplicated STLs (D10)

There is no `instanceOf` field. A duplicate is simply another piece entry with the same
`file`. Instances are derived at load time by grouping on `file`, which is what drives the
`⧉ n/N` badge. Consequences:

- Each instance has its own `id`, `label`, transform, offering and color.
- **The last remaining instance of an STL cannot be deleted** in the UI — if a print doesn't
  need a part, remove the STL from the print/repo instead.
- The loader must **cache parsed geometry by `file`** so N instances cost one fetch and one
  parse.

---

## Share links (D6, D7)

```
https://<host>/color?collection=<collectionId>&print=<printId>&<pieceId>=<colorId>[&…]
```

Example:

```
?collection=seedsigner&print=open_pill_mini_w_coverplate&main_chassis=ss_orange&lid=smoke
```

- Values are **palette ids**, never hex. Names and opacity travel for free because they live
  on the color object.
- For a **collapsed link group**, the key is the group id; for a separate group, write each
  member (they resolve to the same color anyway).
- `collection` and `print` are optional; missing → default collection / first print.

### Reserved for the future (not implemented)

A leading `~` marks an off-palette custom request: `main_chassis=~ff00ff`. The grammar is
reserved now so adding the paid feature later is non-breaking. Represent a chosen color as a
small union from day one:

```js
type Chosen = string | { custom: "#rrggbb" };   // palette id, or an off-palette request
```

### Reconciliation on open (D7)

Only the recipient's **current** catalog is knowable — the link stores no snapshot.

| At open time, the id… | Detected? | Behavior |
| --- | --- | --- |
| resolves **and** is offered for that piece | — | Apply silently, with whatever name/hex/opacity it has now |
| resolves but is **not offered** for that piece | ✅ | **Dialog**, with the nearest offered color pre-picked (we know its hex) |
| is **not in the catalog** | ✅ | **Dialog**, with **no** auto-pick — nothing to match on, so the user chooses |
| same id, **re-mixed** hex/opacity | ❌ | Undetectable, applies under its id. Intended: the catalog is the source of truth |

Nearest-match is plain RGB euclidean distance over the piece's currently offered colors.
The dialog is modal, lists every affected piece, and offers **Apply** / **Cancel**
(cancel applies nothing).

---

## Submission payload

Sent as the NIP-17 DM body. **Unlike a share link, a submission embeds a palette snapshot**
(D8) — it is the record of an order, so it must stay meaningful even after the catalog moves.

```jsonc
{
  "app": "3d-colorator",
  "type": "print-design",
  "version": 2,
  "orderId": "abc123",
  "collection": "seedsigner",
  "print": "open_pill_mini_w_coverplate",
  "printName": "Open Pill Mini w/ Coverplate",
  "author": "<pubkey>",
  "colors": { "main_chassis": "ss_orange", "lid": "smoke" },
  "snapshot": {
    "ss_orange": { "name": "SeedSigner Orange", "hex": "#f75403", "opacity": 1 },
    "smoke":     { "name": "Smoke",             "hex": "#202020", "opacity": 0.45 }
  }
}
```

`snapshot` contains only the colors actually used. When custom colors ship, an entry may be
`{ "custom": "#ff00ff" }` and should be flagged as billable in the dialog summary.

---

## Legacy compatibility

| Legacy | Handling |
| --- | --- |
| `type: "enclosure-design"` v1 design files (hex per piece) | **Still importable.** Map each hex to the nearest palette color by exact match first, then RGB distance; report anything remapped. |
| `enclosures/` directory + old manifest | Migrated by the Phase 1 script; directory removed after. |
| localStorage key `seedsigner.nsec` | Read as a fallback, then write forward to `colorator.nsec`. Never silently drop a user's saved key. |

---

## Migration of the current data

Today every piece in both enclosure files carries the **same 11 hex values**, so all pieces
become "offer all" — no `palette` key at all.

**Hex → palette id map** (derives the initial `palette.json`):

| Hex | id | name |
| --- | --- | --- |
| `#f75403` | `ss_orange` | SeedSigner Orange |
| `#9a57bd` | `purple` | Purple |
| `#eb3a3a` | `red` | Red |
| `#ffd00b` | `yellow` | Yellow |
| `#00ae42` | `green` | Green |
| `#002e96` | `blue` | Blue |
| `#000000` | `black` | Matte Black |
| `#adb1b2` | `grey` | Grey |
| `#ffffff` | `white` | White |
| `#f55a74` | `pink` | Pink |
| `#6f5034` | `brown` | Brown |

Per-piece `defaultColor` conversions:

| Piece | Was | Becomes |
| --- | --- | --- |
| `main_chassis`, `lid` | `#f75403` | `ss_orange` |
| `buttons`, `thumbstick` | `#ffffff` | `white` |

Both prints get `"categories": ["seedsigner"]`. Neither gets `links`. Transforms, `axes`,
`centerOrigin` and STL paths are copied through unchanged.
