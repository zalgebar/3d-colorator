#!/usr/bin/env python3
"""Move an STL's geometry so its origin sits where you want it.

CAD exports a part wherever it happened to be in the sketch or on the build
plate, which is why a set of parts that belong together can arrive with one of
them hundreds of millimetres away. That does not matter for a print with
`centerOrigin: true` — the app centres each mesh on load — but it matters a lot
for a set exported in shared assembly coordinates, where `centerOrigin` is false
precisely so the authored positions are honoured. There the stray part really is
where the file says it is.

Which axes to move is the whole question, and it is not one the file can answer:

  --axes xyz   origin at the middle of the bounding box. What "centre the STL"
               usually means, and wrong for a part that sits on a plate — it
               drops half the object below z=0.
  --axes xy    centre horizontally, leave the height alone. What you want for a
               part whose Z is already right relative to the rest of the set.
  --floor      after moving, rest the object's lowest point on z=0.
  --match      take the target from another part, so a stray piece lands
               concentric with the ones that are already correct.

Usage:
    python3 scripts/recenter.py <file.stl> [more.stl ...] [options]

    # what would change, without writing
    python3 scripts/recenter.py stls/foo/part.stl --dry-run

    # put a stray part back on top of the ones that are already right
    python3 scripts/recenter.py stls/foo/lid.stl --axes xy --match stls/foo/box.stl
"""

import argparse
import os
import re
import struct
import sys

AXES = "xyz"


# ---------------------------------------------------------------- read


def is_binary(data):
    """A binary STL is exactly 84 + 50n bytes. Checking the length beats
    sniffing for a leading 'solid', which binary exporters also emit."""
    if len(data) < 84:
        return False
    count = struct.unpack("<I", data[80:84])[0]
    return len(data) == 84 + 50 * count


def bounds_of(data):
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3

    def note(x, y, z):
        for i, c in enumerate((x, y, z)):
            lo[i] = min(lo[i], c)
            hi[i] = max(hi[i], c)

    if is_binary(data):
        count = struct.unpack("<I", data[80:84])[0]
        off = 84
        for _ in range(count):
            for v in range(3):
                p = off + 12 + v * 12
                note(*struct.unpack("<fff", data[p:p + 12]))
            off += 50
    else:
        for line in data.decode("utf-8", "replace").splitlines():
            parts = line.split()
            if len(parts) == 4 and parts[0] == "vertex":
                try:
                    note(float(parts[1]), float(parts[2]), float(parts[3]))
                except ValueError:
                    pass

    if lo[0] == float("inf"):
        raise ValueError("no triangles found")
    return lo, hi


# ---------------------------------------------------------------- write


def translate(data, delta):
    """Shifts every vertex by `delta`, in the format it arrived in.

    Normals are rotation-only, so a translation leaves them correct and they are
    not touched. The binary path rewrites just the vertex floats, preserving the
    80-byte header and each triangle's attribute bytes; some slicers keep colour
    there and it is not ours to discard.
    """
    if is_binary(data):
        out = bytearray(data)
        count = struct.unpack("<I", data[80:84])[0]
        off = 84
        for _ in range(count):
            for v in range(3):
                p = off + 12 + v * 12
                x, y, z = struct.unpack("<fff", out[p:p + 12])
                out[p:p + 12] = struct.pack("<fff", x + delta[0], y + delta[1], z + delta[2])
            off += 50
        return bytes(out)

    # ASCII: rewrite the vertex lines and leave every other byte as it was,
    # including indentation and whichever float formatting the exporter chose.
    def fix(m):
        vals = [float(m.group(i)) + delta[i - 2] for i in (2, 3, 4)]
        return m.group(1) + " ".join(repr(round(v, 6)) for v in vals)

    text = data.decode("utf-8", "replace")
    text = re.sub(
        r"(\bvertex\s+)(\S+)\s+(\S+)\s+(\S+)",
        fix,
        text,
    )
    return text.encode("utf-8")


# ---------------------------------------------------------------- main


def parse_axes(text):
    picked = "".join(dict.fromkeys(text.lower()))
    bad = [c for c in picked if c not in AXES]
    if bad:
        raise argparse.ArgumentTypeError("unknown axis %r — use any of x, y, z" % bad[0])
    return picked


def parse_point(text):
    parts = text.replace(" ", "").split(",")
    if len(parts) != 3:
        raise argparse.ArgumentTypeError("expected three comma-separated numbers, e.g. 0,0,12.5")
    try:
        return [float(p) for p in parts]
    except ValueError:
        raise argparse.ArgumentTypeError("expected numbers, got %r" % text)


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Move an STL's geometry relative to its origin.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("files", nargs="+", metavar="FILE.stl")
    ap.add_argument("--axes", type=parse_axes, default="xyz",
                    help="axes to move (default: xyz; 'xy' leaves height alone)")
    ap.add_argument("--to", type=parse_point, metavar="X,Y,Z",
                    help="target centre (default: 0,0,0); only the chosen axes are used")
    ap.add_argument("--match", metavar="OTHER.stl",
                    help="take the target centre from another STL, so a stray part "
                         "lands in line with one that is already correct")
    ap.add_argument("--floor", action="store_true",
                    help="after moving, rest the lowest point on z=0")
    ap.add_argument("--out", metavar="DIR", help="write here instead of in place")
    ap.add_argument("--dry-run", action="store_true", help="report, write nothing")
    args = ap.parse_args(argv)

    fail = lambda msg: sys.exit("error: " + msg)

    if args.match and args.to:
        fail("--match and --to both set a target; pass only one")

    target = args.to or [0.0, 0.0, 0.0]
    if args.match:
        try:
            with open(args.match, "rb") as fh:
                lo, hi = bounds_of(fh.read())
        except (OSError, ValueError, struct.error) as exc:
            fail("could not read %s (%s)" % (args.match, exc))
        target = [(lo[i] + hi[i]) / 2 for i in range(3)]
        print("target centre from %s: (%s)" % (
            os.path.basename(args.match), ", ".join("%.3f" % v for v in target)))

    if args.out and not args.dry_run:
        os.makedirs(args.out, exist_ok=True)

    moved = 0
    for path in args.files:
        try:
            with open(path, "rb") as fh:
                data = fh.read()
            lo, hi = bounds_of(data)
        except (OSError, ValueError, struct.error) as exc:
            fail("could not read %s (%s)" % (path, exc))

        centre = [(lo[i] + hi[i]) / 2 for i in range(3)]
        delta = [target[i] - centre[i] if AXES[i] in args.axes else 0.0 for i in range(3)]
        if args.floor:
            delta[2] = -lo[2]

        name = os.path.basename(path)
        kind = "binary" if is_binary(data) else "ascii"
        print("%s  (%s, %s)" % (name, kind, "moving " + args.axes if any(delta) else "already in place"))
        print("   centre %s -> %s" % (
            "(" + ", ".join("%.3f" % v for v in centre) + ")",
            "(" + ", ".join("%.3f" % (centre[i] + delta[i]) for i in range(3)) + ")"))
        print("   delta  (%s)" % ", ".join("%.3f" % v for v in delta))

        if not any(delta):
            continue
        moved += 1
        if args.dry_run:
            continue

        out_path = os.path.join(args.out, name) if args.out else path
        with open(out_path, "wb") as fh:
            fh.write(translate(data, delta))

    if args.dry_run:
        print("\n[dry run] %d file(s) would change" % moved)
    else:
        print("\n%d file(s) written" % moved)
        if moved:
            print("A print with \"centerOrigin\": true centres each mesh on load, so this")
            print("only changes what you see when centerOrigin is false.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
