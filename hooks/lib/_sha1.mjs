// SHA-1 in plain JavaScript. A hooks module has no Node and no Bun, and
// `crypto.subtle` can be missing there, so this file imports nothing.

const rotl = (x, n) => (x << n) | (x >>> (32 - n));

/**
 * The SHA-1 digest of `input` as 40 lowercase hex characters. A string is
 * hashed as UTF-8. A `Uint8Array` is hashed as it is.
 */
export function sha1(input) {
  const data =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  // Pad with 0x80, then zeros, then the bit length as a 64-bit big-endian
  // number. The total length is a multiple of 64 bytes.
  const size = (((data.length + 8) >>> 6) + 1) << 6;
  const bytes = new Uint8Array(size);
  bytes.set(data);
  bytes[data.length] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(size - 8, Math.floor(data.length / 0x20000000));
  view.setUint32(size - 4, (data.length << 3) >>> 0);

  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Int32Array(80);
  for (let block = 0; block < size; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(block + i * 4);
    for (let i = 16; i < 80; i++) {
      w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    }
    let [a, b, c, d, e] = h;
    for (let i = 0; i < 80; i++) {
      let f;
      let k;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const next = (rotl(a, 5) + f + e + k + w[i]) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = next;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
  }
  return h.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
}
