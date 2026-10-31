import { describe, expect, it } from "vitest";

import { blake2bHex } from "./blake2b";

const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);

// From Python's hashlib, as kernel/ids.py computes it.
const VECTORS: [string, Uint8Array, string, string][] = [
  ["nothing", new Uint8Array(0), "cae66941d9efbd404e4d88758ea67670", "786a02f742015903c6c6fd852552d272912f4740e15847618a86e217f71f5419d25e1031afee585313896444934eb04b903a685b1448b755d56f701afe9be2ce"],
  ["abc, the RFC's own", ascii("abc"), "cf4ab791c62b8d2b2109c90275287816", "ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923"],
  ["exactly a block", ascii("x".repeat(128)), "874acca82a22239ec64a3e70c3ae494e", "082b91ea2e15d1556d2ceefdd5af5d64d31b4e01aff1959724578876293825b236ee8079173a0a38160d7d6685d6bca0bfb62c177b3599b8727d9173e2115b91"],
  ["a block and a byte", ascii("x".repeat(129)), "b9ee96f69e8210c624fee55d71d5a54f", "362a53bbe2ec08097b2f358a41d0e153aeed4c132af928400872413650e7bf22f9ae428ff73770170bbd95f935e5dd1953c17de8c7264c72d1f99303bf22dfaa"],
  ["every byte value, over two blocks", Uint8Array.from({ length: 256 }, (_, i) => i), "c2472c0ac37a8dbdb25f05ada0d82643", "1ecc896f34d3f9cac484c73f75f6a5fb58ee6784be41b35f46067b9c65c63a6794d3d744112c653f73dd7deb6666204c5a9bfa5b46081fc10fdbe7884fa5cbf8"],
  ["a long line of a log", ascii("0123456789abcdef".repeat(200).slice(0, 3071)), "f4566dfd35d2a18f735f7d900bf9e729", "896f2ba920c76ec17a10d3f83addb1be9b4d01a8517518395c4808c23ec3983413a94763d365dded1c9126acc5d895b8d3ea08da077cc699c056f884fcc1786e"],
];

describe("blake2b", () => {
  it.each(VECTORS)("gives what hashlib gives for %s", (_name, data, short, full) => {
    expect(blake2bHex(data)).toBe(short);
    expect(blake2bHex(data, 64)).toBe(full);
  });

  it("does not carry anything over from one hash to the next", () => {
    const [, , short] = VECTORS[1];
    blake2bHex(ascii("something else, longer than a block ".repeat(10)));
    expect(blake2bHex(ascii("abc"))).toBe(short);
  });
});
