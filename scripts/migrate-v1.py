#!/usr/bin/env python3
"""One-shot migration: enclosures/ (v1) -> prints/ + palette.json (v2).

Throwaway: delete once the output is committed.
See docs/redesign/01-data-model.md#migration-of-the-current-data
"""
import json, os

# Hex -> (palette id, display name). Order defines palette.json order,
# which is the order visitors see when a piece offers everything.
MAP = [
    ("#f75403", "ss_orange", "SeedSigner Orange"),
    ("#9a57bd", "purple",    "Purple"),
    ("#eb3a3a", "red",       "Red"),
    ("#ffd00b", "yellow",    "Yellow"),
    ("#00ae42", "green",     "Green"),
    ("#002e96", "blue",      "Blue"),
    ("#000000", "black",     "Matte Black"),
    ("#adb1b2", "grey",      "Grey"),
    ("#ffffff", "white",     "White"),
    ("#f55a74", "pink",      "Pink"),
    ("#6f5034", "brown",     "Brown"),
]
BY_HEX = {h: i for h, i, _ in MAP}

def id_of(hex_):
    key = str(hex_).lower()
    if key not in BY_HEX:
        raise SystemExit("Unmapped hex in source data: %r" % hex_)
    return BY_HEX[key]

def write(path, obj):
    with open(path, "w") as f:
        json.dump(obj, f, indent=2)
        f.write("\n")

palette = {"version": 1,
           "colors": [{"id": i, "name": n, "hex": h, "opacity": 1} for h, i, n in MAP]}
all_ids = [c["id"] for c in palette["colors"]]

os.makedirs("prints", exist_ok=True)
src_manifest = json.load(open("enclosures/manifest.json"))
entries = []

for pid in src_manifest["enclosures"]:
    src = json.load(open(os.path.join("enclosures", pid + ".json")))
    pieces = []
    for p in src["pieces"]:
        offered = [id_of(c) for c in p.get("colors", [])]
        piece = {
            "id": p["id"],
            "label": p["label"],
            "file": p["file"],
            "position": p["position"],
            "rotation": p["rotation"],
            "scale": p["scale"],
            "centerOrigin": p.get("centerOrigin", True) is not False,
            "defaultColor": id_of(p["defaultColor"]),
        }
        # every piece currently lists the whole palette -> omit `palette` (= offer all)
        if offered and offered != all_ids:
            piece["palette"] = offered
        pieces.append(piece)

    print_obj = {
        "id": src["id"],
        "name": src["name"],
        "description": src.get("description", ""),
        "categories": ["seedsigner"],
        "axes": src.get("axes") or {"up": "z"},
        "camera": src.get("camera"),
        "links": [],
        "pieces": pieces,
    }
    write(os.path.join("prints", pid + ".json"), print_obj)
    entries.append({"id": print_obj["id"], "name": print_obj["name"],
                    "categories": print_obj["categories"]})
    offer_all = all("palette" not in x for x in pieces)
    print("  prints/%s.json  (%d pieces, offer-all: %s)" % (pid, len(pieces), offer_all))

write("prints/manifest.json", {"version": "2.0.0", "prints": entries})
write("palette.json", palette)
print("  palette.json  (%d colors)" % len(palette["colors"]))
print("  prints/manifest.json  (%d prints)" % len(entries))
