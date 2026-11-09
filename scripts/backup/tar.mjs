// Minimal streaming tar.gz writer and reader for the built-in backup (POSIX
// ustar with PAX headers for long names and large files). Plain Node, no
// dependencies: the restore script runs it with the app stopped, and any
// `tar xzf` can unpack the archives as well.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";

const BLOCK = 512;
const READ_CHUNK = 256 * 1024;
const ZERO_BLOCK = Buffer.alloc(BLOCK);
/** Largest size the 11-digit octal `size` field can hold; larger files get a PAX `size` record. */
const MAX_OCTAL_SIZE = 0o77777777777;

/**
 * @typedef {{ name: string, abs: string }} TarSource
 *   `name` is the archive path (forward slashes, relative), `abs` the file to read.
 * @typedef {{ files: number, bytes: number, archiveBytes: number, sha256: string, skipped: string[] }} TarWriteResult
 *   `bytes` is the content size, `archiveBytes` the size of the .tar.gz, `skipped` the names
 *   that vanished between listing and archiving.
 * @typedef {{ name: string, size: number, type: "file" | "directory" | "other", typeflag: string }} TarEntry
 */

/**
 * @param {string} name
 * @returns {boolean} whether `name` is a safe relative archive path
 */
export function isSafeEntryName(name) {
  if (!name || name.length > 4096 || name.includes("\0") || name.includes("\\")) return false;
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) return false;
  const segments = name.replace(/\/+$/, "").split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/**
 * @param {Buffer} block
 * @param {string} value
 * @param {number} offset
 * @param {number} length
 */
function writeString(block, value, offset, length) {
  block.write(value, offset, Math.min(length, Buffer.byteLength(value)), "utf8");
}

/**
 * @param {Buffer} block
 * @param {number} value
 * @param {number} offset
 * @param {number} length field length including the terminating NUL
 */
function writeOctal(block, value, offset, length) {
  writeString(block, Math.floor(value).toString(8).padStart(length - 1, "0") + "\0", offset, length);
}

/**
 * @param {{ name: string, size: number, mtime: number, typeflag: string }} entry
 * @returns {Buffer}
 */
function headerBlock({ name, size, mtime, typeflag }) {
  const block = Buffer.alloc(BLOCK);
  writeString(block, name, 0, 100);
  writeOctal(block, typeflag === "5" ? 0o755 : 0o644, 100, 8);
  writeOctal(block, 0, 108, 8);
  writeOctal(block, 0, 116, 8);
  writeOctal(block, Math.min(size, MAX_OCTAL_SIZE), 124, 12);
  writeOctal(block, mtime, 136, 12);
  block.fill(0x20, 148, 156); // checksum is computed with this field as spaces
  writeString(block, typeflag, 156, 1);
  writeString(block, "ustar\0", 257, 6);
  writeString(block, "00", 263, 2);
  let sum = 0;
  for (const byte of block) sum += byte;
  writeString(block, sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return block;
}

/**
 * @param {Record<string, string>} records
 * @returns {Buffer} the PAX extended header data
 */
function paxData(records) {
  const lines = Object.entries(records).map(([key, value]) => {
    const body = ` ${key}=${value}\n`;
    let length = Buffer.byteLength(body) + 1;
    while (String(length).length + Buffer.byteLength(body) !== length) length = String(length).length + Buffer.byteLength(body);
    return `${length}${body}`;
  });
  return Buffer.from(lines.join(""), "utf8");
}

/** @param {number} size */
const padding = (size) => (size % BLOCK === 0 ? 0 : BLOCK - (size % BLOCK));

/**
 * The header block(s) of one file: a PAX header first when the name or size
 * does not fit the ustar fields.
 *
 * @param {string} name
 * @param {number} size
 * @param {number} mtime seconds
 * @returns {Buffer[]}
 */
export function fileHeaders(name, size, mtime) {
  /** @type {Record<string, string>} */
  const records = {};
  if (Buffer.byteLength(name) > 99) records.path = name;
  if (size > MAX_OCTAL_SIZE) records.size = String(size);
  const blocks = [];
  if (Object.keys(records).length > 0) {
    const data = paxData(records);
    blocks.push(headerBlock({ name: "PaxHeader/entry", size: data.length, mtime, typeflag: "x" }));
    blocks.push(data, Buffer.alloc(padding(data.length)));
  }
  const shortName = Buffer.byteLength(name) > 99 ? name.slice(-90).replace(/^[^/]*\//, "") || "entry" : name;
  blocks.push(headerBlock({ name: shortName, size, mtime, typeflag: "0" }));
  return blocks;
}

/**
 * @param {TarSource[]} sources
 * @param {string[]} skipped collects the names of files that disappeared
 * @param {{ files: number, bytes: number }} counts
 */
async function* tarStream(sources, skipped, counts) {
  for (const source of sources) {
    let handle;
    try {
      handle = await open(source.abs, "r");
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") {
        skipped.push(source.name);
        continue;
      }
      throw error;
    }
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) {
        skipped.push(source.name);
        continue;
      }
      // The size is fixed by the open descriptor: blobs are replaced by rename, never rewritten in place.
      const size = stats.size;
      yield* fileHeaders(source.name, size, Math.floor(stats.mtimeMs / 1000));
      let remaining = size;
      while (remaining > 0) {
        const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK, remaining));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, size - remaining);
        if (bytesRead === 0) throw new Error(`${source.name} shrank while it was archived`);
        remaining -= bytesRead;
        yield buffer.subarray(0, bytesRead);
      }
      const pad = padding(size);
      if (pad) yield Buffer.alloc(pad);
      counts.files += 1;
      counts.bytes += size;
    } finally {
      await handle.close();
    }
  }
  yield ZERO_BLOCK;
  yield ZERO_BLOCK;
}

