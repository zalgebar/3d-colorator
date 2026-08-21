# 3D Colorator

A static web page for previewing multi-part 3D prints and coloring each piece from a shop-defined palette. No build step — it runs straight from GitHub Pages.

See some custom designs [here](custom-prints/themed-seedsigners.md).

**Designer** is this same app pointed at the SeedSigner prints: [`?collection=seedsigner`](#collections). Same code, same deployment, its own name and shop link.

## Run locally

```bash
python3 scripts/devserver.py 8130
```

Then open <http://localhost:8130>. A server is required — `file://` won't work, and the bundled dev server sends `Cache-Control: no-store` because browsers cache ES modules hard enough that an edited file under `js/` will otherwise keep running its previous version after a reload.

## The two modes

| | URL | Can |
| --- | --- | --- |
| **Visitor** | `/` | Pick a color per piece, share a link, export/import a design, submit an order |
| **Owner** | `/?design` | Everything above, plus edit the palette, each piece's color offering, links, duplication, and piece placement |

Owner mode is a URL parameter, not a login — it hides authoring controls from visitors, it does not secure anything. Nothing you do in the browser is saved automatically: you **download the JSON and commit it**.

## Data files

```
palette.json            the shop's filament catalog (app-wide)
collections.json        branding + feature flags per storefront
prints/manifest.json    index: id, name, categories — drives the sidebar
prints/<id>.json        one print: pieces, links, per-piece color offerings
stls/<print>/*.stl      geometry
```


### palette.json

One catalog for the whole app. Colors are objects with a stable **id**, and everything else — pieces, link groups, share links — references that id:

```jsonc
{
  "version": 1,
  "colors": [
    { "id": "orange", "name": "Orange", "hex": "#f75403", "opacity": 1 },
    { "id": "clear",  "name": "Translucent", "hex": "#c9c9c9", "opacity": 0.8 }
  ]
}
```

`opacity < 1` renders translucent, and you can see a piece's own interior ribs through it. Because references are by id, **renaming a color is always safe**. Changing an id is not: the app rewrites every reference in the catalog for you, but any share link already using the old id will ask its recipient to pick a replacement.

### prints/&lt;id&gt;.json

```jsonc
{
  "id": "my_case",
  "name": "My Case",
  "description": "Shown under the print picker.",
  "categories": ["accessories"],
  "axes": { "up": "z" },
  "links": [
    { "id": "shell", "label": "Shell", "members": ["top", "bottom"],
      "collapsed": true, "color": "orange" }
  ],
  "pieces": [
    {
      "id": "top",
      "label": "Top",
      "file": "stls/my_case/Top.stl",
      "position": [0, 0, 0],
      "rotation": [0, 0, 0],
      "scale": [1, 1, 1],
      "centerOrigin": true,
      "palette": ["orange", "black"],
      "defaultColor": "orange"
    }
  ]
}
```

- **`palette`** is optional. Omit it and the piece offers the whole catalog in catalog order; include it to restrict the piece to those colors, in that order.
- **`links`** are color-only groups: members always share one color, but keep their own placement and visibility. `collapsed: true` shows the group as a single item to visitors.
- **Duplicating an STL** is just another piece entry with the same `file`. There is no `instanceOf` — the app derives instances by grouping on the path, so several copies of one STL cost a single fetch.
- `axes.up: "z"` is the CAD/3D-printing convention the bundled STLs use; the app rotates them into the page's Y-up space, so the numbers you see and export are in that Y-up space.
- `centerOrigin: true` (the default) shifts a part so its visual center is its transform pivot. Set it to `false` for a part already exported in assembly coordinates.

## Adding a print

Point the scaffolder at a folder of STLs:

```bash
python3 scripts/newprint.py ~/Downloads/my_case --name "My Case"
```

It copies the STLs to `stls/my_case/`, writes `prints/my_case.json` with one piece per file, and adds the manifest entry. Add `--category seedsigner` to put it in a collection, `--default-color green` to pick the starting color, and `--dry-run` to see what it would do
first. Re-run with `--force` to regenerate — including after you add `thumbs/my_case.png`, which it picks up automatically.

The one thing it cannot read off the files is where the pieces go, so it measures them and says which case you are in:

- **Exported from one assembly** — the files already share a coordinate space, so it sets `centerOrigin: false` and the print assembles correctly straight away.
- **Exported part by part** — each file is centered on its own origin, so nothing says where the parts belong. It sets `centerOrigin: true` and warns you that everything is stacked at the origin. Open `/?design&print=my_case`, place the pieces with the gizmo, then **Download JSON** and save it over `prints/my_case.json`.

Either way, check it at `/?print=my_case`, then commit and push.

Doing it by hand is four steps: STLs under `stls/my_case/`, a `prints/my_case.json` matching the schema above, a `{ "id": "my_case", "name": "My Case", "categories": [...] }` entry in `prints/manifest.json`, and an optional `"thumbnail": "thumbs/my_case.png"` — without one the print gets a name-only tile in the picker.

The manifest is what the sidebar is built from, so a print's own file is only fetched when someone selects it.

## Collections

A collection is a filter plus a branding preset — one codebase, several storefronts.

```jsonc
{
  "global": {
    "submit": { "enabled": true, "recipient": "zalgebar", "shops": [ … ] },
    "customColors": { "enabled": false }
  },
  "collections": {
    "default":    { "name": "3D Colorator", "tagline": "Color any 3D print", "filter": null },
    "seedsigner": { "name": "SeedSigner", "tagline": "Enclosure Designer",
                    "filter": { "categories": ["seedsigner"] } }
  }
}
```

- Reach one with `?collection=<id>`. An unknown id falls back to `default`.
- `filter: null` lists every print; otherwise a print matches if it carries **any** of the listed categories.
- Flags resolve as **global AND collection**: a collection that says nothing inherits global, an explicit `false` opts out, and `global.submit.enabled: false` is a kill-switch nothing can override.
- Everything except `enabled` shallow-merges over global, so a collection can override just its `shops` while inheriting the recipient and relays.

## Sharing, orders and submissions

**Share link** — `?print=<id>&<piece>=<colorId>`, carrying palette ids rather than hex, so a link can only ever express colors you actually offer. Opening one resolves the ids against the catalog as it stands then; anything unusable opens a dialog offering replacements.

Once those colors are applied the app clears them out of the address bar, leaving `?print=<id>` — plus `?collection` and `?design` if they were there — and re-stamps `print` as you switch. The URL is read once at load and never again, so leaving the colors in it would mean the address bar kept describing the design you were *sent* long after you changed it, and that is the thing people copy. **Copy share link** builds a fresh link from what is on screen, which is the only version that can be right. The trade-off is that a reload no longer restores the colors from the link — reloading gives you the print as the shop authored it.

**Submit** sends the design as an encrypted NIP-17 direct message to the collection's recipient. Unlike a share link, a submission embeds a **snapshot** of the colors it used — it is the record of an order, so it stays meaningful even after you rename or re-mix the catalog.

**Importing an order** trusts that snapshot rather than the current catalog. In `?design` the order is shown exactly as it was placed, including colors that have since been retired or re-mixed; a visitor is offered replacements from what is currently available.

## Checking your work

```
/?selftest
```

Runs assertions over the pure logic — flag resolution, category matching, share encoding, reconciliation, id rules — and reports pass/fail to the browser console.

## Deploy to GitHub Pages

1. Push to a GitHub repository.
2. **Settings → Pages** → *Deploy from a branch* → `main` / `/` root.
3. Live at `https://<user>.github.io/<repo>/`.

## Design record

This app was rewritten from *SeedSigner Enclosure Designer*. The redesign plan — data model, phase-by-phase implementation notes, UI behavior specs and interactive mockups of every surface — is preserved in the git history under the `redesign-docs` tag, along with a commit per phase explaining what changed and why.

```bash
git show redesign-docs:docs/redesign/01-data-model.md
git log --oneline seedsigner-designer-v1.0..redesign-docs
```

## Disclosure

This project is an independent, community-built tool. It is **not affiliated with, endorsed by, or sponsored by** the SeedSigner project or its maintainers. "SeedSigner" and the SeedSigner name are trademarks of their respective owners, used here only to describe hardware this tool can be pointed at. The official SeedSigner project lives at <https://seedsigner.com/>.

## Support this project

Donate via lightning: `zalgebar@rizful.com`
