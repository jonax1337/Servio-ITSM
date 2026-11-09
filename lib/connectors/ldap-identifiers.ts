/**
 * Text forms of binary directory identifiers, used as `externalId` by the LDAP /
 * Active Directory connector. Pure (no I/O), unit-tested with known pairs.
 *
 * - `objectGUID` (16 bytes) becomes the canonical GUID text the directory tools
 *   show, e.g. `35918bc9-196d-40ea-9779-889d79b753f0`: Active Directory stores
 *   the first three groups little-endian, so their bytes are reversed.
 * - `objectSid` becomes the SID string, e.g. `S-1-5-32-544`.
 *
 * Earlier releases stored the raw bytes as lowercase hex. That form stays
 * recognisable (`legacyHexExternalId`) so users synced before the change are
 * matched and moved to the canonical id instead of being created twice; the
 * migration `20261118000000_ldap_guid_external_ids` converts stored GUIDs once.
 */

const GUID_ATTRIBUTE = /guid/i;
const SID_ATTRIBUTE = /sid/i;
const GUID_BYTES = 16;
const HEX_GUID = /^[0-9a-f]{32}$/i;
const CANONICAL_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Binary attributes (objectGUID, objectSid, msDS-ConsistencyGuid …) must be requested as Buffers. */
export function isBinaryAttr(name: string): boolean {
  return GUID_ATTRIBUTE.test(name) || SID_ATTRIBUTE.test(name);
}

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

/** 16 GUID bytes in Active Directory order → `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` (lowercase). */
export function guidFromBytes(bytes: Uint8Array): string | null {
  if (bytes.length !== GUID_BYTES) return null;
  const b = Array.from(bytes);
  const group = (indexes: number[]) => hex(Uint8Array.from(indexes.map((i) => b[i])));
  return [
    group([3, 2, 1, 0]),
    group([5, 4]),
    group([7, 6]),
    group([8, 9]),
    group([10, 11, 12, 13, 14, 15]),
  ].join("-");
}

/** The hex an earlier release stored for a GUID → its canonical form; null when `value` is not 32 hex digits. */
export function guidFromLegacyHex(value: string): string | null {
  return HEX_GUID.test(value) ? guidFromBytes(Buffer.from(value, "hex")) : null;
}

export const isCanonicalGuid = (value: string): boolean => CANONICAL_GUID.test(value);

/** A canonical GUID → the hex an earlier release stored for it (the inverse of `guidFromLegacyHex`); null otherwise. */
export function legacyHexFromGuid(guid: string): string | null {
  if (!isCanonicalGuid(guid)) return null;
  const [a, b, c, d, e] = guid.split("-");
  const reversed = (group: string) => group.match(/../g)!.reverse().join("");
  return reversed(a) + reversed(b) + reversed(c) + d + e;
}

/** A binary SID → `S-<revision>-<authority>-<sub>-…`; null when the bytes are not a well-formed SID. */
export function sidFromBytes(bytes: Uint8Array): string | null {
  if (bytes.length < 8) return null;
  const revision = bytes[0];
  const count = bytes[1];
  if (revision !== 1 || count > 15 || bytes.length !== 8 + count * 4) return null;
  let authority = 0;
  for (let i = 2; i < 8; i += 1) authority = authority * 256 + bytes[i];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const subAuthorities = Array.from({ length: count }, (_, i) => view.getUint32(8 + i * 4, true));
  return ["S", revision, authority, ...subAuthorities].join("-");
}

export type BinaryExternalId = {
  /** What is stored as `externalId` from now on. */
  externalId: string;
  /** Forms earlier releases stored for the same value, matched during the transition. */
  legacy: string[];
};

/**
 * The text `externalId` for a binary attribute value: the canonical GUID or SID
 * form when the attribute is one and the bytes fit, else (as before) hex.
 */
export function binaryExternalId(attribute: string, bytes: Uint8Array): BinaryExternalId {
  const legacyHex = hex(bytes);
  const canonical =
    (GUID_ATTRIBUTE.test(attribute) ? guidFromBytes(bytes) : null) ?? (SID_ATTRIBUTE.test(attribute) ? sidFromBytes(bytes) : null);
  if (!canonical) return { externalId: legacyHex, legacy: [] };
  return { externalId: canonical, legacy: [legacyHex] };
}