/**
 * A pass-through stream that hashes and counts what flows through it.
 *
 * @returns {{ stream: Transform, digest: () => { sha256: string, bytes: number } }}
 */
export function hashingPassThrough() {
  const hash = createHash("sha256");
  let bytes = 0;
  const stream = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      bytes += chunk.length;
      callback(null, chunk);
    },
  });
  return { stream, digest: () => ({ sha256: hash.digest("hex"), bytes }) };
}

/**
 * Writes `sources` into a new gzip-compressed tar file (`out` must not exist).
 *
 * @param {string} out
 * @param {TarSource[]} sources
 * @returns {Promise<TarWriteResult>}
 */
export async function writeTarGz(out, sources) {
  /** @type {string[]} */
  const skipped = [];
  const counts = { files: 0, bytes: 0 };
  const hashing = hashingPassThrough();
  await pipeline(Readable.from(tarStream(sources, skipped, counts)), createGzip({ level: 6 }), hashing.stream, createWriteStream(out, { flags: "wx" }));
  const { sha256, bytes } = hashing.digest();
  return { files: counts.files, bytes: counts.bytes, archiveBytes: bytes, sha256, skipped };
}

/**
 * @param {Buffer} block
 * @param {number} offset
 * @param {number} length
 */
function readString(block, offset, length) {
  const field = block.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString("utf8");
}

/**
 * @param {Buffer} block
 * @param {number} offset
 * @param {number} length
 */
function readNumber(block, offset, length) {
  const field = block.subarray(offset, offset + length);
  if (field[0] & 0x80) {
    // GNU base-256 encoding for values that do not fit the octal field.
    let value = 0;
    for (let i = 1; i < field.length; i++) value = value * 256 + field[i];
    return value;
  }
  const text = readString(block, offset, length).trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/.test(text)) throw new Error(`Corrupt tar header: invalid number "${text}"`);
  return parseInt(text, 8);
}

/** @param {Buffer} block */
function checksumValid(block) {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i];
  return sum === readNumber(block, 148, 8);
}

/**
 * @param {Buffer} data
 * @returns {Record<string, string>}
 */
function parsePax(data) {
  /** @type {Record<string, string>} */
  const records = {};
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space === -1) break;
    const length = parseInt(data.subarray(offset, space).toString("utf8"), 10);
    if (!Number.isFinite(length) || length <= 0) throw new Error("Corrupt PAX header");
    const record = data.subarray(space + 1, offset + length - 1).toString("utf8");
    const eq = record.indexOf("=");
    if (eq > 0) records[record.slice(0, eq)] = record.slice(eq + 1);
    offset += length;
  }
  return records;
}

/**
 * @typedef {{ data?: (chunk: Buffer) => void | Promise<void>, end?: () => void | Promise<void> }} EntrySink
 */

/**
 * Reads a .tar.gz from start to end, checking gzip CRC, header checksums and the
 * end-of-archive marker. `visit` sees every entry and may return a sink for its
 * content. Throws on any corruption or truncation.
 *
 * @param {string} file
 * @param {(entry: TarEntry) => EntrySink | void | Promise<EntrySink | void>} visit
 * @returns {Promise<{ entries: number }>}
 */
