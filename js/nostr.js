const NT = window.NostrTools;

export const RECIPIENT_NAME = "zalgebar";
const WELL_KNOWN_URL = "https://zalgebar.com/.well-known/nostr.json";
const NSEC_STORE_KEY = "seedsigner.nsec";
const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://nos.lol",
];
const FALLBACK_RECIPIENT = {
  pubkey: "784c354759228dbe27aed411ad047141ad24dd0387bdc18032701260ff1ed941",
  relays: DEFAULT_RELAYS,
};

function dedupe(list) {
  return [...new Set(list.filter((x) => x && x.startsWith("wss://")))];
}

export function hasExtension() {
  return (
    typeof window.nostr === "object" &&
    typeof window.nostr.getPublicKey === "function" &&
    window.nostr.nip44 &&
    typeof window.nostr.nip44.encrypt === "function" &&
    typeof window.nostr.signEvent === "function"
  );
}

export async function getRecipient() {
  try {
    const res = await fetch(WELL_KNOWN_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("well-known fetch " + res.status);
    const data = await res.json();
    const pubkey = (data.names || {})[RECIPIENT_NAME];
    if (!pubkey) throw new Error("no pubkey for " + RECIPIENT_NAME);
    const relays = dedupe((data.relays || {})[pubkey] || []);
    return relays.length ? { pubkey, relays } : { pubkey, relays: DEFAULT_RELAYS };
  } catch (err) {
    return { ...FALLBACK_RECIPIENT };
  }
}

export function savedNsec() {
  try {
    return localStorage.getItem(NSEC_STORE_KEY) || "";
  } catch {
    return "";
  }
}

export function saveNsec(nsec) {
  try {
    localStorage.setItem(NSEC_STORE_KEY, nsec);
  } catch {}
}

export function clearSavedNsec() {
  try {
    localStorage.removeItem(NSEC_STORE_KEY);
  } catch {}
}

function parseSecretKey(input) {
  const t = String(input || "").trim();
  if (/^[0-9a-fA-F]{64}$/.test(t)) return NT.utils.hexToBytes(t.toLowerCase());
  try {
    const { type, data } = NT.nip19.decode(t);
    if (type === "nsec") return data;
  } catch {}
  throw new Error("Invalid secret key. Paste an nsec1… key or 64-char hex.");
}

export async function resolveIdentity(mode, onetimeSk, nsecInput) {
  if (mode === "extension") {
    if (!hasExtension()) throw new Error("No compatible nostr extension found.");
    const pubkey = await window.nostr.getPublicKey();
    return { mode: "extension", signer: window.nostr, pubkey };
  }
  if (mode === "onetime") {
    const sk = onetimeSk || NT.generateSecretKey();
    return { mode: "local", secretKey: sk, pubkey: NT.getPublicKey(sk) };
  }
  const sk = parseSecretKey(nsecInput);
  return { mode: "local", secretKey: sk, pubkey: NT.getPublicKey(sk) };
}

function randomNow() {
  return Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800);
}

export async function sendDesign({ recipient, identity, content, subject, onStatus }) {
  const relays = recipient.relays;
  if (onStatus) onStatus("Encrypting message…");

  const rumorBase = {
    kind: 14,
    created_at: Math.floor(Date.now() / 1000),
    content,
    tags: [["p", recipient.pubkey, relays[0]], ["subject", subject]],
  };

  let wrap;
  if (identity.mode === "extension") {
    const rumor = { ...rumorBase, pubkey: identity.pubkey };
    const sealedContent = await identity.signer.nip44.encrypt(recipient.pubkey, JSON.stringify(rumor));
    const seal = {
      kind: 13,
      pubkey: identity.pubkey,
      created_at: randomNow(),
      tags: [],
      content: sealedContent,
    };
    seal.id = NT.getEventHash(seal);
    const signedSeal = await identity.signer.signEvent(seal);
    wrap = NT.nip59.createWrap(signedSeal, recipient.pubkey);
  } else {
    wrap = NT.nip59.wrapEvent(rumorBase, identity.secretKey, recipient.pubkey);
  }

  if (onStatus) onStatus("Publishing to " + relays.length + " relays…");

  const pool = new NT.SimplePool();
  const results = await Promise.allSettled(
    relays.map((url) => pool.publish([url], wrap, 5000))
  );
  pool.close(relays);

  const ok = results.filter((r) => r.status === "fulfilled").length;
  return { wrapId: wrap.id, relays: relays.length, ok };
}

export function buildDesignPayload({ orderId, enclosure, enclosureName, colors, author }) {
  return JSON.stringify(
    {
      app: "seedsigner-designer",
      type: "enclosure-design",
      version: 1,
      orderId,
      enclosure,
      enclosureName,
      author,
      colors,
    },
    null,
    2
  );
}

export function npubOf(pubkey) {
  try {
    return NT.nip19.npubEncode(pubkey);
  } catch {
    return pubkey;
  }
}
