# SeedSigner Enclosure Designer

A static web page for previewing SeedSigner enclosure STL files in 3D and coloring each piece.
Hosted on GitHub Pages — no build step required.

## Run locally

```bash
python -m http.server 8123
# or: npx serve .
```

Then open http://localhost:8123 (a server is required — plain `file://` won't work due to browser CORS).

## Owner mode

Visitors only see the enclosure picker and per-piece color pickers. The transform gizmo,
Transform panel, and JSON export/import are hidden from them.

As the owner you unlock the editing UI with a URL parameter:

```
http://localhost:8123/index.html?design
```

Bookmark that URL (or the live Pages URL with `?design`) to always land in owner mode.
The pieces are already assembled in the config files, so the public page never asks a
visitor to figure out how the parts go together.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository.
2. Repo → **Settings → Pages** → set source to **Deploy from a branch** → select `main` / `/` root.
3. Your page is live at `https://<user>.github.io/<repo>/`.

## Adding a new enclosure

1. Put your STL files somewhere under `stls/`, e.g. `stls/my_case/Part_A.stl`.
2. Create a config file `enclosures/my_case.json` (see schema below).
3. Add the id to the list in `enclosures/manifest.json`.
4. Commit and push — the new enclosure appears in the sidebar automatically.

## Config schema

```jsonc
{
  "id": "my_case",                       // unique id; must match the filename + manifest entry
  "name": "My Case",                     // shown in the sidebar
  "description": "Optional text.",       // shown under the enclosure picker
  "axes": { "up": "z" },                 // STL convention: "z" = height is the Z axis (recommended)
  "pieces": [
    {
      "id": "part_a",                    // unique within the enclosure
      "label": "Part A",                 // shown in the piece list
      "file": "stls/my_case/Part_A.stl",
      "position": [0, 0, 0],             // in mm (after the axes.up="z" mapping is applied)
      "rotation": [0, 0, 0],             // radians, XYZ order
      "scale": [1, 1, 1],
      "centerOrigin": true,              // shift the part so its center is the transform pivot
      "defaultColor": "#4d4d4d"          // color the piece starts with
    }
  ]
}
```

`axes.up: "z"` is the CAD/3D-printing convention used by the bundled STLs. The app rotates
these into the page's Y-up space automatically, so all position/rotation values you see and
export are in that Y-up space.

### Why `centerOrigin`?

Your STL files are exported with arbitrary local origins (the mesh geometry is not centered
on the part itself). With `centerOrigin: true` (the default) the app shifts each part's
geometry so its visual center becomes the origin of that part. This makes the Move / Rotate /
Scale gizmo pivot around the middle of the part instead of a point floating outside it, and
means a position of `[0, 0, 0]` puts the part's center at the assembly origin.

Set `"centerOrigin": false` on a piece only if you want to place it by its raw STL origin
(e.g. a part whose file is already exported in assembly coordinates).

## Placing pieces (owner mode)

Because each STL is authored in its own local coordinates, you assemble an enclosure once
in Design mode and the saved placement becomes what every visitor sees:

1. Open the page with `?design` and toggle **Design mode** (top right).
2. Left-click a piece in the viewport to select it (or click its row in the sidebar).
3. Drag the **Move / Rotate / Scale** gizmo, or type exact values in the Transform panel.
   Keyboard: `G` move, `R` rotate, `S` scale, `F` frame view, `Esc` deselect. Right-drag to orbit.
4. **Copy JSON** (or **Download JSON**), then paste the result back into the enclosure's
   config file so the placement becomes the permanent default for everyone.

Colors are per piece and purely a preview choice — they don't need to be committed.