export async function walkTarGz(file, visit) {
  let entries = 0;
  let sawEnd = false;
  await pipeline(createReadStream(file), createGunzip(), async function (source) {
    let buffer = Buffer.alloc(0);
    /** @type {"header" | "data" | "pad" | "pax" | "done"} */
    let state = "header";
    let remaining = 0;
    let pad = 0;
    /** @type {EntrySink | void} */
    let sink;
    /** @type {Buffer[]} */
    let paxChunks = [];
    /** @type {Record<string, string>} */
    let pending = {};
    let longName = /** @type {string | null} */ (null);
    let longNameEntry = false;
    let zeroBlocks = 0;

    for await (const chunk of source) {
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
      while (buffer.length > 0 && state !== "done") {
        if (state === "header") {
          if (buffer.length < BLOCK) break;
          const block = buffer.subarray(0, BLOCK);
          buffer = buffer.subarray(BLOCK);
          if (block.equals(ZERO_BLOCK)) {
            zeroBlocks += 1;
            if (zeroBlocks === 2) {
              sawEnd = true;
              state = "done";
            }
            continue;
          }
          if (zeroBlocks > 0) throw new Error("Corrupt tar archive: data after an empty block");
          if (!checksumValid(block)) throw new Error("Corrupt tar archive: header checksum mismatch");
          const typeflag = readString(block, 156, 1) || "0";
          const prefix = readString(block, 345, 155);
          const baseName = readString(block, 0, 100);
          let size = readNumber(block, 124, 12);
          if (typeflag === "x" || typeflag === "g" || typeflag === "L") {
            remaining = size;
            pad = padding(size);
            paxChunks = [];
            longNameEntry = typeflag === "L";
            state = typeflag === "g" ? "data" : "pax";
            sink = undefined;
            if (remaining === 0) state = pad ? "pad" : "header";
            continue;
          }
          let name = pending.path ?? longName ?? (prefix ? `${prefix}/${baseName}` : baseName);
          if (pending.size !== undefined) size = Number(pending.size);
          pending = {};
          longName = null;
          if (typeflag === "5") name = name.replace(/\/+$/, "");
          /** @type {TarEntry} */
          const entry = {
            name,
            size,
            typeflag,
            type: typeflag === "0" || typeflag === "7" ? "file" : typeflag === "5" ? "directory" : "other",
          };
          entries += 1;
          sink = await visit(entry);
          remaining = entry.type === "directory" ? 0 : size;
          pad = padding(remaining);
          state = remaining > 0 ? "data" : pad ? "pad" : "header";
          if (remaining === 0 && sink?.end) await sink.end();
        } else if (state === "data" || state === "pax") {
          const take = Math.min(remaining, buffer.length);
          const part = buffer.subarray(0, take);
          buffer = buffer.subarray(take);
          remaining -= take;
          if (state === "pax") paxChunks.push(Buffer.from(part));
          else if (sink?.data) await sink.data(part);
          if (remaining === 0) {
            if (state === "pax") {
              const data = Buffer.concat(paxChunks);
              if (longNameEntry) longName = data.toString("utf8").replace(/\0+$/, "");
              else pending = { ...pending, ...parsePax(data) };
            } else if (sink?.end) {
              await sink.end();
            }
            sink = undefined;
            state = pad ? "pad" : "header";
          }
        } else if (state === "pad") {
          const take = Math.min(pad, buffer.length);
          buffer = buffer.subarray(take);
          pad -= take;
          if (pad === 0) state = "header";
        }
      }
    }
    if (state !== "done" && !(state === "header" && zeroBlocks === 2)) {
      throw new Error("Truncated tar archive: the end-of-archive marker is missing");
    }
  });
  if (!sawEnd) throw new Error("Truncated tar archive: the end-of-archive marker is missing");
  return { entries };
}

/**
 * Lists a .tar.gz and hashes it: the file names, the content bytes and the
 * sha256 of the compressed file.
 *
 * @param {string} file
 * @returns {Promise<{ names: Set<string>, files: number, bytes: number, sha256: string, unsupported: string[] }>}
 */
export async function inspectTarGz(file) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), async function (source) {
    for await (const chunk of source) hash.update(chunk);
  });
  /** @type {Set<string>} */
  const names = new Set();
  /** @type {string[]} */
  const unsupported = [];
  let files = 0;
  let bytes = 0;
  await walkTarGz(file, (entry) => {
    if (entry.type === "file") {
      names.add(entry.name);
      files += 1;
      bytes += entry.size;
    } else if (entry.type === "other") {
      unsupported.push(entry.name);
    }
  });
  return { names, files, bytes, sha256: hash.digest("hex"), unsupported };
}

/**
 * Unpacks a .tar.gz into `destination` (created; should be empty). Only regular
 * files and directories are written; links, devices and unsafe paths abort.
 *
 * @param {string} file
 * @param {string} destination
 * @returns {Promise<{ files: number, bytes: number }>}
 */
export async function extractTarGz(file, destination) {
  const root = resolve(destination);
  await mkdir(root, { recursive: true });
  let files = 0;
  let bytes = 0;
  await walkTarGz(file, async (entry) => {
    if (!isSafeEntryName(entry.name)) throw new Error(`Refusing unsafe archive path "${entry.name}"`);
    const target = join(root, ...entry.name.split("/"));
    if (target !== root && !target.startsWith(root + sep)) throw new Error(`Refusing archive path outside the target: "${entry.name}"`);
    if (entry.type === "directory") {
      await mkdir(target, { recursive: true });
      return;
    }
    if (entry.type !== "file") throw new Error(`Refusing unsupported archive entry "${entry.name}" (type ${entry.typeflag})`);
    await mkdir(dirname(target), { recursive: true });
    const handle = await open(target, "wx");
    let written = 0;
    return {
      data: async (chunk) => {
        await handle.write(chunk);
        written += chunk.length;
      },
      end: async () => {
        await handle.sync();
        await handle.close();
        files += 1;
        bytes += written;
      },
    };
  });
  return { files, bytes };
}
