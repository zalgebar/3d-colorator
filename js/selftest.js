// Assertions over the pure logic, run with ?selftest and reported to the console.
//
// The repo has no build step and no test runner, and adding either to a static
// site is a poor trade. But the parts that are genuinely easy to get wrong —
// flag resolution, category matching, share encoding, reconciliation, id rules,
// legacy colour mapping — are all pure functions, so they can be checked in the
// browser without any of that machinery.

import { Palette, parseChosen, chosenKey, isCustom, customColor } from "./data/palette.js";
import { normalizePrint, buildExportObject } from "./data/prints.js";
import { normalizeCollections, pickCollection, printsFor, resolveEnabled } from "./data/collections.js";
import { slugify, uniqueId, validateId } from "./data/ids.js";
import { buildShareLink, parseShareLink, classifyShared } from "./ui/share.js";

const results = [];
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  results.push({ name, pass: a === e, actual: a, expected: e });
};

const PALETTE = new Palette({
  version: 1,
  colors: [
    { id: "orange", name: "Orange", hex: "#f75403", opacity: 1 },
    { id: "green", name: "Green", hex: "#00ae42", opacity: 1 },
    { id: "black", name: "Black", hex: "#000000", opacity: 1 },
    { id: "smoke", name: "Smoke", hex: "#202020", opacity: 0.45 },
  ],
});

