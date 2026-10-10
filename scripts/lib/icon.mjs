// Icona dell'app generata via codice (PNG senza dipendenze): campo scuro, cerchio di centrocampo e linea mediana.
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function renderIcon(size) {
  const background = [21, 28, 24];
  const ink = [184, 239, 101];
  const grid = [32, 43, 37];
  const samples = 4;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const center = size / 2;
  const ringRadius = size * 0.27;
  const ringWidth = size * 0.055;
  const dotRadius = size * 0.045;
  const lineWidth = size * 0.03;
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      let coverage = 0;
      let gridCoverage = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;
          const distance = Math.hypot(px - center, py - center);
          const onRing = Math.abs(distance - ringRadius) <= ringWidth / 2;
          const onDot = distance <= dotRadius;
          const onLine = Math.abs(px - center) <= lineWidth / 2 && (py < center - ringRadius - ringWidth || py > center + ringRadius + ringWidth);
          if (onRing || onDot || onLine) coverage += 1;
          else if (Math.abs(py % (size / 8)) < size / 220) gridCoverage += 1;
        }
      }
      const total = samples * samples;
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const base = background[channel] + (grid[channel] - background[channel]) * (gridCoverage / total);
        raw[offset + channel] = Math.round(base + (ink[channel] - base) * (coverage / total));
      }
      raw[offset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
