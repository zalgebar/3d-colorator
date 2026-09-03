#!/usr/bin/env python3
"""Scaffold a print from a folder of STLs: writes prints/<id>.json and adds the
manifest entry.

Placement is the part this cannot guess, so it measures rather than assumes —
and then avoids having to choose. Every piece gets `centerOrigin: true`, which
makes the app centre the mesh on load so the transform handle always sits at the
middle of the part, and each mesh's authored offset is written into `position`
so a set exported from one assembly still lands assembled.

That is lossless and needs no branch. An earlier version picked between
`centerOrigin` true and false depending on how far apart the meshes sat, which
could not tell a shared coordinate space from one part being exported in the
wrong place, and got it wrong on exactly that case. Now the offsets are simply
carried, and the measurement only describes what it saw.

Nothing here rewrites an STL. Moving geometry inside the file is a repair for a
bad export, which is what scripts/recenter.py is for.

Usage:
    python3 scripts/newprint.py <stl-folder> [options]

    python3 scripts/newprint.py ~/Downloads/nostrich --name "8-Bit Nostrich"
    python3 scripts/newprint.py stls/8bit_nostrich --category seedsigner --dry-run
"""

import argparse
import json
import os
import re
import shutil
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "prints", "manifest.json")
PALETTE = os.path.join(ROOT, "palette.json")
PRINT_DIR = os.path.join(ROOT, "prints")
STL_DIR = os.path.join(ROOT, "stls")
THUMB_DIR = os.path.join(ROOT, "thumbs")

SLUG_RE = re.compile(r"^[a-z0-9_]+$")

# Data files are not programs. Whatever the source folder came with, the copies
# land at 644 like every other STL and thumbnail in the repo.
DATA_MODE = 0o644

# How far from the rest of the set a part has to sit before it is called out,
# as a multiple of half the largest part's diagonal. Real assembly offsets are
# a part-width or two; a part exported in the wrong place is usually an order of
# magnitude further, so anything in between is rare and the cut-off is not
# delicate.
OUTLIER_RATIO = 3.0


# ---------------------------------------------------------------- ids


def slugify(text, fallback="item"):
    """Mirrors slugify() in js/data/ids.js — ids have to agree across both."""
    base = re.sub(r"[^a-z0-9]+", "_", str(text or "").lower()).strip("_")
    return base or fallback


def unique_id(base, taken):
    if base not in taken:
        return base
    n = 2
    while "%s_%d" % (base, n) in taken:
        n += 1
    return "%s_%d" % (base, n)


def label_for(stem):
    """'Main_Chassis' -> 'Main Chassis'. Words already capitalised are left be,
    so 'PCB' does not become 'Pcb'."""
    words = [w for w in re.split(r"[\s_\-]+", stem) if w]
    return " ".join(w if w[:1].isupper() else w.capitalize() for w in words)


# ---------------------------------------------------------------- stl


def read_triangles(path):
    """Yields (x, y, z) vertices. Handles both binary and ASCII STL."""
    with open(path, "rb") as fh:
        data = fh.read()

    # A binary STL is exactly 84 + 50n bytes. Checking the length beats
    # sniffing for a leading 'solid', which binary exporters also emit.
    if len(data) >= 84:
        count = struct.unpack("<I", data[80:84])[0]
        if len(data) == 84 + 50 * count:
            off = 84
            for _ in range(count):
                for v in range(3):
                    p = off + 12 + v * 12
                    yield struct.unpack("<fff", data[p:p + 12])
                off += 50
            return

    for line in data.decode("utf-8", "replace").splitlines():
        parts = line.split()
        if len(parts) == 4 and parts[0] == "vertex":
            try:
                yield (float(parts[1]), float(parts[2]), float(parts[3]))
            except ValueError:
                pass


def bounds(path):
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    for vert in read_triangles(path):
        for i, c in enumerate(vert):
            lo[i] = min(lo[i], c)
            hi[i] = max(hi[i], c)
    if lo[0] == float("inf"):
        raise ValueError("no triangles found in %s" % os.path.basename(path))
    return lo, hi


def center_of(box):
    lo, hi = box
    return [(lo[i] + hi[i]) / 2 for i in range(3)]


def scene_offset(box, up):
    """Where a mesh's own centre ends up once the app has loaded it.

    GeometryCache rotates for the up axis *before* centring, so for `up: "z"` a
    rotateX(-90) maps (x, y, z) to (x, z, -y). Writing this into `position`
    puts a centred mesh back exactly where its file had it.
    """
    cx, cy, cz = center_of(box)
    return [cx, cz, -cy] if up == "z" else [cx, cy, cz]