function run() {
  // ---- ids ----
  check("slugify strips punctuation", slugify("Left Thumbstick!"), "left_thumbstick");
  check("slugify falls back", slugify("", "group"), "group");
  check("uniqueId dedupes", uniqueId("lid", new Set(["lid", "lid_2"])), "lid_3");
  check("validateId rejects caps", !!validateId("Bad", new Set()), true);
  check("validateId rejects taken", !!validateId("lid", new Set(["lid"])), true);
  check("validateId accepts", validateId("lid_left", new Set()), null);

  // ---- palette ----
  check("offer-all falls back to the whole catalog", PALETTE.offeredIds({}), ["orange", "green", "black", "smoke"]);
  check("restricted offering is honoured", PALETTE.offeredIds({ palette: ["black", "green"] }), ["black", "green"]);
  check("unknown ids drop out of an offering", PALETTE.offeredIds({ palette: ["black", "ghost"] }), ["black"]);
  check("default repaired into the offering", PALETTE.defaultColorOf({ palette: ["black"], defaultColor: "green" }), "black");
  check("translucent drives material transparency", PALETTE.toMaterial("smoke").transparent, true);
  check("opaque stays opaque", PALETTE.toMaterial("orange").transparent, false);
  check("nearest picks the closest offered", PALETTE.nearestId("#00b050", ["orange", "black", "green"]), "green");

  // ---- chosen union ----
  check("parseChosen reads a custom token", parseChosen("~ff00ff"), { custom: "#ff00ff" });
  check("chosenKey round-trips a custom", chosenKey(parseChosen("~ff00ff")), "~ff00ff");
  check("chosenKey passes an id through", chosenKey("orange"), "orange");
  check("custom colours carry opacity", PALETTE.resolve(customColor("#112233", { opacity: 0.5 })).opacity, 0.5);
  check("a plain id is not custom", isCustom("orange"), false);

  // ---- prints ----
  const print = normalizePrint({
    id: "p", name: "P",
    pieces: [
      { id: "a", label: "A", file: "x.stl", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], defaultColor: "orange" },
      { id: "b", label: "B", file: "x.stl", position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], defaultColor: "green" },
    ],
    links: [{ id: "g", label: "", members: ["a", "b"], collapsed: true, color: "orange" }],
  });
  check("links survive normalization", print.links.length, 1);
  check("a one-member group is dropped", normalizePrint({ links: [{ id: "g", members: ["a"] }], pieces: [] }).links.length, 0);
  check("a piece joins at most one group",
    normalizePrint({
      pieces: [{ id: "a" }, { id: "b" }, { id: "c" }],
      links: [{ id: "g1", members: ["a", "b"] }, { id: "g2", members: ["a", "c"] }],
    }).links.map((l) => l.members),
    [["a", "b"], ["c"]].slice(0, 1));
  check("export strips UI bookkeeping",
    JSON.stringify(buildExportObject(print, new Map())).includes("idFixed"), false);

  // ---- collections ----
  const config = normalizeCollections({
    global: { submit: { enabled: true, recipient: "me", shops: [{ label: "g" }] }, customColors: { enabled: false } },
    collections: {
      default: { name: "3D Colorator", filter: null },
      ss: { name: "SS", filter: { categories: ["seedsigner"] }, submit: { shops: [{ label: "c" }] } },
      off: { name: "Off", submit: { enabled: false } },
    },
  });
  check("unknown collection falls back", pickCollection(config, "nope").id, "default");
  check("known collection resolves", pickCollection(config, "ss").id, "ss");
  check("omitted inherits global", resolveEnabled({ enabled: true }, undefined), true);
  check("explicit false opts out", resolveEnabled({ enabled: true }, { enabled: false }), false);
  check("global off is a kill-switch", resolveEnabled({ enabled: false }, { enabled: true }), false);
  check("collection overrides shops", config.collections.ss.submit.shops[0].label, "c");
  check("collection inherits recipient", config.collections.ss.submit.recipient, "me");
  const catalog = [
    { id: "a", categories: ["seedsigner"] },
    { id: "b", categories: ["accessories"] },
    { id: "c", categories: ["games", "accessories"] },
  ];
  check("null filter shows everything", printsFor(config.collections.default, catalog).map((p) => p.id), ["a", "b", "c"]);
  check("filter is any-match", printsFor({ filter: { categories: ["accessories"] } }, catalog).map((p) => p.id), ["b", "c"]);

  // ---- share links ----
  const origin = { origin: "https://x.test", pathname: "/", search: "" };
  const records = new Map([["a", { color: "orange" }], ["b", { color: "orange" }]]);
  const collapsedLink = buildShareLink({ print, links: print.links, records, origin });
  check("a collapsed group travels as one key", collapsedLink.includes("g=orange") && !collapsedLink.includes("a=orange"), true);
  const separate = { ...print, links: [{ ...print.links[0], collapsed: false }] };
  const separateLink = buildShareLink({ print: separate, links: separate.links, records, origin });
  check("a separate group lists its members", separateLink.includes("a=orange") && separateLink.includes("b=orange"), true);
  check("print id is carried", parseShareLink(collapsedLink.slice(collapsedLink.indexOf("?"))).print, "p");
  check("reserved keys are not colours",
    parseShareLink("?print=p&design&collection=x&a=orange").colors.map((c) => c.key), ["a"]);

  // ---- reconciliation ----
  const target = (key) => (key === "a" ? { label: "A", offered: ["black", "green"], current: "black" } : null);
  const { applied, problems } = classifyShared({
    shared: [{ key: "a", token: "green" }, { key: "zz", token: "green" }],
    palette: PALETTE, resolveTarget: target,
  });
  check("an offered colour applies silently", [...applied.entries()], [["a", "green"]]);
  check("a key for a missing piece is ignored", problems.length, 0);
  // smoke (#202020) is unmistakably nearest black among the offered pair
  const unoffered = classifyShared({
    shared: [{ key: "a", token: "smoke" }], palette: PALETTE, resolveTarget: target,
  }).problems[0];
  check("an unoffered colour is flagged", unoffered.kind, "unoffered");
  check("...and suggests the nearest offered", unoffered.chosen, "black");
  const unknown = classifyShared({
    shared: [{ key: "a", token: "ghost" }], palette: PALETTE, resolveTarget: target,
  }).problems[0];
  check("an unknown id is flagged", unknown.kind, "unknown");
  check("...with no colour to show", unknown.requestedHex, null);
  const custom = classifyShared({
    shared: [{ key: "a", token: "~ff00ff" }], palette: PALETTE, resolveTarget: target,
  }).problems[0];
  check("a reserved custom token degrades, not errors", custom.kind, "unknown");

  return results;
}

export function runSelfTest() {
  results.length = 0;
  let rows;
  try {
    rows = run();
  } catch (err) {
    console.error("[selftest] threw:", err);
    return { total: 0, failed: 1 };
  }
  const failed = rows.filter((r) => !r.pass);
  console.group("[selftest] " + (rows.length - failed.length) + "/" + rows.length + " passed");
  failed.forEach((r) => console.error("FAIL " + r.name + "\n  expected " + r.expected + "\n  actual   " + r.actual));
  if (!failed.length) console.log("all assertions passed");
  console.groupEnd();
  return { total: rows.length, failed: failed.length };
}
