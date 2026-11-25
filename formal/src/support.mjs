import { createHash } from 'node:crypto';

const isCount = value => Number.isSafeInteger(value) && value >= 0;

/**
 * A counted allowance shared across one search: compiler calls, proposal
 * steps or model tokens. A refused charge leaves the count unchanged.
 */
export class Budget {
  #used = 0;

  constructor(limit) {
    if (!isCount(limit)) throw new RangeError(`Budget limit must be a non-negative safe integer, got ${String(limit)}`);
    this.limit = limit;
  }

  get used() { return this.#used; }

  get remaining() { return this.limit - this.#used; }

  /** Charge `amount` if it fits and return true; otherwise return false. */
  tryCharge(amount) {
    if (!isCount(amount) || amount > this.remaining) return false;
    this.#used += amount;
    return true;
  }
}

// Number of bytes in a UTF-8 sequence that starts with `byte`, or 0 when the
// byte cannot start one.
const sequenceLength = byte =>
  byte < 0x80 ? 1 : byte >= 0xc2 && byte <= 0xdf ? 2 : byte >= 0xe0 && byte <= 0xef ? 3
    : byte >= 0xf0 && byte <= 0xf4 ? 4 : 0;

const isContinuation = byte => (byte & 0xc0) === 0x80;

// Valid range of the second byte after each lead byte (RFC 3629 table 3-7),
// which excludes overlong forms, surrogates and values above U+10FFFF.
const secondByteRange = lead =>
  lead === 0xe0 ? [0xa0, 0xbf] : lead === 0xed ? [0x80, 0x9f]
    : lead === 0xf0 ? [0x90, 0xbf] : lead === 0xf4 ? [0x80, 0x8f] : [0x80, 0xbf];

// Drop a trailing code point that was cut before its last byte. Bytes that
// could never complete a valid code point are kept as decoding evidence.
const trimIncompleteEnd = bytes => {
  let start = bytes.length - 1;
  while (start >= 0 && bytes.length - start < 4 && isContinuation(bytes[start])) start -= 1;
  if (start < 0) return bytes;
  const width = sequenceLength(bytes[start]);
  const present = bytes.length - start;
  if (width <= present) return bytes;
  const [low, high] = secondByteRange(bytes[start]);
  const second = bytes[start + 1];
  return second === undefined || (second >= low && second <= high) ? bytes.subarray(0, start) : bytes;
};

// Drop continuation bytes left at the start by a cut inside a code point. A
// cut leaves at most three; a longer run is malformed output and is kept.
const trimIncompleteStart = bytes => {
  let start = 0;
  while (start < bytes.length && isContinuation(bytes[start])) start += 1;
  return start > 3 ? bytes : bytes.subarray(start);
};

/**
 * Keeps the first and last bytes of a process stream within `limit` bytes in
 * total. When the stream is longer, `text` joins both ends around a marker
 * and never splits a UTF-8 code point.
 */
export class OutputExcerpt {
  #head = [];
  #headBytes = 0;
  #tail = Buffer.alloc(0);
  #total = 0;

  constructor(limit) {
    if (!isCount(limit)) throw new RangeError(`Output limit must be a non-negative safe integer, got ${String(limit)}`);
    this.limit = limit;
    this.headLimit = Math.ceil(limit / 2);
    this.tailLimit = limit - this.headLimit;
  }

  append(chunk) {
    this.#total += chunk.length;
    const headRoom = this.headLimit - this.#headBytes;
    const toHead = Math.max(0, Math.min(headRoom, chunk.length));
    if (toHead) {
      this.#head.push(chunk.subarray(0, toHead));
      this.#headBytes += toHead;
    }
    const rest = chunk.subarray(toHead);
    if (rest.length && this.tailLimit) {
      const joined = Buffer.concat([this.#tail, rest]);
      this.#tail = Buffer.from(joined.subarray(Math.max(0, joined.length - this.tailLimit)));
    }
  }

  get truncated() { return this.#total > this.limit; }

  get text() {
    const head = Buffer.concat(this.#head);
    if (!this.truncated) return Buffer.concat([head, this.#tail]).toString('utf8');
    return `${trimIncompleteEnd(head).toString('utf8')} … [output omitted] … ${trimIncompleteStart(this.#tail).toString('utf8')}`;
  }
}

const omitted = value => value === undefined || typeof value === 'function' || typeof value === 'symbol';

// RFC 8785 JSON canonicalization: ECMAScript number and string serialization,
// object keys sorted by UTF-16 code units, no insignificant whitespace.
const canonicalJson = (value, ancestors) => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`Cannot canonicalize non-finite number ${value}`);
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new TypeError(`Cannot canonicalize a value of type ${typeof value}`);
  if (ancestors.has(value)) throw new TypeError('Cannot canonicalize a circular structure');
  ancestors.add(value);
  try {
    if (typeof value.toJSON === 'function') return canonicalJson(value.toJSON(), ancestors);
    if (Array.isArray(value)) {
      return `[${Array.from(value, item => omitted(item) ? 'null' : canonicalJson(item, ancestors)).join(',')}]`;
    }
    const members = Object.keys(value).sort()
      .filter(key => !omitted(value[key]))
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key], ancestors)}`);
    return `{${members.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
};

/** Lowercase hex SHA-256 of the RFC 8785 canonical JSON form of `value`. */
export function canonicalDigest(value) {
  return createHash('sha256').update(canonicalJson(value, new Set()), 'utf8').digest('hex');
}
