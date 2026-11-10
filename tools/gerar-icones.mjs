// Gera os ícones PNG da extensão sem dependências (node tools/gerar-icones.mjs).
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROXO = [91, 75, 219];
const BRANCO = [255, 255, 255];

// "?" em grade 5x7
const INTERROGACAO = ["01110", "10001", "00001", "00110", "00100", "00000", "00100"];

function cor(x, y, n) {
  // coordenadas normalizadas 0..1
  const u = x / n, v = y / n;
  // quadrado arredondado
  const r = 0.22, m = 0.02;
  const cx = Math.min(Math.max(u, m + r), 1 - m - r);
  const cy = Math.min(Math.max(v, m + r), 1 - m - r);
  if (Math.hypot(u - cx, v - cy) > r) return null;
  // "?" branco no centro
  const gx = Math.floor((u - 0.25) / 0.1), gy = Math.floor((v - 0.15) / 0.1);
  if (gx >= 0 && gx < 5 && gy >= 0 && gy < 7 && INTERROGACAO[gy][gx] === "1") return BRANCO;
  return ROXO;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(tipo, dados) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(dados.length);
  const td = Buffer.concat([Buffer.from(tipo), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(n) {
  const SS = 4; // supersampling para bordas suaves
  const linhas = [];
  for (let y = 0; y < n; y++) {
    const linha = Buffer.alloc(1 + n * 4);
    for (let x = 0; x < n; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const c = cor((x + (sx + 0.5) / SS) * 1, (y + (sy + 0.5) / SS) * 1, n);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
        }
      const o = 1 + x * 4;
      if (a) { linha[o] = r / a; linha[o + 1] = g / a; linha[o + 2] = b / a; }
      linha[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
    linhas.push(linha);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0);
  ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(linhas))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(join(raiz, "icons"), { recursive: true });
for (const n of [16, 32, 48, 128]) writeFileSync(join(raiz, "icons", `icon${n}.png`), png(n));
console.log("Ícones gerados em icons/");
