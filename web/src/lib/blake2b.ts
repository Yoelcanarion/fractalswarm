// BLAKE2b (RFC 7693), unkeyed, in pairs of 32-bit words: the hash of a run's log (kernel/ids.py `blake2b_hex`), for the one place a page has to
// compute it itself, the static showcase (static/chain.ts). A 64-bit word i is the pair v[2i] (low) and v[2i + 1] (high).

const BLOCK = 128;

const IV = [
  0xf3bcc908, 0x6a09e667, 0x84caa73b, 0xbb67ae85, 0xfe94f82b, 0x3c6ef372, 0x5f1d36f1, 0xa54ff53a, 0xade682d1, 0x510e527f, 0x2b3e6c1f, 0x9b05688c, 0xfb41bd6b, 0x1f83d9ab, 0x137e2179,
  0x5be0cd19,
];

const SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
];

const ROUNDS = 12;

/** The columns and then the diagonals of the 4 x 4 state, as the word each mix starts at. */
const MIXES = [
  [0, 4, 8, 12],
  [1, 5, 9, 13],
  [2, 6, 10, 14],
  [3, 7, 11, 15],
  [0, 5, 10, 15],
  [1, 6, 11, 12],
  [2, 7, 8, 13],
  [3, 4, 9, 14],
];

const v = new Uint32Array(32);
const m = new Uint32Array(32);

/** v[a] += v[b] (64 bits). A Uint32Array keeps what fits: only the carry is left to do by hand. */
function add(a: number, b: number): void {
  const low = v[a] + v[b];
  v[a + 1] += v[b + 1] + (low > 0xffffffff ? 1 : 0);
  v[a] = low;
}

/** v[a] += the message word at `x`. */
function addWord(a: number, x: number): void {
  const low = v[a] + m[x];
  v[a + 1] += m[x + 1] + (low > 0xffffffff ? 1 : 0);
  v[a] = low;
}

function mix(a: number, b: number, c: number, d: number, x: number, y: number): void {
  add(a, b);
  addWord(a, x);
  // v[d] = (v[d] ^ v[a]) rotated right by 32
  let low = v[d + 1] ^ v[a + 1];
  let high = v[d] ^ v[a];
  v[d] = low;
  v[d + 1] = high;
  add(c, d);
  // v[b] = (v[b] ^ v[c]) rotated right by 24
  low = v[b] ^ v[c];
  high = v[b + 1] ^ v[c + 1];
  v[b] = (low >>> 24) | (high << 8);
  v[b + 1] = (high >>> 24) | (low << 8);
  add(a, b);
  addWord(a, y);
  // v[d] = (v[d] ^ v[a]) rotated right by 16
  low = v[d] ^ v[a];
  high = v[d + 1] ^ v[a + 1];
  v[d] = (low >>> 16) | (high << 16);
  v[d + 1] = (high >>> 16) | (low << 16);
  add(c, d);
  // v[b] = (v[b] ^ v[c]) rotated right by 63, which is left by 1
  low = v[b] ^ v[c];
  high = v[b + 1] ^ v[c + 1];
  v[b] = (high >>> 31) | (low << 1);
  v[b + 1] = (low >>> 31) | (high << 1);
}

function compress(h: Uint32Array, block: Uint8Array, offset: number, counted: number, last: boolean): void {
  for (let i = 0; i < 32; i += 1) {
    const at = offset + i * 4;
    m[i] = block[at] | (block[at + 1] << 8) | (block[at + 2] << 16) | (block[at + 3] << 24);
  }
  v.set(h);
  v.set(IV, 16);
  v[24] ^= counted;
  v[25] ^= Math.floor(counted / 0x100000000);
  if (last) {
    v[28] = ~v[28];
    v[29] = ~v[29];
  }
  for (let round = 0; round < ROUNDS; round += 1) {
    const order = SIGMA[round % 10];
    for (let i = 0; i < 8; i += 1) {
      const [a, b, c, d] = MIXES[i];
      mix(a * 2, b * 2, c * 2, d * 2, order[i * 2] * 2, order[i * 2 + 1] * 2);
    }
  }
  for (let i = 0; i < 16; i += 1) h[i] ^= v[i] ^ v[i + 16];
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** `hashlib.blake2b(data, digest_size=size).hexdigest()`. */
export function blake2bHex(data: Uint8Array, size = 16): string {
  const h = Uint32Array.from(IV);
  h[0] ^= 0x01010000 ^ size;

  let offset = 0;
  while (data.length - offset > BLOCK) {
    compress(h, data, offset, offset + BLOCK, false);
    offset += BLOCK;
  }
  const tail = new Uint8Array(BLOCK);
  tail.set(data.subarray(offset));
  compress(h, tail, 0, data.length, true);

  const out = new Uint8Array(h.buffer.slice(0, size)); // the words are little-endian on every machine a browser runs on
  return hex(out);
}
