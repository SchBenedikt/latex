// @siglum/engine loads BLAKE3 only as an optional document-cache accelerator.
// Its published browser package omits the wasm-bindgen glue file, so use a
// deterministic non-cryptographic digest here and keep compilation independent
// of that optional cache dependency.
export function hash(value) {
  const text = typeof value === 'string' ? value : new TextDecoder().decode(value);
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ (code + i), 0x85ebca6b);
  }
  const digest = (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
  return { toString: (encoding) => encoding === 'hex' ? digest : digest };
}
