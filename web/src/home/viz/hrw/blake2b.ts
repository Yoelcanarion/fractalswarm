// BLAKE2b with an 8-byte digest and no key, which is what `stable_hash` in kernel/ids.py takes
// (`hashlib.blake2b(data, digest_size=8)`). An 8-byte BLAKE2b is not the first 8 bytes of the long one: the digest length is part of
// the state it starts from. Written with BigInt for being short and checkable, not for speed: the click demo hashes a few dozen
// short texts per takeover. rule.test.ts holds it to the values Python gives, one block long and several.

const M64 = (1n << 64n) - 1n;

const IV: readonly bigint[] = [
  0x6a09e667f3bcc908n,
  0xbb67ae8584caa73bn,
  0x3c6ef372fe94f82bn,
  0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n,
  0x9b05688c2b3e6c1fn,
  0x1f83d9abfb41bd6bn,
  0x5be0cd19137e2179n,
];

const SIGMA: readonly (readonly number[])[] = [
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

const BLOCK = 128;
const DIGEST = 8n;

const rotr = (x: bigint, n: bigint): bigint => ((x >> n) | (x << (64n - n))) & M64;

function compress(h: bigint[], block: Uint8Array, counter: bigint, last: boolean): void {
  const view = new DataView(block.buffer, block.byteOffset, BLOCK);
  const m = Array.from({ length: 16 }, (_, i) => view.getBigUint64(i * 8, true));
  const v = [...h, ...IV];
  v[12] = v[12]! ^ (counter & M64);
  v[13] = v[13]! ^ (counter >> 64n);
  if (last) v[14] = v[14]! ^ M64;

  const mix = (a: number, b: number, c: number, d: number, x: bigint, y: bigint): void => {
    v[a] = (v[a]! + v[b]! + x) & M64;
    v[d] = rotr(v[d]! ^ v[a]!, 32n);
    v[c] = (v[c]! + v[d]!) & M64;
    v[b] = rotr(v[b]! ^ v[c]!, 24n);
    v[a] = (v[a]! + v[b]! + y) & M64;
    v[d] = rotr(v[d]! ^ v[a]!, 16n);
    v[c] = (v[c]! + v[d]!) & M64;
    v[b] = rotr(v[b]! ^ v[c]!, 63n);
  };

  for (let round = 0; round < 12; round++) {
    const s = SIGMA[round % 10]!;
    const w = (i: number): bigint => m[s[i]!]!;
    mix(0, 4, 8, 12, w(0), w(1));
    mix(1, 5, 9, 13, w(2), w(3));
    mix(2, 6, 10, 14, w(4), w(5));
    mix(3, 7, 11, 15, w(6), w(7));
    mix(0, 5, 10, 15, w(8), w(9));
    mix(1, 6, 11, 12, w(10), w(11));
    mix(2, 7, 8, 13, w(12), w(13));
    mix(3, 4, 9, 14, w(14), w(15));
  }
  for (let i = 0; i < 8; i++) h[i] = h[i]! ^ v[i]! ^ v[i + 8]!;
}

/** The 8-byte BLAKE2b digest of `data`, as the bytes `hashlib.blake2b(data, digest_size=8).digest()` returns. */
export function blake2b8(data: Uint8Array): Uint8Array {
  const h = [...IV];
  h[0] = h[0]! ^ 0x01010000n ^ DIGEST;
  let offset = 0;
  // every block but the last is full; the last holds what is left (all of it, zero padded, for an empty input too)
  while (data.length - offset > BLOCK) {
    compress(h, data.subarray(offset, offset + BLOCK), BigInt(offset + BLOCK), false);
    offset += BLOCK;
  }
  const tail = new Uint8Array(BLOCK);
  tail.set(data.subarray(offset));
  compress(h, tail, BigInt(data.length), true);

  const out = new Uint8Array(Number(DIGEST));
  let word = h[0]!;
  for (let i = 0; i < out.length; i++) {
    out[i] = Number(word & 0xffn);
    word >>= 8n;
  }
  return out;
}
