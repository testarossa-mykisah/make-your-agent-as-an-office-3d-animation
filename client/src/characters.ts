// Karakter pixel imut digambar prosedural di canvas 16x16 (diskalakan ke
// 128px, NearestFilter di sisi Three.js agar tetap pixelated). Setiap
// charKey punya siluet/aksesori berbeda sesuai provider-nya.

const GRID = 16;
const SCALE = 8;

function shade(hex: string, factor: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * factor)));
  const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * factor)));
  const b = Math.min(255, Math.max(0, Math.round((n & 255) * factor)));
  return `rgb(${r},${g},${b})`;
}

type Painter = (x: number, y: number, w: number, h: number, c: string) => void;

function drawBase(p: Painter, color: string) {
  const dark = shade(color, 0.72);
  const darker = shade(color, 0.5);
  const ink = "#241F18";
  // Kepala
  p(5, 3, 6, 1, color);
  p(4, 4, 8, 1, color);
  p(3, 5, 10, 5, color);
  p(4, 10, 8, 1, color);
  // Telinga/pipi samping
  p(3, 6, 1, 3, dark);
  p(12, 6, 1, 3, dark);
  // Badan + lengan
  p(5, 11, 6, 3, dark);
  p(6, 12, 4, 2, shade(color, 1.12));
  p(3, 11, 2, 2, color);
  p(11, 11, 2, 2, color);
  // Kaki
  p(4, 14, 3, 1, ink);
  p(9, 14, 3, 1, ink);
  // Mata besar
  p(5, 6, 2, 3, ink);
  p(9, 6, 2, 3, ink);
  p(5, 6, 1, 1, "#FFFFFF");
  p(9, 6, 1, 1, "#FFFFFF");
  // Mulut kecil
  p(7, 9, 2, 1, darker);
  // Blush
  p(3, 8, 2, 1, "#FF9DB0");
  p(11, 8, 2, 1, "#FF9DB0");
}

function drawAccessory(p: Painter, charKey: string, color: string) {
  const dark = shade(color, 0.55);
  switch (charKey) {
    case "robot": {
      // Antena + penutup telinga robot
      p(7, 1, 2, 2, "#55504A");
      p(6, 0, 4, 1, "#FFE14D");
      p(7, 0, 2, 1, "#FFF3A0");
      p(2, 6, 1, 3, "#55504A");
      p(13, 6, 1, 3, "#55504A");
      p(2, 7, 1, 1, "#FFE14D");
      p(13, 7, 1, 1, "#FFE14D");
      break;
    }
    case "book": {
      // Buku terbuka di depan badan
      p(4, 11, 8, 4, dark);
      p(5, 11, 3, 3, "#FBF8F0");
      p(8, 11, 3, 3, "#FBF8F0");
      p(5, 12, 2, 1, "#C9C2B2");
      p(9, 12, 2, 1, "#C9C2B2");
      p(5, 13, 2, 1, "#C9C2B2");
      break;
    }
    case "star": {
      // Bintang di kepala + bintang kecil di samping
      p(11, 0, 1, 1, "#FFE14D");
      p(10, 1, 3, 1, "#FFE14D");
      p(11, 2, 1, 1, "#FFE14D");
      p(10, 0, 1, 1, "#FFF3A0");
      p(1, 4, 1, 1, "#FFE14D");
      p(0, 5, 3, 1, "#FFE14D");
      p(1, 6, 1, 1, "#FFE14D");
      break;
    }
    case "spark": {
      // Percikan di kedua sisi kepala
      p(1, 1, 1, 3, "#FFF3A0");
      p(0, 2, 3, 1, "#FFF3A0");
      p(14, 3, 1, 3, "#FFF3A0");
      p(13, 4, 3, 1, "#FFF3A0");
      p(1, 8, 1, 1, "#FFE14D");
      p(14, 9, 1, 1, "#FFE14D");
      break;
    }
    case "visor": {
      // Visor gelap menutupi mata + kilau kaca
      p(3, 6, 10, 3, "#17140F");
      p(4, 6, 4, 1, "#8FD8FF");
      p(10, 8, 2, 1, "#3A352C");
      break;
    }
    case "whale": {
      // Semburan air di atas kepala + sirip samping
      p(7, 0, 1, 1, "#8FD8FF");
      p(5, 1, 1, 1, "#8FD8FF");
      p(9, 1, 1, 1, "#8FD8FF");
      p(7, 1, 1, 2, "#8FD8FF");
      p(2, 11, 1, 2, dark);
      p(13, 11, 1, 2, dark);
      p(6, 13, 4, 1, shade(color, 1.25));
      break;
    }
    case "scarf": {
      // Syal kuning melingkari leher, ujungnya menjuntai
      p(4, 10, 8, 2, "#FFD93D");
      p(4, 10, 8, 1, "#F4B942");
      p(10, 12, 2, 3, "#FFD93D");
      p(10, 14, 2, 1, "#F4B942");
      break;
    }
    case "wind": {
      // Hembusan angin di kedua sisi
      p(0, 6, 3, 1, "#CFEFFF");
      p(1, 7, 2, 1, "#CFEFFF");
      p(13, 5, 3, 1, "#CFEFFF");
      p(13, 6, 2, 1, "#CFEFFF");
      p(0, 12, 2, 1, "#CFEFFF");
      p(14, 11, 2, 1, "#CFEFFF");
      break;
    }
    default: {
      // Topi kecil untuk agen kustom
      p(5, 2, 6, 1, dark);
      p(4, 3, 8, 1, dark);
      break;
    }
  }
}

export function makeCharacterCanvas(charKey: string, color: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = GRID * SCALE;
  canvas.height = GRID * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const p: Painter = (x, y, w, h, c) => {
    ctx.fillStyle = c;
    ctx.fillRect(x * SCALE, y * SCALE, w * SCALE, h * SCALE);
  };
  drawBase(p, color);
  drawAccessory(p, charKey, color);
  return canvas;
}

const urlCache = new Map<string, string>();

export function characterDataUrl(charKey: string, color: string): string {
  const key = `${charKey}|${color}`;
  const hit = urlCache.get(key);
  if (hit) return hit;
  const url = makeCharacterCanvas(charKey, color).toDataURL();
  urlCache.set(key, url);
  return url;
}