def describe(boxes):
    """What the offsets look like, as a note rather than a decision."""
    if len(boxes) < 2:
        return "single piece"

    centers = [center_of(b) for b in boxes]
    spread = max(max(c[i] for c in centers) - min(c[i] for c in centers) for i in range(3))
    if spread < 1e-6:
        return "every mesh is centred on its own origin — pieces will overlap"
    return "meshes carry a shared coordinate space (centres span %.2f)" % spread


def outliers(names, boxes):
    """Parts sitting far from where the rest of the set sits.

    A misplaced export and a legitimate assembly offset look alike to the
    measurements, and carrying the offset preserves either faithfully — which is
    wrong when it was a mistake. Comparing against the *median* centre keeps one
    stray part from dragging the reference towards itself.
    """
    if len(boxes) < 3:
        return []

    centers = [center_of(b) for b in boxes]
    median = [sorted(c[i] for c in centers)[len(centers) // 2] for i in range(3)]
    # half the diagonal of the largest part: the scale at which "far" means something
    reference = max(
        sum((hi[i] - lo[i]) ** 2 for i in range(3)) ** 0.5 / 2 for lo, hi in boxes
    )
    if reference <= 0:
        return []

    out = []
    for name, c in zip(names, centers):
        dist = sum((c[i] - median[i]) ** 2 for i in range(3)) ** 0.5
        if dist > OUTLIER_RATIO * reference:
            out.append((name, dist))
    return out


# ---------------------------------------------------------------- io


def load_json(path):
    with open(path) as fh:
        return json.load(fh)


def write_json(path, obj, dry_run):
    text = json.dumps(obj, indent=2) + "\n"
    if dry_run:
        return
    with open(path, "w") as fh:
        fh.write(text)


def collect_stls(folder):
    names = [n for n in os.listdir(folder) if n.lower().endswith(".stl")]
    return sorted(names, key=str.lower)


# ---------------------------------------------------------------- main


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Scaffold a print from a folder of STLs.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("folder", help="folder of .stl files (copied into stls/<id>/ if elsewhere)")
    ap.add_argument("--id", help="print id (default: slug of the folder name)")
    ap.add_argument("--name", help="display name (default: derived from the folder name)")
    ap.add_argument("--description", default="", help="shown under the print name")
    ap.add_argument("--category", action="append", default=[], metavar="CAT",
                    help="collection category; repeat for more than one")
    ap.add_argument("--default-color", default=None, metavar="ID",
                    help="palette id every piece starts on (default: the first palette color)")
    ap.add_argument("--up", choices=["z", "y"], default="z", help="up axis of the STLs (default: z)")
    ap.add_argument("--force", action="store_true", help="overwrite an existing print of the same id")
    ap.add_argument("--dry-run", action="store_true", help="report what would happen, write nothing")
    args = ap.parse_args(argv)

    fail = lambda msg: sys.exit("error: " + msg)

    folder = os.path.abspath(os.path.expanduser(args.folder))
    if not os.path.isdir(folder):
        fail("%s is not a folder" % folder)

    stl_names = collect_stls(folder)
    if not stl_names:
        fail("no .stl files in %s" % folder)

    manifest = load_json(MANIFEST)
    entries = manifest.setdefault("prints", [])
    taken_prints = {e.get("id") for e in entries}

    # The name is the closer statement of intent when it is given, and it makes
    # the id match the display name the way the existing prints do.
    basis = args.id or args.name or os.path.basename(folder.rstrip(os.sep))
    print_id = args.id or slugify(basis, "print")
    if not SLUG_RE.match(print_id):
        fail("id '%s' must be lower-case letters, numbers and underscores only" % print_id)
    if print_id in taken_prints and not args.force:
        fail("print '%s' already exists — pass --force to overwrite it" % print_id)

    name = args.name or label_for(os.path.basename(folder.rstrip(os.sep)))

    # A space or an accent in a filename survives as %20 in the fetch, so it
    # works — but it is worth knowing about before it is committed.
    awkward = [n for n in stl_names if not re.match(r"^[A-Za-z0-9._-]+$", n)]

    palette = load_json(PALETTE)
    color_ids = [c["id"] for c in palette.get("colors", [])]
    default_color = args.default_color or (color_ids[0] if color_ids else None)
    if default_color not in color_ids:
        fail("default color '%s' is not in palette.json (have: %s)"
             % (default_color, ", ".join(color_ids)))

    # Measure before copying: a bad STL should stop the run before it has
    # written anything into the repo.
    boxes = []
    for stl_name in stl_names:
        try:
            boxes.append(bounds(os.path.join(folder, stl_name)))
        except (ValueError, struct.error) as exc:
            fail("could not read %s (%s)" % (stl_name, exc))

    note = describe(boxes)
    stray = outliers(stl_names, boxes)

    dest = os.path.join(STL_DIR, print_id)
    copying = os.path.normpath(dest) != os.path.normpath(folder)
    if copying and os.path.exists(dest) and not args.force:
        fail("%s already exists — pass --force to overwrite it"
             % os.path.relpath(dest, ROOT))

    if not args.dry_run:
        if copying:
            os.makedirs(dest, exist_ok=True)
            for stl_name in stl_names:
                shutil.copy2(os.path.join(folder, stl_name), os.path.join(dest, stl_name))
        for stl_name in stl_names:
            os.chmod(os.path.join(dest, stl_name), DATA_MODE)

    pieces = []
    taken_pieces = set()
    for stl_name, box in zip(stl_names, boxes):
        stem = os.path.splitext(stl_name)[0]
        piece_id = unique_id(slugify(stem, "piece"), taken_pieces)
        taken_pieces.add(piece_id)
        # Rounded because these are millimetres off a float32 mesh, and a
        # position of 20.874999046325684 in a hand-edited file helps nobody.
        offset = [round(v, 4) + 0.0 for v in scene_offset(box, args.up)]
        pieces.append({
            "id": piece_id,
            "label": label_for(stem),
            "file": "stls/%s/%s" % (print_id, stl_name),
            "position": offset,
            "rotation": [0, 0, 0],
            "scale": [1, 1, 1],
            "centerOrigin": True,
            "defaultColor": default_color,
        })

    print_doc = {
        "id": print_id,
        "name": name,
        "description": args.description,
        "categories": list(args.category),
        "axes": {"up": args.up},
        "camera": None,
        "links": [],
        "pieces": pieces,
    }

    print_path = os.path.join(PRINT_DIR, print_id + ".json")
    write_json(print_path, print_doc, args.dry_run)

    thumb_rel = "thumbs/%s.png" % print_id
    has_thumb = os.path.exists(os.path.join(THUMB_DIR, print_id + ".png"))
    entry = {"id": print_id, "name": name, "categories": list(args.category)}
    if has_thumb:
        entry["thumbnail"] = thumb_rel

    # Replace in place on --force so the picker order does not shuffle.
    for i, existing in enumerate(entries):
        if existing.get("id") == print_id:
            entries[i] = entry
            break
    else:
        entries.append(entry)
    write_json(MANIFEST, manifest, args.dry_run)

    # ---- report

    tag = "[dry run] " if args.dry_run else ""
    print("%s%s  (%s)" % (tag, print_id, name))
    print("  %-22s %s" % ("pieces", ", ".join(p["id"] for p in pieces)))
    print("  %-22s %s" % ("stls", os.path.relpath(dest, ROOT) + ("  (copied)" if copying else "  (in place)")))
    print("  %-22s %s" % ("default color", default_color))
    print("  %-22s %s" % ("categories", ", ".join(args.category) or "(none — default collection only)"))
    print("  %-22s %s" % ("offsets", note))
    print("  %-22s %s" % ("prints/…", os.path.relpath(print_path, ROOT)))
    print("  %-22s %s" % ("manifest", "entry %s" % ("replaced" if print_id in taken_prints else "added")))

    placed = [p for p in pieces if any(p["position"])]
    if placed:
        print("  %-22s %s" % ("positions", ", ".join(
            "%s %s" % (p["id"], p["position"]) for p in placed)))

    print()
    if len(pieces) > 1 and not placed:
        print("  next: the meshes are each centred on their own origin, so nothing in")
        print("        them says where the parts go and they will overlap. Open")
        print("        /?design&print=%s and place them, then Download JSON" % print_id)
        print("        over %s." % os.path.relpath(print_path, ROOT))
    else:
        print("  next: open /?print=%s and check it looks right." % print_id)
    if stray:
        print("  WARN: %s sits far from the rest of the set:" % (
            "a part" if len(stray) == 1 else "some parts"))
        for name, dist in stray:
            print("        %s, %.1f from where the others are" % (name, dist))
        print("        An offset that large is usually an export placed wrong rather")
        print("        than an assembly. scripts/recenter.py can move it.")
    if not has_thumb:
        print("  next: add %s for the picker tile — screenshot the" % thumb_rel)
        print("        print, then re-run with --force to pick it up.")
    if awkward:
        print("  note: these names need URL-encoding when fetched; rename them if you")
        print("        would rather keep the paths plain: %s" % ", ".join(awkward))

    return 0


if __name__ == "__main__":
    sys.exit(main())
