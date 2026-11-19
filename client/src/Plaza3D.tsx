// Kantor 3D voxel: satu ruangan studio hangat dengan zona kerja (meja per
// agen), zona kopi, zona game, dan area ngobrol. Karakter adalah manusia
// voxel prosedural dari kotak-kotak berengsel (kepala, badan, lengan dengan
// siku, kaki) bertekstur pixel — tanpa model/gambar eksternal.
// Perilaku: saat misi berjalan agen aktif berjalan ke mejanya, duduk, dan
// mengetik; saat idle mereka bergantian ngopi, main game, ngobrol, dsb.
// Klik karakter memilih agen yang sama dengan klik baris roster.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  CSS2DRenderer,
  CSS2DObject,
} from "three/addons/renderers/CSS2DRenderer.js";

export interface PlazaAgent {
  id: number;
  name: string;
  role: string;
  color: string;
  charKey: string;
  active: boolean;
}

export type SceneTheme = "fuji" | "burj" | "space";

interface Plaza3DProps {
  agents: PlazaAgent[];
  theme: SceneTheme;
  selectedId: number | null;
  workingId: number | null;
  doneIds: number[];
  running: boolean;
  bubble: string | null;
  ambientPaused: boolean;
  reducedMotion: boolean;
  cameraResetNonce: number;
  onSelect: (id: number) => void;
  onError: (message: string) => void;
  onStatuses: (statuses: Record<number, string>) => void;
  onLabelsHidden?: (count: number) => void;
}

const ACCENT = 0xd6ff3f;
const SKIN = "#EFC39E";

/* Nama pendek satu baris untuk label 3D: nama + role lengkap tetap tampil
   utuh di panel Roster dan kartu detail agen. */
const SHORT_NAMES: Record<string, string> = {
  "GPT-5": "GPT-5",
  "Claude Sonnet 4.5": "Claude",
  "Gemini 2.5 Pro": "Gemini",
  "Muse Wonder": "Muse",
  "Grok 4": "Grok",
  "DeepSeek R1": "DeepSeek",
  "Qwen3-Max": "Qwen",
  "Mistral Large": "Mistral",
};
function shortName(name: string): string {
  return SHORT_NAMES[name] ?? name.split(" ")[0] ?? name;
}

/* Status singkat untuk label 3D; status lengkap tetap dipakai di roster. */
const SHORT_STATUS: Record<string, string> = {
  "Bekerja — mengetik": "Mengetik",
  "Menuju meja kerja": "Ke meja",
  "Menunggu giliran": "Menunggu",
  "Berpindah tempat": "Berpindah",
};
function shortStatus(status: string): string {
  return SHORT_STATUS[status] ?? status;
}

/* Material kotak ketuk tak terlihat: area raycast yang toleran di sekeliling
   karakter, agar ketukan jari di HP mudah mengenai agen. */
const hitMaterial = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0,
  depthWrite: false,
});

/* ---------- util ---------- */

function shade(hex: string, factor: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * factor)));
  const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * factor)));
  const b = Math.min(255, Math.max(0, Math.round((n & 255) * factor)));
  return `rgb(${r},${g},${b})`;
}

function yawToward(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z);
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/* ---------- tekstur pixel prosedural ---------- */

function woodTexture(
  tones: string[] = ["#8A6844", "#7E5E3C", "#93714B", "#85653F"],
  seam = "#5D422A",
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d");
  if (g) {
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 2; col++) {
        g.fillStyle = tones[(row * 2 + col) % tones.length] ?? "#8A6844";
        g.fillRect(col * 128, row * 64, 128, 64);
        // serat kayu pixel
        g.fillStyle = "rgba(60,40,20,0.18)";
        for (let i = 0; i < 7; i++) {
          const y = row * 64 + 6 + ((i * 37 + col * 13) % 52);
          g.fillRect(col * 128 + ((i * 53) % 90), y, 26 + ((i * 29) % 30), 2);
        }
      }
      g.fillStyle = seam;
      g.fillRect(0, row * 64, 256, 3);
    }
    g.fillStyle = seam;
    g.fillRect(128, 0, 3, 128);
    g.fillRect(0, 128 + 64, 3, 64);
    g.fillRect(128, 128, 3, 64);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* Generator acak ber-seed agar tekstur prosedural konsisten antar render. */
function seededRand(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function canvasTex(
  c: HTMLCanvasElement,
  rx: number,
  ry: number,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(rx, ry);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function marbleTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "#E9E1CF";
    g.fillRect(0, 0, 256, 256);
    const rnd = seededRand(4211);
    // urat marmer halus
    for (let i = 0; i < 26; i++) {
      g.strokeStyle =
        i % 5 === 0 ? "rgba(178,148,92,0.20)" : "rgba(122,110,88,0.16)";
      g.lineWidth = 1 + rnd() * 1.6;
      g.beginPath();
      let x = rnd() * 256;
      let y = rnd() * 256;
      g.moveTo(x, y);
      for (let s = 0; s < 4; s++) {
        x += (rnd() - 0.5) * 90;
        y += rnd() * 46;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // nat ubin besar
    g.fillStyle = "#C4B494";
    g.fillRect(0, 0, 256, 3);
    g.fillRect(0, 128, 256, 3);
    g.fillRect(0, 0, 3, 256);
    g.fillRect(128, 0, 3, 256);
    g.fillStyle = "rgba(255,255,255,0.20)";
    g.fillRect(0, 3, 256, 2);
    g.fillRect(0, 131, 256, 2);
  }
  return canvasTex(c, 3, 2);
}

function metalFloorTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "#242E40";
    g.fillRect(0, 0, 256, 256);
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const v = ((row * 3 + col * 7) % 3) - 1;
        g.fillStyle = `rgb(${38 + v * 4},${48 + v * 4},${66 + v * 5})`;
        g.fillRect(col * 128 + 3, row * 128 + 3, 122, 122);
        // paku keling di sudut panel
        g.fillStyle = "#46536E";
        for (const [rx, ry] of [
          [12, 12],
          [116, 12],
          [12, 116],
          [116, 116],
        ] as const) {
          g.beginPath();
          g.arc(col * 128 + rx, row * 128 + ry, 3, 0, Math.PI * 2);
          g.fill();
        }
        // garis alur panel
        g.fillStyle = "rgba(140,170,220,0.10)";
        g.fillRect(col * 128 + 14, row * 128 + 62, 100, 3);
      }
    }
    g.fillStyle = "#12161F";
    g.fillRect(0, 0, 256, 3);
    g.fillRect(0, 128, 256, 3);
    g.fillRect(0, 0, 3, 256);
    g.fillRect(128, 0, 3, 256);
  }
  return canvasTex(c, 3, 2);
}

function shojiTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "#EFE4CC";
    g.fillRect(0, 0, 256, 256);
    // serat kertas halus
    const rnd = seededRand(977);
    g.fillStyle = "rgba(160,130,90,0.08)";
    for (let i = 0; i < 40; i++) {
      g.fillRect(rnd() * 256, rnd() * 256, 14 + rnd() * 30, 2);
    }
    // rangka kayu shoji
    g.fillStyle = "#8A6844";
    for (let x = 0; x <= 256; x += 64) g.fillRect(x - 3, 0, 6, 256);
    for (let y = 0; y <= 256; y += 85) g.fillRect(0, y - 3, 256, 6);
    g.fillStyle = "rgba(90,60,30,0.25)";
    for (let x = 0; x <= 256; x += 64) g.fillRect(x + 3, 0, 2, 256);
  }
  return canvasTex(c, 5, 1.6);
}

function burjWallTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "#5E4630";
    g.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 85) {
      // panel kayu gelap dengan tepi atas lebih terang
      g.fillStyle = "#685034";
      g.fillRect(x + 3, 0, 79, 256);
      g.fillStyle = "rgba(255,220,160,0.07)";
      g.fillRect(x + 3, 0, 79, 10);
      // strip kuningan vertikal
      g.fillStyle = "#C9A24B";
      g.fillRect(x, 0, 3, 256);
      g.fillStyle = "rgba(255,240,200,0.5)";
      g.fillRect(x, 0, 1, 256);
    }
    g.fillStyle = "#C9A24B";
    g.fillRect(0, 40, 256, 3);
    g.fillStyle = "rgba(30,20,10,0.35)";
    g.fillRect(0, 250, 256, 6);
  }
  return canvasTex(c, 5, 1.6);
}

function stationWallTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "#2E394E";
    g.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 64) {
      const v = ((x / 64) % 2) * 5;
      g.fillStyle = `rgb(${48 + v},${59 + v},${80 + v})`;
      g.fillRect(x + 2, 2, 60, 252);
      g.fillStyle = "#46536E";
      for (const ry of [12, 244]) {
        g.beginPath();
        g.arc(x + 10, ry, 3, 0, Math.PI * 2);
        g.arc(x + 54, ry, 3, 0, Math.PI * 2);
        g.fill();
      }
    }
    // garis cahaya tipis di dekat atas panel
    g.fillStyle = "rgba(127,227,255,0.85)";
    g.fillRect(0, 30, 256, 3);
    g.fillStyle = "rgba(127,227,255,0.22)";
    g.fillRect(0, 26, 256, 11);
    g.fillStyle = "#171E2C";
    for (let x = 0; x <= 256; x += 64) g.fillRect(x - 2, 0, 4, 256);
    g.fillRect(0, 168, 256, 4);
  }
  return canvasTex(c, 5, 1.6);
}

function floorTexture(theme: SceneTheme): THREE.CanvasTexture {
  if (theme === "burj") return marbleTexture();
  if (theme === "space") return metalFloorTexture();
  return woodTexture(["#A97E50", "#9C7445", "#B38755", "#A27947"], "#77572F");
}

function wallTexture(theme: SceneTheme): THREE.CanvasTexture {
  if (theme === "burj") return burjWallTexture();
  if (theme === "space") return stationWallTexture();
  return shojiTexture();
}

function whiteboardTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 200;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "#F2EFE6";
    g.fillRect(0, 0, 512, 200);
    g.fillStyle = "#1A1813";
    g.fillRect(24, 22, 150, 10);
    g.fillRect(24, 44, 210, 6);
    g.fillRect(24, 58, 180, 6);
    // diagram batang aksen
    const bars = [46, 78, 60, 104, 88];
    bars.forEach((h, i) => {
      g.fillStyle = i === 3 ? "#B8D62E" : "#3A352C";
      g.fillRect(300 + i * 38, 170 - h, 24, h);
    });
    g.fillRect(292, 170, 200, 4);
    // coretan lingkaran + panah
    g.strokeStyle = "#B3261E";
    g.lineWidth = 4;
    g.beginPath();
    g.arc(90, 130, 34, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(140, 130);
    g.lineTo(230, 108);
    g.lineTo(218, 98);
    g.moveTo(230, 108);
    g.lineTo(216, 122);
    g.stroke();
    g.fillStyle = "#6B665C";
    g.fillRect(24, 176, 120, 5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------- definisi tema latar luar ---------- */

interface ThemeDef {
  bg: number;
  fog: number;
  hemiSky: number;
  hemiGround: number;
  hemiInt: number;
  sun: number;
  sunInt: number;
  fill: number;
  fillInt: number;
  exposure: number;
  outer: number;
  wallSide: string;
  deskWood: string;
  deskDark: string;
  frame: string;
  rug: string;
  rugRing: string;
  sofa: string;
  sofaLight: string;
  lounge: string;
  shelf: string;
  counter: string;
  wood: string;
  lampShade: string;
  bulb: number;
  leaf1: string;
  leaf2: string;
  leaf3: string;
  screenGlow: string;
  accentStrip: string;
}

const THEMES: Record<SceneTheme, ThemeDef> = {
  fuji: {
    bg: 0xa8c4d4,
    fog: 0xa8c4d4,
    hemiSky: 0xfff3e0,
    hemiGround: 0x8a6f52,
    hemiInt: 1.0,
    sun: 0xffe9c4,
    sunInt: 1.65,
    fill: 0xffd9a0,
    fillInt: 55,
    exposure: 1.07,
    outer: 0x66754f,
    wallSide: "#D9C6A5",
    deskWood: "#7A5A38",
    deskDark: "#553D24",
    frame: "#5D422A",
    rug: "#3E4A6B",
    rugRing: "#5A6C96",
    sofa: "#8A5A4A",
    sofaLight: "#9C6B58",
    lounge: "#46587F",
    shelf: "#6E5136",
    counter: "#7A5A38",
    wood: "#7A5A38",
    lampShade: "#F2E8D5",
    bulb: 0xffe2b0,
    leaf1: "#4E7A3A",
    leaf2: "#5E8C46",
    leaf3: "#649550",
    screenGlow: "#FFE9C9",
    accentStrip: "#D6FF3F",
  },
  burj: {
    bg: 0x3a2418,
    fog: 0x3a2418,
    hemiSky: 0xffdfae,
    hemiGround: 0x4a3421,
    hemiInt: 0.9,
    sun: 0xffc98a,
    sunInt: 1.85,
    fill: 0xffbf80,
    fillInt: 60,
    exposure: 1.1,
    outer: 0x241a12,
    wallSide: "#7D6248",
    deskWood: "#4A3626",
    deskDark: "#2E2015",
    frame: "#8C6B42",
    rug: "#1F4D3A",
    rugRing: "#C9A24B",
    sofa: "#1F4D3A",
    sofaLight: "#2A5F49",
    lounge: "#1F4D3A",
    shelf: "#4A3626",
    counter: "#E8E0D0",
    wood: "#4A3626",
    lampShade: "#8C6B42",
    bulb: 0xffc98a,
    leaf1: "#4E7A34",
    leaf2: "#5E8C3E",
    leaf3: "#6B9A48",
    screenGlow: "#FFD9A0",
    accentStrip: "#C9A24B",
  },
  space: {
    bg: 0x05070d,
    fog: 0x05070d,
    hemiSky: 0xbdd4ff,
    hemiGround: 0x141c2a,
    hemiInt: 0.62,
    sun: 0xd6e6ff,
    sunInt: 1.25,
    fill: 0x9fd0ff,
    fillInt: 34,
    exposure: 0.98,
    outer: 0x05070d,
    wallSide: "#39445A",
    deskWood: "#2C3648",
    deskDark: "#1B2333",
    frame: "#4A5872",
    rug: "#1C2739",
    rugRing: "#2E4258",
    sofa: "#232E42",
    sofaLight: "#2C3A52",
    lounge: "#232E42",
    shelf: "#2C3648",
    counter: "#232E42",
    wood: "#2C3648",
    lampShade: "#1B2333",
    bulb: 0xbfe0ff,
    leaf1: "#2F7A52",
    leaf2: "#3A9163",
    leaf3: "#45A873",
    screenGlow: "#8FE8FF",
    accentStrip: "#D6FF3F",
  },
};

/* ---------- lukisan pemandangan luar (tekstur canvas prosedural) ---------- */

function drawFujiView(g: CanvasRenderingContext2D, w: number, h: number) {
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#BFD9E8");
  sky.addColorStop(0.55, "#F3E3C8");
  sky.addColorStop(1, "#F9EEDD");
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  // cahaya matahari pagi
  const sun = g.createRadialGradient(w * 0.78, h * 0.2, 8, w * 0.78, h * 0.2, 190);
  sun.addColorStop(0, "rgba(255,236,190,0.95)");
  sun.addColorStop(1, "rgba(255,236,190,0)");
  g.fillStyle = sun;
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#FFEFC4";
  g.beginPath();
  g.arc(w * 0.78, h * 0.2, 26, 0, Math.PI * 2);
  g.fill();
  // perbukitan jauh
  g.fillStyle = "#8AA3B5";
  g.beginPath();
  g.moveTo(0, h * 0.78);
  g.lineTo(w * 0.22, h * 0.62);
  g.lineTo(w * 0.45, h * 0.76);
  g.lineTo(w * 0.7, h * 0.6);
  g.lineTo(w, h * 0.74);
  g.lineTo(w, h);
  g.lineTo(0, h);
  g.closePath();
  g.fill();
  // Gunung Fuji
  g.fillStyle = "#5E7791";
  g.beginPath();
  g.moveTo(w * 0.13, h * 0.86);
  g.lineTo(w * 0.5, h * 0.16);
  g.lineTo(w * 0.87, h * 0.86);
  g.closePath();
  g.fill();
  // tudung salju bergerigi
  g.fillStyle = "#F8F4EC";
  g.beginPath();
  g.moveTo(w * 0.415, h * 0.335);
  g.lineTo(w * 0.5, h * 0.16);
  g.lineTo(w * 0.585, h * 0.335);
  g.lineTo(w * 0.555, h * 0.30);
  g.lineTo(w * 0.53, h * 0.36);
  g.lineTo(w * 0.5, h * 0.315);
  g.lineTo(w * 0.47, h * 0.365);
  g.lineTo(w * 0.445, h * 0.30);
  g.closePath();
  g.fill();
  // kabut tipis berlapis
  g.fillStyle = "rgba(255,252,246,0.35)";
  g.fillRect(0, h * 0.52, w, h * 0.07);
  g.fillStyle = "rgba(255,252,246,0.28)";
  g.fillRect(0, h * 0.68, w, h * 0.06);
  // taman zen di kaki jendela
  g.fillStyle = "#D9C9A3";
  g.fillRect(0, h * 0.88, w, h * 0.12);
  g.fillStyle = "#9A938A";
  for (const [rx, ry, rr] of [
    [0.16, 0.93, 16],
    [0.2, 0.95, 11],
    [0.83, 0.94, 13],
  ] as const) {
    g.beginPath();
    g.ellipse(w * rx, h * ry, rr, rr * 0.62, 0, 0, Math.PI * 2);
    g.fill();
  }
  // pinus kecil kanan
  g.fillStyle = "#5D422A";
  g.fillRect(w * 0.9, h * 0.74, 7, h * 0.16);
  g.fillStyle = "#3E6B3A";
  for (const [px, py, pr] of [
    [0.905, 0.72, 34],
    [0.885, 0.66, 24],
    [0.925, 0.67, 22],
  ] as const) {
    g.beginPath();
    g.ellipse(w * px, h * py, pr, pr * 0.5, 0, 0, Math.PI * 2);
    g.fill();
  }
  // ranting sakura dari sudut kiri atas
  g.strokeStyle = "#4E3423";
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(-6, h * 0.06);
  g.quadraticCurveTo(w * 0.12, h * 0.1, w * 0.2, h * 0.2);
  g.stroke();
  const rnd = seededRand(5150);
  for (const [bx, by] of [
    [0.03, 0.08],
    [0.09, 0.1],
    [0.15, 0.15],
    [0.19, 0.21],
  ] as const) {
    for (let i = 0; i < 16; i++) {
      g.fillStyle = i % 3 === 0 ? "#EEA3B8" : "#F4C3D2";
      g.beginPath();
      g.arc(
        w * bx + (rnd() - 0.5) * 52,
        h * by + (rnd() - 0.5) * 34,
        5 + rnd() * 6,
        0,
        Math.PI * 2,
      );
      g.fill();
    }
  }
}

function drawBurjView(g: CanvasRenderingContext2D, w: number, h: number) {
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#4A2C20");
  sky.addColorStop(0.45, "#8A4A26");
  sky.addColorStop(0.78, "#D98A3D");
  sky.addColorStop(1, "#F2B25C");
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  // matahari senja rendah
  const sun = g.createRadialGradient(w * 0.24, h * 0.66, 6, w * 0.24, h * 0.66, 210);
  sun.addColorStop(0, "rgba(255,214,150,0.95)");
  sun.addColorStop(1, "rgba(255,214,150,0)");
  g.fillStyle = sun;
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#FFDCA6";
  g.beginPath();
  g.arc(w * 0.24, h * 0.66, 24, 0, Math.PI * 2);
  g.fill();
  const rnd = seededRand(7331);
  // siluet kota jauh
  g.fillStyle = "#6B3A24";
  let x = 0;
  while (x < w) {
    const bw = 26 + rnd() * 46;
    const bh = h * (0.1 + rnd() * 0.14);
    g.fillRect(x, h - bh, bw, bh);
    x += bw + 4;
  }
  // Burj Khalifa: menara meruncing bertingkat di kanan-tengah
  const bx = w * 0.63;
  g.fillStyle = "#2A170E";
  const tiers: [number, number][] = [
    [0.30, 0.115],
    [0.46, 0.088],
    [0.60, 0.064],
    [0.72, 0.044],
    [0.82, 0.028],
    [0.90, 0.016],
  ];
  for (const [ty, thalf] of tiers) {
    g.fillRect(bx - w * thalf, h * ty, w * thalf * 2, h * (1 - ty));
  }
  g.fillRect(bx - 2, h * 0.035, 4, h * 0.28);
  // jendela menyala di menara
  g.fillStyle = "#FFD9A0";
  for (let i = 0; i < 130; i++) {
    const yy = h * (0.14 + rnd() * 0.8);
    const spread = (1 - yy / h) * w * 0.085 + 3;
    if (rnd() > 0.42) g.fillRect(bx + (rnd() - 0.5) * 2 * spread, yy, 3, 4);
  }
  // siluet kota dekat + jendela menyala
  g.fillStyle = "#1E100A";
  x = -8;
  while (x < w) {
    const bw = 34 + rnd() * 62;
    const bh = h * (0.16 + rnd() * 0.3);
    if (Math.abs(x + bw / 2 - bx) > w * 0.085) {
      g.fillRect(x, h - bh, bw, bh);
      g.fillStyle = "#FFC46B";
      for (let wy = h - bh + 8; wy < h - 10; wy += 13) {
        for (let wx = x + 6; wx < x + bw - 6; wx += 11) {
          if (rnd() > 0.55) g.fillRect(wx, wy, 4, 5);
        }
      }
      g.fillStyle = "#1E100A";
    }
    x += bw + 6;
  }
  g.fillStyle = "#140A06";
  g.fillRect(0, h * 0.965, w, h * 0.035);
}

function drawSpaceView(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = "#04060B";
  g.fillRect(0, 0, w, h);
  const rnd = seededRand(2024);
  // nebula lembut, sangat hemat
  for (const [nx, ny, nr, col] of [
    [0.74, 0.24, 200, "rgba(64,170,180,0.10)"],
    [0.18, 0.16, 150, "rgba(210,110,130,0.06)"],
    [0.5, 0.6, 240, "rgba(50,80,160,0.07)"],
  ] as const) {
    const neb = g.createRadialGradient(w * nx, h * ny, 4, w * nx, h * ny, nr);
    neb.addColorStop(0, col);
    neb.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = neb;
    g.fillRect(0, 0, w, h);
  }
  // bintang
  for (let i = 0; i < 380; i++) {
    const a = 0.25 + rnd() * 0.75;
    g.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
    const s = rnd() > 0.92 ? 2.4 : 1.3;
    g.fillRect(rnd() * w, rnd() * h, s, s);
  }
  // planet kecil kemerahan + cincin tipis
  g.fillStyle = "#C98A5A";
  g.beginPath();
  g.arc(w * 0.82, h * 0.2, 40, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(120,60,30,0.5)";
  g.beginPath();
  g.ellipse(w * 0.805, h * 0.17, 15, 8, 0.4, 0, Math.PI * 2);
  g.ellipse(w * 0.84, h * 0.24, 11, 6, 0.2, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgba(240,230,210,0.35)";
  g.lineWidth = 3;
  g.beginPath();
  g.ellipse(w * 0.82, h * 0.2, 62, 15, -0.32, 0, Math.PI * 2);
  g.stroke();
  // bulan kecil
  g.fillStyle = "#B9C0CC";
  g.beginPath();
  g.arc(w * 0.1, h * 0.14, 15, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(90,100,115,0.6)";
  g.beginPath();
  g.arc(w * 0.095, h * 0.125, 4, 0, Math.PI * 2);
  g.arc(w * 0.108, h * 0.155, 3, 0, Math.PI * 2);
  g.fill();
  // Bumi besar di kiri bawah, sebagian keluar bingkai
  const ex = w * 0.26;
  const ey = h * 1.02;
  const er = h * 0.78;
  const earth = g.createRadialGradient(
    ex - er * 0.35,
    ey - er * 0.4,
    er * 0.1,
    ex,
    ey,
    er,
  );
  earth.addColorStop(0, "#5E9BE8");
  earth.addColorStop(0.55, "#2E6BD8");
  earth.addColorStop(1, "#173F7E");
  g.fillStyle = earth;
  g.beginPath();
  g.arc(ex, ey, er, 0, Math.PI * 2);
  g.fill();
  // daratan
  g.fillStyle = "rgba(74,164,96,0.85)";
  for (const [lx, ly, lr] of [
    [0.2, 0.52, 44],
    [0.3, 0.42, 30],
    [0.13, 0.38, 20],
    [0.36, 0.6, 24],
  ] as const) {
    g.beginPath();
    g.ellipse(ex + (lx - 0.26) * w * 0.5, ey - (0.62 - ly) * h, lr, lr * 0.62, 0.3, 0, Math.PI * 2);
    g.fill();
  }
  // pusaran awan
  g.fillStyle = "rgba(255,255,255,0.5)";
  for (const [cx, cy, cl] of [
    [0.18, 0.34, 66],
    [0.3, 0.5, 84],
    [0.12, 0.55, 52],
    [0.38, 0.3, 44],
  ] as const) {
    g.beginPath();
    g.ellipse(ex + (cx - 0.26) * w * 0.55, ey - (0.62 - cy) * h, cl, cl * 0.26, -0.25, 0, Math.PI * 2);
    g.fill();
  }
  // cahaya tepi atmosfer
  g.strokeStyle = "rgba(159,216,255,0.85)";
  g.lineWidth = 5;
  g.beginPath();
  g.arc(ex, ey, er - 2, Math.PI * 1.05, Math.PI * 1.62);
  g.stroke();
  // rangka stasiun di tepi bawah
  g.fillStyle = "#0B0F16";
  g.fillRect(0, h - 16, w, 16);
  g.fillStyle = "#1A2333";
  for (let tx = 10; tx < w; tx += 64) {
    g.fillRect(tx, h - 16, 5, 16);
  }
}

function viewTexture(theme: SceneTheme): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 512;
  const g = c.getContext("2d");
  if (g) {
    if (theme === "fuji") drawFujiView(g, 1024, 512);
    else if (theme === "burj") drawBurjView(g, 1024, 512);
    else drawSpaceView(g, 1024, 512);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* Potongan tekstur pemandangan untuk satu jendela: berbagi gambar canvas
   yang sama, hanya geseran tampilannya yang berbeda antar jendela. */
function viewSlice(
  base: THREE.CanvasTexture,
  offset: number,
  span: number,
  opts?: { spanY?: number; offsetY?: number; mirror?: boolean },
): THREE.CanvasTexture {
  const t = base.clone();
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  const spanY = opts?.spanY ?? 1;
  const offsetY = opts?.offsetY ?? 0;
  if (opts?.mirror) {
    // Repeat negatif membalik lukisan secara horizontal; jendela kembar
    // di dinding belakang menampilkan sisi lain lembah/kota yang sama
    // tanpa menduplikasi gambar yang identik.
    t.repeat.set(-span, spanY);
    t.offset.set(offset + span, offsetY);
  } else {
    t.repeat.set(span, spanY);
    t.offset.set(offset, offsetY);
  }
  t.needsUpdate = true;
  return t;
}

/* ---------- material & kotak ---------- */

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function stdMat(color: string | number, roughness = 0.9): THREE.MeshStandardMaterial {
  const key = `${color}|${roughness}`;
  const hit = matCache.get(key);
  if (hit) return hit;
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
  matCache.set(key, m);
  return m;
}

function box(
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/* ---------- rig karakter humanoid voxel ---------- */

interface CharRig {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  foreL: THREE.Group;
  foreR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  mug: THREE.Group;
  controller: THREE.Group;
  phone: THREE.Mesh;
  steam: THREE.Group;
  steamPuffs: THREE.Mesh[];
  ring: THREE.Mesh;
  mats: THREE.MeshStandardMaterial[];
}

function buildCharacter(charKey: string, colorHex: string): CharRig {
  const mats: THREE.MeshStandardMaterial[] = [];
  const own = (color: string, rough = 0.85) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
    mats.push(m);
    return m;
  };
  const skin = own(SKIN);
  const hair = own(shade(colorHex, 0.72));
  const shirt = own(colorHex);
  const shirtDark = own(shade(colorHex, 0.78));
  const pants = own(shade(colorHex, 0.45));
  const dark = own("#241F18");
  const white = own("#FBF8F0");
  const yellow = own("#FFD93D");
  const grey = own("#55504A");
  const cyan = own("#8FD8FF");
  const pink = own("#FF9DB0");

  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.54;
  root.add(body);

  // Kaki (pivot di pinggul, di dalam grup body agar ikut turun saat duduk)
  const makeLeg = (side: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(0.14 * side, 0, 0);
    pivot.add(box(0.21, 0.54, 0.24, pants, 0, -0.27, 0));
    pivot.add(box(0.22, 0.1, 0.31, dark, 0, -0.5, 0.035));
    body.add(pivot);
    return pivot;
  };
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  // Badan
  body.add(box(0.64, 0.56, 0.36, shirt, 0, 0.28, 0));
  body.add(box(0.66, 0.1, 0.38, shirtDark, 0, 0.05, 0));

  // Kepala (pivot di leher)
  const head = new THREE.Group();
  head.position.y = 0.6;
  body.add(head);
  head.add(box(0.6, 0.54, 0.56, skin, 0, 0.3, 0));
  // Rambut: atas, belakang, samping
  head.add(box(0.64, 0.15, 0.6, hair, 0, 0.6, 0));
  head.add(box(0.64, 0.42, 0.1, hair, 0, 0.4, -0.25));
  head.add(box(0.09, 0.3, 0.56, hair, -0.29, 0.42, 0));
  head.add(box(0.09, 0.3, 0.56, hair, 0.29, 0.42, 0));
  // Wajah
  head.add(box(0.07, 0.12, 0.02, dark, -0.13, 0.32, 0.285));
  head.add(box(0.07, 0.12, 0.02, dark, 0.13, 0.32, 0.285));
  head.add(box(0.03, 0.03, 0.021, white, -0.145, 0.36, 0.286));
  head.add(box(0.03, 0.03, 0.021, white, 0.115, 0.36, 0.286));
  head.add(box(0.1, 0.03, 0.02, dark, 0, 0.15, 0.285));
  head.add(box(0.09, 0.05, 0.02, pink, -0.22, 0.21, 0.285));
  head.add(box(0.09, 0.05, 0.02, pink, 0.22, 0.21, 0.285));

  // Lengan (pivot bahu + pivot siku)
  const makeArm = (side: number) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.41 * side, 0.5, 0);
    shoulder.add(box(0.19, 0.4, 0.21, shirt, 0, -0.2, 0));
    const elbow = new THREE.Group();
    elbow.position.y = -0.4;
    elbow.add(box(0.16, 0.36, 0.18, skin, 0, -0.18, 0));
    elbow.add(box(0.17, 0.1, 0.19, skin, 0, -0.4, 0));
    shoulder.add(elbow);
    body.add(shoulder);
    return { shoulder, elbow };
  };
  const aL = makeArm(-1);
  const aR = makeArm(1);

  // Properti aktivitas (disembunyikan kecuali dipakai)
  const mug = new THREE.Group();
  const mugBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.06, 0.13, 10),
    own("#FBF8F0"),
  );
  mugBody.castShadow = true;
  mug.add(mugBody);
  mug.add(box(0.03, 0.07, 0.07, white, 0.085, 0, 0));
  mug.position.set(0, -0.46, 0.06);
  mug.visible = false;
  aR.elbow.add(mug);

  const phone = box(0.05, 0.21, 0.13, dark, 0, -0.47, 0.07);
  const phoneScreen = new THREE.MeshStandardMaterial({
    color: "#101418",
    emissive: new THREE.Color("#9FD8FF"),
    emissiveIntensity: 0.7,
    roughness: 0.4,
  });
  mats.push(phoneScreen);
  const phoneGlow = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.17, 0.1), phoneScreen);
  phoneGlow.position.set(0, -0.47, 0.085);
  aR.elbow.add(phoneGlow);
  phone.visible = false;
  phoneGlow.visible = false;
  aR.elbow.add(phone);
  (phone as THREE.Mesh).userData.glow = phoneGlow;

  const controller = new THREE.Group();
  controller.add(box(0.36, 0.12, 0.19, dark, 0, 0, 0));
  controller.add(box(0.05, 0.05, 0.05, own("#E5484D"), 0.09, 0.07, 0.03));
  controller.add(box(0.05, 0.05, 0.05, yellow, 0.15, 0.07, -0.03));
  controller.position.set(0, 0.3, 0.32);
  controller.visible = false;
  body.add(controller);

  // Uap kopi: tiga kepulan kecil di dekat cangkir/mulut
  const steam = new THREE.Group();
  const steamPuffs: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const puff = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.07, 0.07),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 }),
    );
    steam.add(puff);
    steamPuffs.push(puff);
  }
  steam.position.set(0.3, 1.3, 0.3);
  steam.visible = false;
  root.add(steam);

  // Aksesori khas per charKey
  if (charKey === "robot") {
    head.add(box(0.05, 0.2, 0.05, grey, 0, 0.72, 0));
    const tip = new THREE.MeshStandardMaterial({
      color: "#FFE14D",
      emissive: new THREE.Color("#FFE14D"),
      emissiveIntensity: 0.55,
      roughness: 0.5,
    });
    mats.push(tip);
    head.add(box(0.13, 0.13, 0.13, tip, 0, 0.88, 0));
    head.add(box(0.09, 0.26, 0.32, grey, -0.35, 0.3, 0));
    head.add(box(0.09, 0.26, 0.32, grey, 0.35, 0.3, 0));
    head.add(box(0.1, 0.1, 0.1, yellow, -0.35, 0.3, 0));
    head.add(box(0.1, 0.1, 0.1, yellow, 0.35, 0.3, 0));
  } else if (charKey === "book") {
    const bookG = new THREE.Group();
    bookG.add(box(0.46, 0.36, 0.07, shirtDark, 0, 0, 0));
    bookG.add(box(0.4, 0.3, 0.03, white, -0.1, 0, 0.05));
    bookG.add(box(0.4, 0.3, 0.03, white, 0.1, 0, 0.05));
    bookG.position.set(0, 0.24, 0.27);
    bookG.rotation.x = -0.28;
    body.add(bookG);
  } else if (charKey === "star") {
    const starG = new THREE.Group();
    starG.add(box(0.17, 0.17, 0.06, yellow, 0, 0, 0));
    starG.add(box(0.07, 0.3, 0.06, yellow, 0, 0, 0));
    starG.add(box(0.3, 0.07, 0.06, yellow, 0, 0, 0));
    starG.position.set(0.34, 0.72, 0.08);
    head.add(starG);
    head.add(box(0.1, 0.1, 0.05, yellow, -0.38, 0.52, 0.1));
  } else if (charKey === "spark") {
    head.add(box(0.06, 0.26, 0.06, yellow, -0.42, 0.62, 0));
    head.add(box(0.26, 0.06, 0.06, yellow, -0.42, 0.62, 0));
    head.add(box(0.06, 0.22, 0.06, yellow, 0.42, 0.44, 0));
    head.add(box(0.22, 0.06, 0.06, yellow, 0.42, 0.44, 0));
  } else if (charKey === "visor") {
    head.add(box(0.62, 0.17, 0.06, dark, 0, 0.33, 0.29));
    head.add(box(0.3, 0.05, 0.065, cyan, -0.08, 0.36, 0.29));
  } else if (charKey === "whale") {
    head.add(box(0.09, 0.14, 0.09, cyan, 0, 0.78, 0));
    head.add(box(0.08, 0.1, 0.08, cyan, -0.14, 0.72, 0));
    head.add(box(0.08, 0.1, 0.08, cyan, 0.14, 0.72, 0));
    body.add(box(0.42, 0.32, 0.02, own(shade(colorHex, 1.3)), 0, 0.24, 0.19));
  } else if (charKey === "scarf") {
    body.add(box(0.52, 0.13, 0.44, yellow, 0, 0.56, 0));
    body.add(box(0.15, 0.32, 0.05, yellow, 0.19, 0.38, 0.2));
    body.add(box(0.15, 0.08, 0.05, own("#F4B942"), 0.19, 0.2, 0.2));
  } else if (charKey === "wind") {
    head.add(box(0.2, 0.05, 0.05, cyan, -0.44, 0.4, 0));
    head.add(box(0.14, 0.05, 0.05, cyan, -0.4, 0.3, 0));
    head.add(box(0.2, 0.05, 0.05, cyan, 0.44, 0.48, 0));
    head.add(box(0.14, 0.05, 0.05, cyan, 0.4, 0.58, 0));
  } else {
    // Agen kustom: topi netral berwarna agen
    head.add(box(0.64, 0.1, 0.6, shirtDark, 0, 0.62, 0));
    head.add(box(0.5, 0.05, 0.22, shirtDark, 0, 0.58, 0.38));
  }

  // Cincin penanda terpilih / sedang bekerja
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.52, 0.66, 28),
    new THREE.MeshBasicMaterial({ color: ACCENT, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.visible = false;
  root.add(ring);

  root.traverse((o) => {
    o.userData.charRoot = true;
  });

  return {
    root,
    body,
    head,
    armL: aL.shoulder,
    armR: aR.shoulder,
    foreL: aL.elbow,
    foreR: aR.elbow,
    legL,
    legR,
    mug,
    controller,
    phone,
    steam,
    steamPuffs,
    ring,
    mats,
  };
}

/* ---------- layar (monitor / laptop / TV) ---------- */

function makeScreen(w: number, h: number, frameColor: string, glow = "#CFE8FF") {
  const group = new THREE.Group();
  group.add(box(w + 0.08, h + 0.08, 0.05, stdMat(frameColor, 0.6), 0, 0, 0));
  const mat = new THREE.MeshStandardMaterial({
    color: "#14161A",
    emissive: new THREE.Color(glow),
    emissiveIntensity: 0.5,
    roughness: 0.35,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  plane.position.z = 0.031;
  group.add(plane);
  return { group, mat };
}

/* ---------- meja kerja ---------- */

interface DeskInfo {
  chair: THREE.Vector3;
  chairYaw: number;
  standby: THREE.Vector3;
  screenMat: THREE.MeshStandardMaterial;
}

function buildDesk(
  index: number,
  colorHex: string,
  theme: SceneTheme,
): { group: THREE.Group; info: DeskInfo } {
  const def = THEMES[theme];
  const backRow = index < 8;
  const slot = backRow ? index : index - 8;
  const x = -10.5 + slot * 3;
  const z = backRow ? -6.9 : -3.4;
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  if (!backRow) group.rotation.y = Math.PI;

  const wood = stdMat(def.deskWood, 0.8);
  const woodDark = stdMat(def.deskDark, 0.85);
  group.add(box(2.3, 0.09, 1.0, wood, 0, 0.74, 0));
  group.add(box(0.09, 0.74, 0.9, woodDark, -1.05, 0.37, 0));
  group.add(box(0.09, 0.74, 0.9, woodDark, 1.05, 0.37, 0));
  group.add(box(2.1, 0.3, 0.05, woodDark, 0, 0.5, -0.45));

  let screenMat: THREE.MeshStandardMaterial;
  if (index % 2 === 0) {
    // Monitor
    group.add(box(0.14, 0.42, 0.14, stdMat("#2B2721", 0.6), 0, 0.99, -0.3));
    group.add(box(0.5, 0.04, 0.3, stdMat("#2B2721", 0.6), 0, 0.8, -0.3));
    const s = makeScreen(1.0, 0.62, "#2B2721", def.screenGlow);
    s.group.position.set(0, 1.32, -0.3);
    group.add(s.group);
    screenMat = s.mat;
    group.add(box(0.72, 0.04, 0.27, stdMat("#33302A", 0.7), 0, 0.81, 0.16));
  } else {
    // Laptop
    group.add(box(0.64, 0.04, 0.44, stdMat("#3A352C", 0.6), 0, 0.81, 0.08));
    const s = makeScreen(0.62, 0.4, "#3A352C", def.screenGlow);
    s.group.position.set(0, 1.02, -0.13);
    s.group.rotation.x = -0.32;
    group.add(s.group);
    screenMat = s.mat;
  }
  // Mug di meja + tanaman kecil
  const mugMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.05, 0.11, 10),
    stdMat(colorHex, 0.7),
  );
  mugMesh.position.set(0.82, 0.84, 0.12);
  mugMesh.castShadow = true;
  group.add(mugMesh);
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.07, 0.12, 10),
    stdMat("#9A5B47", 0.9),
  );
  pot.position.set(-0.88, 0.85, -0.18);
  group.add(pot);
  group.add(box(0.2, 0.22, 0.2, stdMat("#4E7A3A", 0.95), -0.88, 1.02, -0.18));
  group.add(box(0.14, 0.16, 0.14, stdMat("#5E8C46", 0.95), -0.8, 1.12, -0.12));

  // Kursi (punggung menghadap ruangan, agen duduk menghadap meja)
  const chair = new THREE.Group();
  chair.position.set(0, 0, 0.98);
  const seatMat = stdMat(shade(colorHex, 0.85), 0.85);
  chair.add(box(0.56, 0.08, 0.52, seatMat, 0, 0.45, 0));
  chair.add(box(0.56, 0.62, 0.08, seatMat, 0, 0.82, 0.26));
  chair.add(box(0.08, 0.45, 0.08, stdMat("#2B2721", 0.6), 0, 0.22, 0));
  chair.add(box(0.5, 0.05, 0.5, stdMat("#2B2721", 0.6), 0, 0.03, 0));
  group.add(chair);

  const chairWorld = new THREE.Vector3(x, 0, z + (backRow ? 0.98 : -0.98));
  const standbyWorld = new THREE.Vector3(
    x + (backRow ? 1.05 : -1.05),
    0,
    z + (backRow ? 1.2 : -1.2),
  );
  return {
    group,
    info: {
      chair: chairWorld,
      chairYaw: backRow ? Math.PI : 0,
      standby: standbyWorld,
      screenMat,
    },
  };
}

/* ---------- ruangan kantor ---------- */

function buildRoom(theme: SceneTheme): {
  group: THREE.Group;
  tvMat: THREE.MeshStandardMaterial;
  textures: THREE.CanvasTexture[];
} {
  const def = THEMES[theme];
  const group = new THREE.Group();
  const textures: THREE.CanvasTexture[] = [];

  // Lantai luar (di luar dinding) mengikuti tema + lantai ruangan bertema
  const outer = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 90),
    new THREE.MeshStandardMaterial({ color: def.outer, roughness: 1 }),
  );
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.03;
  group.add(outer);
  const floorTex = floorTexture(theme);
  textures.push(floorTex);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(27, 19),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: theme === "burj" ? 0.45 : 0.9 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // Dinding: bidang satu sisi yang menghadap ke DALAM ruangan. Kamera yang
  // berputar 360 derajat ke belakang/samping dinding melihat menembusnya,
  // jadi ruangan selalu terlihat dari sudut manapun.
  const wallTex = wallTexture(theme);
  textures.push(wallTex);
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(27.6, 6.8),
    new THREE.MeshStandardMaterial({ map: wallTex, roughness: 1 }),
  );
  back.position.set(0, 3.4, -9.7);
  back.receiveShadow = true;
  group.add(back);
  const plaster = stdMat(def.wallSide, 1);
  const left = new THREE.Mesh(new THREE.PlaneGeometry(19.4, 6.8), plaster);
  left.rotation.y = Math.PI / 2;
  left.position.set(-13.7, 3.4, 0);
  left.receiveShadow = true;
  const right = new THREE.Mesh(new THREE.PlaneGeometry(19.4, 6.8), plaster);
  right.rotation.y = -Math.PI / 2;
  right.position.set(13.7, 3.4, 0);
  right.receiveShadow = true;
  group.add(left, right);

  // Pemandangan luar: satu lukisan canvas prosedural per tema.
  const viewTex = viewTexture(theme);
  textures.push(viewTex);

  // Panorama latar: silinder raksasa mengelilingi seluruh ruangan dengan
  // lukisan tema yang sama, jadi pemandangan benar-benar menjadi latar —
  // terlihat di atas dinding, di luar dinding samping, dan ke segala arah
  // saat kamera berputar 360 derajat, bukan hanya lewat jendela. Tanpa
  // silinder ini, area di luar dinding hanya warna datar scene.background
  // dan ruangan terasa tanpa latar sama sekali. Pengulangan cermin
  // (mirrored) membuat sambungan keliling silinder tidak terlihat, dan
  // fog dimatikan agar lukisan tidak pudar oleh kabut scene.
  const bgTex = viewTex.clone();
  bgTex.wrapS = THREE.MirroredRepeatWrapping;
  bgTex.wrapT = THREE.ClampToEdgeWrapping;
  bgTex.repeat.set(2, 1);
  // Geser fase setengah lukisan: puncak gunung / menara utama jatuh tepat
  // di tengah dinding belakang (arah pandang default kamera) dan di sisi
  // depan, bukan pohon pinus di tepi lukisan.
  bgTex.offset.set(0.5, 0);
  bgTex.needsUpdate = true;
  textures.push(bgTex);
  const backdrop = new THREE.Mesh(
    new THREE.CylinderGeometry(34, 34, 46, 48, 1, true),
    new THREE.MeshBasicMaterial({ map: bgTex, side: THREE.BackSide, fog: false }),
  );
  backdrop.position.y = 13.5;
  group.add(backdrop);

  // Jendela-jendela besar menampilkan irisan lukisan yang sama dengan
  // rasio aspek yang dijaga (span dipilih agar lukisan tidak gepeng).
  const frameMat = stdMat(def.frame, 0.8);
  const makeWindow = (
    wdt: number,
    hgt: number,
    offset: number,
    span: number,
    opts?: { spanY?: number; offsetY?: number; mirror?: boolean },
  ): THREE.Group => {
    const win = new THREE.Group();
    const slice = viewSlice(viewTex, offset, span, opts);
    textures.push(slice);
    const view = new THREE.Mesh(
      new THREE.PlaneGeometry(wdt, hgt),
      new THREE.MeshBasicMaterial({ map: slice }),
    );
    win.add(view);
    win.add(box(wdt + 0.16, 0.1, 0.06, frameMat, 0, hgt / 2 + 0.03, 0.02));
    win.add(box(wdt + 0.16, 0.1, 0.06, frameMat, 0, -hgt / 2 - 0.03, 0.02));
    win.add(box(0.1, hgt + 0.16, 0.06, frameMat, -wdt / 2 - 0.03, 0, 0.02));
    win.add(box(0.1, hgt + 0.16, 0.06, frameMat, wdt / 2 + 0.03, 0, 0.02));
    win.add(box(0.07, hgt, 0.05, frameMat, 0, 0, 0.02));
    win.add(box(wdt, 0.07, 0.05, frameMat, 0, 0, 0.02));
    return win;
  };
  // Jendela dinding kiri (aspek 2,7/1,9: span 0,71 menjaga rasio lukisan)
  const leftWinOffsets = [0, 0.29];
  [-5.2, -0.4].forEach((wz, i) => {
    const win = makeWindow(2.7, 1.9, leftWinOffsets[i] ?? 0, 0.71);
    win.position.set(-13.48, 3.15, wz);
    win.rotation.y = Math.PI / 2;
    group.add(win);
  });
  // Jendela panorama besar di dinding belakang, mengapit papan tulis.
  // Keduanya menampilkan seluruh lebar lukisan (span 1, dipotong vertikal
  // 6% dari bawah) agar rasio 6,2/2,9 cocok dengan kanvas 2:1 dan gunung/
  // menara tidak gepeng; jendela kanan dibalik cermin agar tidak identik.
  [-8.4, 8.4].forEach((wx, i) => {
    const win = makeWindow(6.2, 2.9, 0, 1, {
      spanY: 0.94,
      offsetY: 0.06,
      mirror: i === 1,
    });
    win.position.set(wx, 3.45, -9.52);
    group.add(win);
  });
  // Jendela dinding kanan (di atas rak buku)
  const rightWin = makeWindow(2.7, 1.9, 0.15, 0.71);
  rightWin.position.set(13.48, 3.6, -3.6);
  rightWin.rotation.y = -Math.PI / 2;
  group.add(rightWin);

  // Papan tulis misi di dinding belakang
  const board = new THREE.Group();
  board.position.set(0, 3.3, -9.48);
  const boardTex = whiteboardTexture();
  textures.push(boardTex);
  const boardPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(5.2, 2.0),
    new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.6 }),
  );
  board.add(boardPlane);
  const bf = stdMat(def.frame, 0.8);
  board.add(box(5.4, 0.1, 0.06, bf, 0, 1.05, -0.01));
  board.add(box(5.4, 0.1, 0.06, bf, 0, -1.05, -0.01));
  board.add(box(0.1, 2.2, 0.06, bf, -2.7, 0, -0.01));
  board.add(box(0.1, 2.2, 0.06, bf, 2.7, 0, -0.01));
  group.add(board);

  // Karpet tengah
  const rug = new THREE.Mesh(
    new THREE.CircleGeometry(3.1, 36),
    stdMat(def.rug, 1),
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.012, 2.4);
  rug.receiveShadow = true;
  group.add(rug);
  const rugRing = new THREE.Mesh(
    new THREE.RingGeometry(2.75, 3.1, 36),
    stdMat(def.rugRing, 1),
  );
  rugRing.rotation.x = -Math.PI / 2;
  rugRing.position.set(0, 0.014, 2.4);
  group.add(rugRing);

  // --- Zona game (kiri depan): TV + sofa + arcade ---
  const tvStand = box(0.6, 0.5, 2.2, stdMat(def.deskDark, 0.85), -12.85, 0.25, 3.2);
  group.add(tvStand);
  const tv = makeScreen(1.9, 1.12, "#1D1A15");
  tv.group.position.set(-12.8, 1.5, 3.2);
  tv.group.rotation.y = Math.PI / 2;
  tv.mat.emissive.set("#24303A");
  tv.mat.emissiveIntensity = 0.4;
  group.add(tv.group);

  const sofaMat = stdMat(def.sofa, 0.95);
  const sofa = new THREE.Group();
  sofa.position.set(-10.75, 0, 3.2);
  sofa.add(box(0.95, 0.42, 2.3, sofaMat, 0, 0.28, 0));
  sofa.add(box(0.28, 0.85, 2.3, sofaMat, -0.5, 0.55, 0));
  sofa.add(box(0.95, 0.62, 0.26, sofaMat, 0, 0.5, -1.15));
  sofa.add(box(0.95, 0.62, 0.26, sofaMat, 0, 0.5, 1.15));
  sofa.add(box(0.8, 0.14, 1.0, stdMat(def.sofaLight, 0.95), 0.05, 0.55, -0.55));
  sofa.add(box(0.8, 0.14, 1.0, stdMat(def.sofaLight, 0.95), 0.05, 0.55, 0.55));
  group.add(sofa);

  const arcade = new THREE.Group();
  arcade.position.set(-12.55, 0, 7.4);
  arcade.rotation.y = Math.PI / 2;
  arcade.add(box(0.85, 1.75, 0.75, stdMat(theme === "space" ? "#2C3648" : "#2E4A44", 0.7), 0, 0.875, 0));
  const arcScreen = makeScreen(0.55, 0.5, "#1D1A15");
  arcScreen.group.position.set(0, 1.25, 0.39);
  arcScreen.group.rotation.x = -0.25;
  arcScreen.mat.emissive.set("#D6FF3F");
  arcScreen.mat.emissiveIntensity = 0.35;
  arcade.add(arcScreen.group);
  arcade.add(box(0.7, 0.22, 0.05, stdMat("#D6FF3F", 0.6), 0, 1.95, 0.36));
  arcade.add(box(0.6, 0.06, 0.3, stdMat("#1D1A15", 0.6), 0, 0.82, 0.42));
  group.add(arcade);

  // --- Zona kopi (kanan depan): meja bundar, bangku, counter ---
  const coffeeTable = new THREE.Group();
  coffeeTable.position.set(10.2, 0, 3.4);
  const ctTop = new THREE.Mesh(
    new THREE.CylinderGeometry(0.88, 0.88, 0.07, 24),
    stdMat(def.wood, 0.8),
  );
  ctTop.position.y = 0.52;
  ctTop.castShadow = true;
  ctTop.receiveShadow = true;
  coffeeTable.add(ctTop);
  const ctLeg = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.13, 0.52, 10),
    stdMat(def.deskDark, 0.85),
  );
  ctLeg.position.y = 0.26;
  coffeeTable.add(ctLeg);
  const tableMug = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.05, 0.11, 10),
    stdMat("#FBF8F0", 0.7),
  );
  tableMug.position.set(0.3, 0.61, 0.15);
  coffeeTable.add(tableMug);
  if (theme === "fuji") {
    // Set teh di meja kayu: teko + dua cangkir kecil
    const potTea = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 10, 8),
      stdMat("#3E4A6B", 0.6),
    );
    potTea.position.set(-0.25, 0.63, -0.1);
    potTea.castShadow = true;
    coffeeTable.add(potTea);
    for (const [tx, tz] of [
      [0.05, 0.3],
      [-0.05, -0.32],
    ] as const) {
      const cupTea = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.035, 0.06, 10),
        stdMat("#F2EFE6", 0.7),
      );
      cupTea.position.set(tx, 0.59, tz);
      coffeeTable.add(cupTea);
    }
  }
  group.add(coffeeTable);
  for (const [sx, sz] of [
    [9.3, 2.6],
    [11.1, 2.6],
    [9.3, 4.2],
    [11.1, 4.2],
  ] as const) {
    const stool = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.26, 0.1, 14),
      stdMat(def.sofaLight, 0.9),
    );
    stool.position.set(sx, 0.32, sz);
    stool.castShadow = true;
    group.add(stool);
    const sLeg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.07, 0.3, 8),
      stdMat(def.deskDark, 0.85),
    );
    sLeg.position.set(sx, 0.15, sz);
    group.add(sLeg);
  }
  const counter = box(0.95, 0.95, 3.4, stdMat(def.counter, 0.85), 12.95, 0.475, 0.6);
  group.add(counter);
  if (theme === "burj") {
    // Lis kuningan di sisi counter marmer yang menghadap ruangan
    group.add(box(0.04, 0.07, 3.3, stdMat("#C9A24B", 0.45), 12.46, 0.82, 0.6));
  }
  const machine = new THREE.Group();
  machine.position.set(12.9, 0.95, 0.1);
  machine.add(box(0.62, 0.52, 0.72, stdMat("#2B2721", 0.5), 0, 0.26, 0));
  machine.add(box(0.5, 0.1, 0.6, stdMat("#3A352C", 0.5), 0, 0.56, 0));
  const machineLight = new THREE.MeshStandardMaterial({
    color: "#D6FF3F",
    emissive: new THREE.Color("#D6FF3F"),
    emissiveIntensity: 0.8,
  });
  machine.add(box(0.1, 0.05, 0.05, machineLight, -0.2, 0.4, 0.37));
  group.add(machine);
  for (let i = 0; i < 3; i++) {
    const cup = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.04, 0.09, 8),
      stdMat("#FBF8F0", 0.7),
    );
    cup.position.set(12.85, 1.0, 0.75 + i * 0.3);
    group.add(cup);
  }

  // --- Rak buku di dinding kanan ---
  const shelf = new THREE.Group();
  shelf.position.set(13.35, 0, -3.6);
  shelf.rotation.y = -Math.PI / 2;
  const shelfMat = stdMat(def.shelf, 0.85);
  shelf.add(box(3.6, 2.3, 0.32, shelfMat, 0, 1.15, -0.05));
  const bookColors = ["#B465E8", "#4C8DFF", "#E8833A", "#37C978", "#E5484D", "#F4B942", "#00B8A9", "#FF6B9D"];
  for (let s = 0; s < 3; s++) {
    shelf.add(box(3.4, 0.06, 0.36, shelfMat, 0, 0.45 + s * 0.72, 0.05));
    for (let b = 0; b < 9; b++) {
      const h = 0.42 + ((b * 31 + s * 17) % 4) * 0.05;
      shelf.add(
        box(0.16, h, 0.24, stdMat(bookColors[(b + s * 3) % bookColors.length] ?? "#888", 0.9), -1.5 + b * 0.36, 0.48 + s * 0.72 + h / 2, 0.05),
      );
    }
  }
  group.add(shelf);

  // --- Sofa santai tengah-kanan + meja kecil ---
  const lounge = new THREE.Group();
  lounge.position.set(5.8, 0, 6.6);
  lounge.rotation.y = Math.PI;
  const loungeMat = stdMat(def.lounge, 0.95);
  lounge.add(box(2.5, 0.42, 0.95, loungeMat, 0, 0.28, 0));
  lounge.add(box(2.5, 0.8, 0.26, loungeMat, 0, 0.55, -0.42));
  lounge.add(box(0.26, 0.6, 0.95, loungeMat, -1.25, 0.5, 0));
  lounge.add(box(0.26, 0.6, 0.95, loungeMat, 1.25, 0.5, 0));
  group.add(lounge);
  group.add(box(1.1, 0.4, 0.55, stdMat(def.deskDark, 0.85), 5.8, 0.2, 5.2));

  // --- Tanaman sudut (gaya mengikuti tema) ---
  for (const [px, pz] of [
    [-12.6, -8.6],
    [12.6, -8.6],
    [-12.6, 8.8],
    [7.6, -8.8],
  ] as const) {
    const potM = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.24, 0.45, 12),
      stdMat("#9A5B47", 0.9),
    );
    potM.position.set(px, 0.225, pz);
    potM.castShadow = true;
    group.add(potM);
    group.add(box(0.34, 0.5, 0.34, stdMat(def.leaf1, 0.95), px, 0.7, pz));
    group.add(box(0.26, 0.4, 0.26, stdMat(def.leaf2, 0.95), px + 0.18, 0.95, pz + 0.1));
    group.add(box(0.22, 0.34, 0.22, stdMat(def.leaf3, 0.95), px - 0.16, 0.9, pz - 0.08));
  }

  // --- Lampu gantung (gaya mengikuti tema) ---
  for (const lx of [-4.5, 4.5]) {
    const lamp = new THREE.Group();
    lamp.position.set(lx, 0, -2);
    const cord = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 1.1, 6),
      stdMat("#241F18", 0.8),
    );
    cord.position.y = 5.05;
    lamp.add(cord);
    const shadeM = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.42, 0.34, 14, 1, true),
      stdMat(def.lampShade, 0.6),
    );
    shadeM.position.y = 4.42;
    lamp.add(shadeM);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 10, 8),
      new THREE.MeshBasicMaterial({ color: def.bulb }),
    );
    bulb.position.y = 4.3;
    lamp.add(bulb);
    group.add(lamp);
  }

  /* ----- properti khas per tema ----- */
  if (theme === "fuji") {
    // Pohon sakura voxel di sudut depan-kanan
    const tree = new THREE.Group();
    tree.position.set(12.35, 0, 8.55);
    const trunk = stdMat("#5D422A", 0.9);
    tree.add(box(0.22, 1.5, 0.22, trunk, 0, 0.75, 0));
    tree.add(box(0.16, 0.8, 0.16, trunk, 0.35, 1.7, 0.1));
    tree.add(box(0.16, 0.7, 0.16, trunk, -0.3, 1.65, -0.08));
    const petalA = stdMat("#F2B8C6", 0.95);
    const petalB = stdMat("#EEA3B8", 0.95);
    tree.add(box(1.7, 0.55, 1.5, petalA, 0, 2.35, 0));
    tree.add(box(1.2, 0.5, 1.1, petalB, 0.55, 2.7, 0.2));
    tree.add(box(1.1, 0.45, 1.0, petalB, -0.55, 2.65, -0.15));
    tree.add(box(0.8, 0.4, 0.8, petalA, 0.1, 2.95, -0.3));
    const treePot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.34, 0.4, 12),
      stdMat("#3E4A6B", 0.9),
    );
    treePot.position.y = 0.2;
    tree.add(treePot);
    group.add(tree);
    // Bantal lantai di zona santai
    const cushionCols = ["#3E4A6B", "#F2EFE6", "#C96F7B"];
    cushionCols.forEach((col, i) => {
      const cu = box(0.72, 0.13, 0.72, stdMat(col, 0.95), 4.35 + i * 1.45, 0.065, 5.55);
      group.add(cu);
    });
    // Bonsai di atas meja kecil zona santai
    const bonsaiPot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.12, 0.1, 10),
      stdMat("#8A4A3A", 0.9),
    );
    bonsaiPot.position.set(5.8, 0.45, 5.2);
    group.add(bonsaiPot);
    group.add(box(0.07, 0.22, 0.07, stdMat("#5D422A", 0.9), 5.8, 0.6, 5.2));
    group.add(box(0.4, 0.22, 0.34, stdMat("#3E6B3A", 0.95), 5.86, 0.78, 5.2));
  } else if (theme === "burj") {
    // Palem voxel di sudut depan-kanan
    const palm = new THREE.Group();
    palm.position.set(12.35, 0, 8.55);
    const pTrunk = stdMat("#6E5136", 0.9);
    for (let i = 0; i < 5; i++) {
      palm.add(box(0.2, 0.5, 0.2, pTrunk, Math.sin(i * 0.5) * 0.09, 0.25 + i * 0.48, 0));
    }
    const frond = stdMat("#4E7A34", 0.95);
    for (let i = 0; i < 6; i++) {
      const f = box(1.35, 0.07, 0.3, frond, 0, 0, 0);
      const holder = new THREE.Group();
      holder.position.set(0.35, 2.62, 0);
      holder.rotation.y = (i / 6) * Math.PI * 2;
      f.position.set(0.62, -0.08, 0);
      f.rotation.z = -0.38;
      holder.add(f);
      palm.add(holder);
    }
    const palmPot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.32, 0.42, 12),
      stdMat("#8C6B42", 0.7),
    );
    palmPot.position.y = 0.21;
    palm.add(palmPot);
    group.add(palm);
    // Cincin lampu gantung kuningan di tengah ruangan
    const ringLamp = new THREE.Group();
    ringLamp.position.set(0, 4.55, 1.8);
    const ringMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.95, 0.95, 0.07, 28, 1, true),
      stdMat("#C9A24B", 0.4),
    );
    ringLamp.add(ringMesh);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const b = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
      );
      b.position.set(Math.cos(a) * 0.95, -0.1, Math.sin(a) * 0.95);
      ringLamp.add(b);
    }
    const ringCord = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 1.0, 6),
      stdMat("#241F18", 0.8),
    );
    ringCord.position.y = 0.55;
    ringLamp.add(ringCord);
    group.add(ringLamp);
  } else {
    // Strip cahaya tipis di dinding belakang + dinding samping
    const stripMat = new THREE.MeshBasicMaterial({ color: def.accentStrip });
    for (const sx of [-6.5, 6.5]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.05, 0.05), stripMat);
      strip.position.set(sx, 5.62, -9.6);
      group.add(strip);
    }
    // Unit hidroponik bercahaya di sudut depan-kanan
    const hydro = new THREE.Group();
    hydro.position.set(12.3, 0, 8.5);
    hydro.rotation.y = -0.5;
    hydro.add(box(1.1, 2.0, 0.5, stdMat("#1B2333", 0.6), 0, 1.0, 0));
    for (let r = 0; r < 3; r++) {
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.09, 0.85, 10),
        new THREE.MeshStandardMaterial({
          color: "#9FE8FF",
          transparent: true,
          opacity: 0.4,
          roughness: 0.2,
        }),
      );
      tube.rotation.z = Math.PI / 2;
      tube.position.set(0, 0.55 + r * 0.55, 0.28);
      hydro.add(tube);
      const glowPlant = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.16, 0.16),
        new THREE.MeshBasicMaterial({ color: 0x57e88f }),
      );
      glowPlant.position.set(0, 0.55 + r * 0.55, 0.28);
      hydro.add(glowPlant);
    }
    group.add(hydro);
    // Dua kursi kapsul di zona santai
    for (const cx of [4.5, 7.1]) {
      const cap = new THREE.Group();
      cap.position.set(cx, 0, 5.55);
      cap.rotation.y = Math.PI;
      cap.add(box(0.78, 0.35, 0.7, stdMat("#2C3A52", 0.8), 0, 0.32, 0));
      cap.add(box(0.78, 0.95, 0.18, stdMat("#39496B", 0.8), 0, 0.75, -0.3));
      cap.add(box(0.1, 0.2, 0.5, stdMat("#1B2333", 0.7), 0, 0.1, 0));
      group.add(cap);
    }
  }

  return { group, tvMat: tv.mat, textures };
}

/* ---------- spot aktivitas idle ---------- */

type ActivityKind = "coffee" | "game" | "chat" | "stretch" | "phone" | "wander";

interface Spot {
  key: string;
  x: number;
  z: number;
  yaw: number;
  sit: boolean;
}

const COFFEE_TABLE = { x: 10.2, z: 3.4 };
const COFFEE_SPOTS: Spot[] = [
  { key: "coffee0", x: 9.3, z: 2.6, yaw: yawToward(9.3, 2.6, COFFEE_TABLE.x, COFFEE_TABLE.z), sit: false },
  { key: "coffee1", x: 11.1, z: 2.6, yaw: yawToward(11.1, 2.6, COFFEE_TABLE.x, COFFEE_TABLE.z), sit: false },
  { key: "coffee2", x: 9.3, z: 4.2, yaw: yawToward(9.3, 4.2, COFFEE_TABLE.x, COFFEE_TABLE.z), sit: false },
  { key: "coffee3", x: 11.1, z: 4.2, yaw: yawToward(11.1, 4.2, COFFEE_TABLE.x, COFFEE_TABLE.z), sit: false },
];
const GAME_SPOTS: Spot[] = [
  { key: "game0", x: -10.55, z: 2.5, yaw: -Math.PI / 2, sit: true },
  { key: "game1", x: -10.55, z: 3.9, yaw: -Math.PI / 2, sit: true },
  { key: "game2", x: -11.45, z: 7.4, yaw: -Math.PI / 2, sit: false },
];
const CHAT_PAIRS: [Spot, Spot][] = [
  [
    { key: "chat0a", x: -1.7, z: 2.6, yaw: Math.PI / 2, sit: false },
    { key: "chat0b", x: -0.5, z: 2.6, yaw: -Math.PI / 2, sit: false },
  ],
  [
    { key: "chat1a", x: 2.4, z: 5.1, yaw: Math.PI / 2, sit: false },
    { key: "chat1b", x: 3.6, z: 5.1, yaw: -Math.PI / 2, sit: false },
  ],
  [
    { key: "chat2a", x: -3.9, z: 5.8, yaw: Math.PI / 2, sit: false },
    { key: "chat2b", x: -2.7, z: 5.8, yaw: -Math.PI / 2, sit: false },
  ],
];
const STRETCH_SPOTS: Spot[] = [
  { key: "stretch0", x: 0.6, z: 0.4, yaw: 0.3, sit: false },
  { key: "stretch1", x: 5.8, z: 1.2, yaw: -0.4, sit: false },
  { key: "stretch2", x: -6.0, z: 0.8, yaw: 0.2, sit: false },
];
const WAYPOINTS: [number, number][] = [
  [-6, -1.2],
  [6, -0.6],
  [0, 6.8],
  [-8, 6.2],
  [8, 6.8],
  [3, -5.6],
  [-3, -5.9],
  [7.2, 0.6],
  [-7.4, -4.6],
  [1.5, -1.4],
];

const CHAT_LINES = [
  "Kopi di sini enak juga, ya.",
  "Kemarin aku coba game baru, seru!",
  "Nanti istirahat, ngopi lagi kita.",
  "Meja kerjaku akhirnya rapi.",
  "Sudah coba mesin kopi yang baru?",
  "Besok kita main game bareng lagi.",
  "Cuaca lagi enak buat santai.",
];

const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  coffee: "Ngopi",
  game: "Main game",
  chat: "Ngobrol santai",
  stretch: "Peregangan",
  phone: "Cek ponsel",
  wander: "Jalan santai",
};

/* ---------- node agen ---------- */

type Mode =
  | "idle-stand"
  | "idle-walk"
  | "idle-activity"
  | "to-work"
  | "work"
  | "to-standby"
  | "standby"
  | "parked";

interface AgentNode {
  id: number;
  index: number;
  rig: CharRig;
  label: CSS2DObject;
  labelName: HTMLSpanElement;
  labelStatus: HTMLSpanElement;
  bubbleObj: CSS2DObject;
  bubbleEl: HTMLDivElement;
  desk: DeskInfo | null;
  mode: Mode;
  yaw: number;
  targetYaw: number;
  target: THREE.Vector3 | null;
  spot: Spot | null;
  activity: ActivityKind | null;
  activityUntil: number;
  stateUntil: number;
  partnerId: number | null;
  walkPhase: number;
  hurry: number;
  sit: number;
  seed: number;
  firstPick: boolean;
  justSpawned: boolean;
  chatText: string;
  chatBubbleUntil: number;
  nextChatBubble: number;
  status: string;
  active: boolean;
}

/* Lepas geometri + tekstur canvas milik satu grup ruangan lama. Material
   dari cache stdMat dipakai bersama dan tidak dilepas di sini. */
function disposeRoom(group: THREE.Group, textures: THREE.CanvasTexture[]) {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
  });
  for (const t of textures) t.dispose();
}

interface LiveProps {
  selectedId: number | null;
  workingId: number | null;
  doneIds: Set<number>;
  running: boolean;
  bubble: string | null;
  ambientPaused: boolean;
  reducedMotion: boolean;
}

export function Plaza3D(props: Plaza3DProps) {
  const { agents } = props;
  const mountRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const liveRef = useRef<LiveProps>({
    selectedId: props.selectedId,
    workingId: props.workingId,
    doneIds: new Set(props.doneIds),
    running: props.running,
    bubble: props.bubble,
    ambientPaused: props.ambientPaused,
    reducedMotion: props.reducedMotion,
  });
  liveRef.current = {
    selectedId: props.selectedId,
    workingId: props.workingId,
    doneIds: new Set(props.doneIds),
    running: props.running,
    bubble: props.bubble,
    ambientPaused: props.ambientPaused,
    reducedMotion: props.reducedMotion,
  };
  const stateRef = useRef<{
    nodes: Map<number, AgentNode>;
    claims: Map<string, number>;
    idleT: number;
    lastStatusJson: string;
    lastHidden: number;
    narrow: boolean;
  }>({ nodes: new Map(), claims: new Map(), idleT: 0, lastStatusJson: "", lastHidden: 0, narrow: false });
  const sceneRef = useRef<{
    scene: THREE.Scene;
    group: THREE.Group;
    desksGroup: THREE.Group;
    roomGroup: THREE.Group;
    roomTextures: THREE.CanvasTexture[];
    tvMat: THREE.MeshStandardMaterial;
    deskInfos: DeskInfo[];
    deskCount: number;
    deskTheme: SceneTheme;
    theme: SceneTheme;
  } | null>(null);
  const themeRef = useRef<SceneTheme>(props.theme);
  themeRef.current = props.theme;

  /* ----- bangun scene sekali ----- */
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let renderer: THREE.WebGLRenderer;
    let labelRenderer: CSS2DRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      labelRenderer = new CSS2DRenderer();
    } catch {
      propsRef.current.onError(
        "WebGL tidak tersedia di perangkat ini, jadi kantor 3D tidak dapat ditampilkan.",
      );
      return;
    }
    const initialTheme = propsRef.current.theme;
    const initialDef = THEMES[initialTheme];
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(initialDef.bg);
    scene.fog = new THREE.Fog(initialDef.fog, 40, 72);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
    camera.position.set(0, 10.8, 13.8);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = initialDef.exposure;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    labelRenderer.domElement.style.position = "absolute";
    labelRenderer.domElement.style.inset = "0";
    labelRenderer.domElement.style.pointerEvents = "none";
    mount.appendChild(labelRenderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.6, -1.2);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 6;
    controls.maxDistance = 26;
    // Polar dibatasi agar kamera selalu di atas lantai: batas atas masih
    // memberi pandangan dari atas ruangan, batas bawah masih setinggi mata.
    controls.minPolarAngle = 0.32;
    controls.maxPolarAngle = 1.45;
    // Azimuth sengaja TANPA batas: kamera bisa diputar penuh 360 derajat
    // mengelilingi ruangan, terus ke kiri maupun ke kanan.
    controls.enablePan = false;

    // Kanvas bisa difokuskan; tombol panah memutar kamera saat fokus.
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute(
      "aria-label",
      "Kantor 3D agen. Seret untuk memutar 360 derajat. Saat kanvas fokus, tombol panah kiri dan kanan memutar kamera, panah atas dan bawah mengubah ketinggian pandangan.",
    );
    const HOME_TARGET = new THREE.Vector3(0, 0.6, -1.2);
    const HOME_DIR = new THREE.Vector3(0, 10.2, 15).normalize();
    let homeDist = 18.2;
    let lastResetNonce = propsRef.current.cameraResetNonce;
    const resetCamera = () => {
      controls.target.copy(HOME_TARGET);
      camera.position.copy(HOME_TARGET).addScaledVector(HOME_DIR, homeDist);
      controls.update();
    };
    const onKey = (e: KeyboardEvent) => {
      const stepAz = 0.16;
      const stepPol = 0.09;
      const offset = camera.position.clone().sub(controls.target);
      const sph = new THREE.Spherical().setFromVector3(offset);
      if (e.key === "ArrowLeft") sph.theta -= stepAz;
      else if (e.key === "ArrowRight") sph.theta += stepAz;
      else if (e.key === "ArrowUp") sph.phi = Math.max(controls.minPolarAngle, sph.phi - stepPol);
      else if (e.key === "ArrowDown") sph.phi = Math.min(controls.maxPolarAngle, sph.phi + stepPol);
      else return;
      e.preventDefault();
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sph));
      controls.update();
    };
    renderer.domElement.addEventListener("keydown", onKey);

    const hemi = new THREE.HemisphereLight(
      initialDef.hemiSky,
      initialDef.hemiGround,
      initialDef.hemiInt,
    );
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(initialDef.sun, initialDef.sunInt);
    dir.position.set(7, 13, 7);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -17;
    dir.shadow.camera.right = 17;
    dir.shadow.camera.top = 17;
    dir.shadow.camera.bottom = -17;
    dir.shadow.camera.far = 40;
    dir.shadow.bias = -0.0004;
    scene.add(dir);
    const warm = new THREE.PointLight(initialDef.fill, initialDef.fillInt, 42, 1.8);
    warm.position.set(0, 4.4, 1.5);
    scene.add(warm);

    const room = buildRoom(initialTheme);
    scene.add(room.group);
    const desksGroup = new THREE.Group();
    scene.add(desksGroup);
    const agentsGroup = new THREE.Group();
    scene.add(agentsGroup);
    sceneRef.current = {
      scene,
      group: agentsGroup,
      desksGroup,
      roomGroup: room.group,
      roomTextures: room.textures,
      tvMat: room.tvMat,
      deskInfos: [],
      deskCount: -1,
      deskTheme: initialTheme,
      theme: initialTheme,
    };

    // Klik karakter (bukan drag) memilih agen.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downX = 0;
    let downY = 0;
    let downT = 0;
    const onDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
      downT = performance.now();
    };
    const onUp = (e: PointerEvent) => {
      // Ketukan = gerakan kecil DAN singkat; drag untuk memutar kamera
      // (gerakan besar atau lama) tidak ikut memilih agen.
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 10) return;
      if (performance.now() - downT > 600) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(agentsGroup.children, true);
      for (const hit of hits) {
        let obj: THREE.Object3D | null = hit.object;
        while (obj) {
          const id = obj.userData.agentId as number | undefined;
          if (typeof id === "number") {
            propsRef.current.onSelect(id);
            return;
          }
          obj = obj.parent;
        }
      }
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      camera.aspect = w / h;
      // Layar sempit/portrait: FOV lebih lebar agar seluruh lebar ruangan
      // (zona game sampai zona kopi) tetap masuk bingkai.
      camera.fov = camera.aspect < 1.1 ? 55 : 42;
      // Pertahankan arah putar yang sedang dipilih pengguna; resize hanya
      // menyesuaikan jarak minimum agar ruangan tetap muat di bingkai.
      const offset = camera.position.clone().sub(controls.target);
      let dist = offset.length();
      if (dist < 0.001) {
        camera.position.copy(controls.target).addScaledVector(HOME_DIR, homeDist);
        dist = homeDist;
      } else {
        const need = camera.aspect < 1.35 ? 17.8 + (1.35 - camera.aspect) * 14 : 12;
        const clamped = Math.min(Math.max(dist, Math.min(need, 26)), controls.maxDistance);
        if (Math.abs(clamped - dist) > 0.01) {
          offset.setLength(clamped);
          camera.position.copy(controls.target).add(offset);
        }
        homeDist = clamped;
      }
      stateRef.current.narrow = w < 640;
      // Batasi pixel ratio di layar kecil agar render tidak membebani main
      // thread (status roster tidak tertinggal dari label 3D).
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, w < 640 ? 1.5 : 2));
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      labelRenderer.setSize(w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    /* ----- helper perilaku ----- */
    const st = stateRef.current;

    const releaseSpot = (node: AgentNode) => {
      if (node.spot && st.claims.get(node.spot.key) === node.id) {
        st.claims.delete(node.spot.key);
      }
      node.spot = null;
      if (node.partnerId !== null) {
        const partner = st.nodes.get(node.partnerId);
        if (partner && partner.activity === "chat") {
          if (partner.spot && st.claims.get(partner.spot.key) === partner.id) {
            st.claims.delete(partner.spot.key);
          }
          partner.spot = null;
          partner.activity = null;
          partner.partnerId = null;
          partner.mode = "idle-stand";
          partner.stateUntil = st.idleT + rand(0.6, 1.6);
        }
        node.partnerId = null;
      }
      node.activity = null;
    };

    const claimSpot = (node: AgentNode, spot: Spot): boolean => {
      if (st.claims.has(spot.key)) return false;
      st.claims.set(spot.key, node.id);
      node.spot = spot;
      return true;
    };

    const sendTo = (node: AgentNode, x: number, z: number, mode: Mode) => {
      node.target = new THREE.Vector3(x, 0, z);
      node.mode = mode;
    };

    // Tiba di spot aktivitas idle: mulai pose + timer aktivitas.
    const arriveIdle = (node: AgentNode) => {
      node.mode = "idle-activity";
      if (node.spot) node.targetYaw = node.spot.yaw;
      const dur =
        node.activity === "chat"
          ? rand(11, 15)
          : node.activity === "coffee"
            ? rand(10, 15)
            : node.activity === "game"
              ? rand(11, 16)
              : node.activity === "stretch"
                ? rand(7, 10)
                : node.activity === "phone"
                  ? rand(8, 12)
                  : rand(2, 4);
      node.activityUntil = st.idleT + dur;
      if (node.activity === "chat") {
        // Pasangan bergantian bicara: satu bubble pada satu waktu.
        const offset =
          node.partnerId !== null && node.id > node.partnerId ? 3.6 : 0;
        node.nextChatBubble = st.idleT + rand(0.8, 2.4) + offset;
      }
      node.target = null;
    };

    // Agen yang baru muncul langsung mulai di spot aktivitas pertamanya,
    // jadi sejak detik pertama agen tersebar di zona-zona ruangan.
    const teleportToSpot = (node: AgentNode) => {
      if (!node.justSpawned) return;
      node.justSpawned = false;
      const dest = node.spot
        ? { x: node.spot.x, z: node.spot.z, yaw: node.spot.yaw }
        : node.target
          ? { x: node.target.x, z: node.target.z, yaw: node.targetYaw }
          : null;
      if (!dest) return;
      node.rig.root.position.set(dest.x, 0, dest.z);
      node.yaw = dest.yaw;
      node.targetYaw = dest.yaw;
      arriveIdle(node);
    };

    const pickActivity = (node: AgentNode) => {
      const prefs: ActivityKind[] = ["coffee", "game", "chat", "chat", "stretch", "phone", "wander", "coffee"];
      const order: ActivityKind[] = [];
      if (node.firstPick) {
        const pref = prefs[node.index % prefs.length];
        if (pref) order.push(pref);
      }
      const rest: ActivityKind[] = ["coffee", "game", "chat", "stretch", "phone", "wander"];
      // acak ringan untuk variasi antar agen
      rest.sort(() => (Math.sin(node.seed * 91.7 + st.idleT) > 0 ? 1 : -1));
      for (const r of rest) if (!order.includes(r)) order.push(r);
      node.firstPick = false;

      for (const kind of order) {
        if (kind === "coffee") {
          const free = COFFEE_SPOTS.filter((s) => !st.claims.has(s.key));
          const spot = free[Math.floor(Math.random() * free.length)];
          if (spot && claimSpot(node, spot)) {
            node.activity = "coffee";
            sendTo(node, spot.x, spot.z, "idle-walk");
            teleportToSpot(node);
            return;
          }
        } else if (kind === "game") {
          const free = GAME_SPOTS.filter((s) => !st.claims.has(s.key));
          const spot = free[Math.floor(Math.random() * free.length)];
          if (spot && claimSpot(node, spot)) {
            node.activity = "game";
            sendTo(node, spot.x, spot.z, "idle-walk");
            teleportToSpot(node);
            return;
          }
        } else if (kind === "chat") {
          // cari pasangan yang sedang berdiri santai
          let partner: AgentNode | null = null;
          st.nodes.forEach((n) => {
            if (!partner && n.id !== node.id && n.active && n.mode === "idle-stand") {
              partner = n;
            }
          });
          if (partner) {
            const pair = CHAT_PAIRS.find(
              ([a, b]) => !st.claims.has(a.key) && !st.claims.has(b.key),
            );
            if (pair) {
              const [sa, sb] = pair;
              const p: AgentNode = partner;
              if (claimSpot(node, sa) && claimSpot(p, sb)) {
                node.activity = "chat";
                node.partnerId = p.id;
                p.activity = "chat";
                p.partnerId = node.id;
                p.firstPick = false;
                sendTo(node, sa.x, sa.z, "idle-walk");
                sendTo(p, sb.x, sb.z, "idle-walk");
                teleportToSpot(node);
                teleportToSpot(p);
                return;
              }
            }
          }
        } else if (kind === "stretch") {
          const free = STRETCH_SPOTS.filter((s) => !st.claims.has(s.key));
          const spot = free[Math.floor(Math.random() * free.length)];
          if (spot && claimSpot(node, spot)) {
            node.activity = "stretch";
            sendTo(node, spot.x, spot.z, "idle-walk");
            teleportToSpot(node);
            return;
          }
        } else if (kind === "phone") {
          const wp = WAYPOINTS[Math.floor(Math.random() * WAYPOINTS.length)];
          if (wp) {
            node.activity = "phone";
            sendTo(node, wp[0], wp[1], "idle-walk");
            teleportToSpot(node);
            return;
          }
        } else {
          const wp = WAYPOINTS[Math.floor(Math.random() * WAYPOINTS.length)];
          if (wp) {
            node.activity = "wander";
            sendTo(node, wp[0], wp[1], "idle-walk");
            teleportToSpot(node);
            return;
          }
        }
      }
      node.stateUntil = st.idleT + rand(1, 2.5);
    };

    /* ----- pose ----- */
    const applyPose = (node: AgentNode, dt: number, t: number) => {
      const rig = node.rig;
      const live = liveRef.current;
      const k = 1 - Math.exp(-11 * dt);
      const moving =
        node.mode === "idle-walk" || node.mode === "to-work" || node.mode === "to-standby";
      const working = node.mode === "work";
      const act = node.mode === "idle-activity" ? node.activity : null;

      // target duduk
      let sitTarget = 0;
      if (working) sitTarget = 1;
      if (act === "game" && node.spot?.sit) sitTarget = 1;
      node.sit += (sitTarget - node.sit) * k;
      const sit = node.sit;

      rig.body.position.y = 0.54 - sit * 0.07;
      const legSwing = moving ? Math.sin(node.walkPhase) * 0.55 : 0;
      rig.legL.rotation.x += ((-1.5 * sit + legSwing) - rig.legL.rotation.x) * k;
      rig.legR.rotation.x += ((-1.5 * sit - legSwing) - rig.legR.rotation.x) * k;

      // target lengan dasar
      let shLx = 0.06;
      let shRx = 0.06;
      let shLz = 0.05;
      let shRz = -0.05;
      let foL = -0.12;
      let foR = -0.12;
      let headX = 0;
      let headY = Math.sin(t * 0.35 + node.seed * 9) * 0.14;
      let bodyLean = 0;

      if (moving) {
        const sw = Math.sin(node.walkPhase) * 0.42;
        shLx = sw;
        shRx = -sw;
        foL = -0.25;
        foR = -0.25;
        headY = 0;
      } else if (working) {
        // mengetik: kedua lengan ke keyboard, siku bergerak bergantian
        shLx = -0.88;
        shRx = -0.88;
        foL = -0.5 + Math.sin(t * 11 + node.seed * 5) * 0.17;
        foR = -0.5 + Math.sin(t * 11 + Math.PI + node.seed * 5) * 0.17;
        headX = 0.1;
        headY = 0;
      } else if (act === "coffee") {
        const raise = Math.pow(Math.max(0, Math.sin(t * 0.85 + node.seed * 7)), 2.2);
        shRx = -0.35 - raise * 0.3;
        foR = -0.45 - raise * 1.55;
        shLx = 0.1;
        foL = -0.2;
        headX = -0.14 * raise;
        headY = 0;
      } else if (act === "game") {
        shLx = -0.68;
        shRx = -0.68;
        foL = -0.55 + Math.sin(t * 7 + node.seed * 3) * 0.05;
        foR = -0.55 + Math.cos(t * 6.3 + node.seed * 3) * 0.05;
        bodyLean = 0.07 + Math.sin(t * 1.4 + node.seed * 4) * 0.025;
        headY = Math.sin(t * 0.9 + node.seed * 6) * 0.1;
      } else if (act === "chat") {
        const speaking = (t / 3.2 + node.seed) % 2 < 1;
        headX = speaking ? 0.08 + Math.sin(t * 2.3 + node.seed * 8) * 0.07 : 0.02;
        headY = 0;
        if (speaking) {
          foR = -0.45 + Math.sin(t * 2.3 + node.seed * 8) * 0.16;
          shRx = -0.25;
        }
      } else if (act === "stretch") {
        const cyc = (t * 0.4 + node.seed) % 1;
        const up = cyc < 0.42 ? Math.sin((cyc / 0.42) * Math.PI) : 0;
        shLz = 0.05 - 2.65 * up;
        shRz = -0.05 + 2.65 * up;
        foL = -0.15 * up;
        foR = -0.15 * up;
        headX = -0.16 * up;
      } else if (act === "phone") {
        shRx = -0.5;
        foR = -1.18 + Math.sin(t * 5 + node.seed * 4) * 0.04;
        headX = 0.3;
        headY = 0;
      } else if (act === "wander") {
        headY = Math.sin(t * 0.5 + node.seed * 7) * 0.3;
      }

      rig.armL.rotation.x += (shLx - rig.armL.rotation.x) * k;
      rig.armR.rotation.x += (shRx - rig.armR.rotation.x) * k;
      rig.armL.rotation.z += (shLz - rig.armL.rotation.z) * k;
      rig.armR.rotation.z += (shRz - rig.armR.rotation.z) * k;
      rig.foreL.rotation.x += (foL - rig.foreL.rotation.x) * k;
      rig.foreR.rotation.x += (foR - rig.foreR.rotation.x) * k;
      rig.head.rotation.x += (headX - rig.head.rotation.x) * k;
      rig.head.rotation.y += (headY - rig.head.rotation.y) * k;
      rig.body.rotation.x += (bodyLean - rig.body.rotation.x) * k;

      // bob saat jalan / napas halus saat diam
      const bob = moving
        ? Math.abs(Math.sin(node.walkPhase)) * 0.05
        : live.reducedMotion
          ? 0
          : Math.sin(t * 1.8 + node.seed * 10) * 0.012;
      rig.root.position.y = bob;

      // properti aktivitas
      rig.mug.visible = act === "coffee";
      rig.controller.visible = act === "game";
      rig.phone.visible = act === "phone";
      const glow = rig.phone.userData.glow as THREE.Object3D | undefined;
      if (glow) glow.visible = act === "phone";
      rig.steam.visible = act === "coffee" && !live.reducedMotion;
      if (rig.steam.visible) {
        rig.steamPuffs.forEach((puff, i) => {
          const p = (t * 0.4 + i / 3 + node.seed) % 1;
          puff.position.set(Math.sin(p * 5 + i) * 0.03, p * 0.34, 0);
          const s = 0.7 + p * 0.9;
          puff.scale.setScalar(s);
          (puff.material as THREE.MeshBasicMaterial).opacity = 0.34 * (1 - p);
        });
      }
    };

    /* ----- collision pass label & bubble -----
       Setelah CSS2DRenderer menaruh label, ukur kotak nyatanya di layar,
       lalu: (1) clamp ke dalam kanvas dengan margin aman, (2) geser label
       yang bertabrakan ke atas bertingkat — agen yang sedang bekerja atau
       dipilih tidak pernah digeser/disembunyikan, (3) label yang tetap
       tidak muat disembunyikan dan jumlahnya dilaporkan jujur ke UI. */
    const resolveLabels = () => {
      const mountRect = mount.getBoundingClientRect();
      const M = 4;
      const live = liveRef.current;
      interface Item {
        node: AgentNode;
        el: HTMLElement;
        rect: DOMRect;
        prio: number;
        dx: number;
        dy: number;
        hidden: boolean;
      }
      const items: Item[] = [];
      st.nodes.forEach((node) => {
        const el = node.label.element as HTMLElement;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0) return;
        const prio =
          live.workingId === node.id ? 0 : live.selectedId === node.id ? 1 : 2;
        items.push({ node, el, rect, prio, dx: 0, dy: 0, hidden: false });
      });
      // Clamp horizontal semua label ke dalam kanvas.
      for (const it of items) {
        const left = it.rect.left - mountRect.left + it.dx;
        const right = left + it.rect.width;
        if (left < M) it.dx += M - left;
        else if (right > mountRect.width - M) it.dx -= right - (mountRect.width - M);
      }
      // Selesaikan tabrakan berdasarkan prioritas, lalu posisi layar.
      items.sort((a, b) => a.prio - b.prio || a.rect.top - b.rect.top);
      const placed: Item[] = [];
      const boxOf = (it: Item) => ({
        l: it.rect.left - mountRect.left + it.dx,
        t: it.rect.top - mountRect.top + it.dy,
        r: it.rect.left - mountRect.left + it.dx + it.rect.width,
        b: it.rect.top - mountRect.top + it.dy + it.rect.height,
      });
      for (const it of items) {
        let guard = 0;
        for (;;) {
          const b = boxOf(it);
          let shift = 0;
          for (const p of placed) {
            const pb = boxOf(p);
            const overlapX = Math.min(b.r, pb.r) - Math.max(b.l, pb.l);
            const overlapY = Math.min(b.b, pb.b) - Math.max(b.t, pb.t);
            if (overlapX > 1 && overlapY > 1) {
              shift = Math.max(shift, b.b - pb.t + 2);
            }
          }
          if (shift === 0) break;
          it.dy -= shift;
          guard += 1;
          if (guard > 6) break;
        }
        const b = boxOf(it);
        if (b.t < M) {
          // Tidak muat digeser ke atas: label prioritas rendah disembunyikan,
          // label prioritas tinggi didorong ke bawah sebisanya.
          if (it.prio === 2) it.hidden = true;
          else it.dy += M - b.t;
        }
        if (!it.hidden) placed.push(it);
      }
      let hiddenCount = 0;
      for (const it of items) {
        if (it.hidden) {
          hiddenCount += 1;
          it.el.style.opacity = "0";
          it.el.style.transform += " scale(0.01)";
        } else {
          it.el.style.opacity = it.node.active ? "1" : "0.55";
          if (it.dx !== 0 || it.dy !== 0) {
            it.el.style.transform += ` translate(${Math.round(it.dx)}px, ${Math.round(it.dy)}px)`;
          }
        }
      }
      if (hiddenCount !== st.lastHidden) {
        st.lastHidden = hiddenCount;
        propsRef.current.onLabelsHidden?.(hiddenCount);
      }
      // Bubble yang tampil: clamp ke dalam kanvas, panah mengikuti karakter.
      st.nodes.forEach((node) => {
        if (!node.bubbleObj.visible) return;
        const el = node.bubbleEl;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0) return;
        let dx = 0;
        const left = rect.left - mountRect.left;
        const right = left + rect.width;
        if (left < M) dx = M - left;
        else if (right > mountRect.width - M) dx = -(right - (mountRect.width - M));
        if (dx !== 0) {
          el.style.transform += ` translate(${Math.round(dx)}px, 0px)`;
        }
        el.style.setProperty("--arrow-left", `calc(50% - ${Math.round(dx)}px)`);
      });
    };

    /* ----- per-frame ----- */
    const scratchColor = new THREE.Color();
    let last = performance.now();
    let elapsed = 0;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      try {
        const nowMs = performance.now();
        const dt = Math.min((nowMs - last) / 1000, 0.05);
        last = nowMs;
        elapsed += dt;
        const t = elapsed;
        const live = liveRef.current;
        if (!live.ambientPaused) st.idleT += dt;
        const it = st.idleT;
        const sceneCtx = sceneRef.current;

        let anyGaming = false;
        const statuses: Record<number, string> = {};

        st.nodes.forEach((node) => {
          const rig = node.rig;
          // --- tentukan penugasan dari props misi ---
          let want: "idle" | "work" | "standby" | "parked" = "idle";
          if (!node.active) want = "parked";
          else if (live.running && live.workingId === node.id) want = "work";
          else if (live.running) want = "standby";

          if (want === "work" && node.mode !== "work" && node.mode !== "to-work") {
            releaseSpot(node);
            node.justSpawned = false;
            if (node.desk) {
              // Kecepatan disesuaikan jarak: tiba di kursi dalam ±1,1 detik
              // berapa pun jauhnya posisi agen saat gilirannya tiba.
              const d = Math.hypot(
                node.desk.chair.x - rig.root.position.x,
                node.desk.chair.z - rig.root.position.z,
              );
              node.hurry = Math.min(11, Math.max(4.2, d / 1.1));
              sendTo(node, node.desk.chair.x, node.desk.chair.z, "to-work");
            }
          } else if (
            want === "standby" &&
            node.mode !== "standby" &&
            node.mode !== "to-standby"
          ) {
            releaseSpot(node);
            node.justSpawned = false;
            if (node.desk) sendTo(node, node.desk.standby.x, node.desk.standby.z, "to-standby");
          } else if (want === "parked" && node.mode !== "parked" && node.mode !== "to-standby") {
            releaseSpot(node);
            node.justSpawned = false;
            if (node.desk) sendTo(node, node.desk.standby.x, node.desk.standby.z, "to-standby");
          } else if (want === "idle" && (node.mode === "work" || node.mode === "to-work" || node.mode === "standby" || node.mode === "to-standby" || node.mode === "parked")) {
            node.mode = "idle-stand";
            node.stateUntil = it + rand(0.4, 1.4);
            node.target = null;
          }

          // --- gerak menuju target ---
          const moving =
            node.mode === "idle-walk" || node.mode === "to-work" || node.mode === "to-standby";
          if (moving && node.target) {
            const pos = rig.root.position;
            const dx = node.target.x - pos.x;
            const dz = node.target.z - pos.z;
            const dist = Math.hypot(dx, dz);
            // Menuju meja kerja / posisi siaga: jalan lebih cepat agar agen
            // sempat duduk dan mengetik dalam gilirannya.
            const speed =
              node.mode === "to-work"
                ? node.hurry
                : node.mode === "to-standby"
                  ? 3.2
                  : 2.35;
            if (dist < 0.09) {
              pos.x = node.target.x;
              pos.z = node.target.z;
              if (node.mode === "to-work") {
                node.mode = "work";
                node.targetYaw = node.desk?.chairYaw ?? node.targetYaw;
              } else if (node.mode === "to-standby") {
                node.mode = !node.active || live.running ? "standby" : "parked";
                if (!node.active) node.mode = "parked";
                else if (live.running) node.mode = "standby";
                node.targetYaw = 0;
              } else {
                // tiba di spot aktivitas idle
                arriveIdle(node);
              }
              node.target = null;
            } else {
              const step = Math.min(dist, speed * dt);
              pos.x += (dx / dist) * step;
              pos.z += (dz / dist) * step;
              node.targetYaw = Math.atan2(dx, dz);
              node.walkPhase += dt * speed * 4.2;
            }
          }

          // --- mesin idle ---
          if (want === "idle" && !live.ambientPaused) {
            if (node.mode === "idle-stand" && it >= node.stateUntil) {
              pickActivity(node);
            } else if (node.mode === "idle-activity" && it >= node.activityUntil) {
              releaseSpot(node);
              node.mode = "idle-stand";
              node.stateUntil = it + rand(1.2, 3.2);
            }
          }
          if (node.mode === "idle-activity" && node.activity === "chat") {
            if (it >= node.nextChatBubble) {
              const partner =
                node.partnerId !== null ? st.nodes.get(node.partnerId) : null;
              if (partner && it < partner.chatBubbleUntil) {
                // Pasangan sedang bicara; tunggu giliran.
                node.nextChatBubble = partner.chatBubbleUntil + rand(0.6, 1.8);
              } else {
                const idx = Math.floor(node.seed * 977 + it) % CHAT_LINES.length;
                node.chatText = CHAT_LINES[idx] ?? CHAT_LINES[0] ?? "";
                node.chatBubbleUntil = it + 3.2;
                node.nextChatBubble = it + rand(5.5, 8.5);
              }
            }
          }

          // --- hadap arah ---
          node.yaw = lerpAngle(node.yaw, node.targetYaw, 1 - Math.exp(-8 * dt));
          rig.root.rotation.y = node.yaw;

          applyPose(node, dt, node.mode === "work" || live.running ? t : it);

          // --- label & bubble ---
          let status: string;
          if (!node.active) status = "Nonaktif";
          else if (node.mode === "work") status = "Bekerja — mengetik";
          else if (node.mode === "to-work") status = "Menuju meja kerja";
          else if (live.running && live.doneIds.has(node.id)) status = "Selesai";
          else if (live.running) status = "Menunggu giliran";
          else if (node.mode === "idle-activity" && node.activity)
            status = ACTIVITY_LABEL[node.activity];
          else if (node.mode === "idle-walk") status = "Berpindah tempat";
          else status = "Santai";
          node.status = status;
          statuses[node.id] = status;
          const short = shortStatus(status);
          if (node.labelStatus.textContent !== short) {
            node.labelStatus.textContent = short;
          }
          // Posisi dasar label; tumpang tindih dan potongan tepi dirapikan
          // oleh collision pass setelah render (lihat resolveLabels).
          const labelY = st.narrow ? 2.02 : 2.1;
          node.label.position.y = labelY;
          node.label.position.x = 0;
          node.bubbleObj.position.y = labelY + 0.92;
          node.bubbleObj.position.x = 0;

          let showBubble = false;
          let bubbleText = "";
          if (live.workingId === node.id && live.bubble) {
            showBubble = true;
            bubbleText = live.bubble;
          } else if (
            node.mode === "idle-activity" &&
            node.activity === "chat" &&
            it < node.chatBubbleUntil
          ) {
            showBubble = true;
            bubbleText = node.chatText;
          }
          node.bubbleObj.visible = showBubble;
          if (showBubble && node.bubbleEl.textContent !== bubbleText) {
            node.bubbleEl.textContent = bubbleText;
          }

          // --- layar meja & penanda ---
          if (node.desk) {
            const targetIntensity = !node.active
              ? 0.1
              : node.mode === "work"
                ? 1.7
                : live.running && live.doneIds.has(node.id)
                  ? 0.9
                  : 0.55;
            const m = node.desk.screenMat;
            m.emissiveIntensity += (targetIntensity - m.emissiveIntensity) * (1 - Math.exp(-6 * dt));
          }
          rig.ring.visible = live.selectedId === node.id || live.workingId === node.id;
          if (node.mode === "idle-activity" && node.activity === "game") anyGaming = true;
        });

        // TV menyala warna-warni saat ada yang main game
        if (sceneCtx) {
          if (anyGaming) {
            sceneCtx.tvMat.emissive.setHSL((t * 0.045) % 1, 0.55, 0.55);
            sceneCtx.tvMat.emissiveIntensity = 1.15;
          } else {
            sceneCtx.tvMat.emissive.set("#24303A");
            sceneCtx.tvMat.emissiveIntensity = 0.4;
          }
        }

        const statusJson = JSON.stringify(statuses);
        if (statusJson !== st.lastStatusJson) {
          st.lastStatusJson = statusJson;
          propsRef.current.onStatuses(statuses);
        }

        // Tombol Reset Kamera dari UI.
        if (propsRef.current.cameraResetNonce !== lastResetNonce) {
          lastResetNonce = propsRef.current.cameraResetNonce;
          resetCamera();
        }

        controls.update();
        // Sabuk pengaman: apa pun yang terjadi, kamera tidak pernah boleh
        // berada di bawah lantai.
        if (camera.position.y < 0.5) camera.position.y = 0.5;
        // Transisi tema: pencahayaan, latar, kabut, dan exposure bergerak
        // halus menuju nilai tema aktif (crossfade ±0,5 detik), tanpa
        // lompatan kamera dan tanpa memindahkan agen.
        const tdef = THEMES[themeRef.current];
        const lk = 1 - Math.exp(-4.5 * dt);
        hemi.color.lerp(scratchColor.setHex(tdef.hemiSky), lk);
        hemi.groundColor.lerp(scratchColor.setHex(tdef.hemiGround), lk);
        hemi.intensity += (tdef.hemiInt - hemi.intensity) * lk;
        dir.color.lerp(scratchColor.setHex(tdef.sun), lk);
        dir.intensity += (tdef.sunInt - dir.intensity) * lk;
        warm.color.lerp(scratchColor.setHex(tdef.fill), lk);
        warm.intensity += (tdef.fillInt - warm.intensity) * lk;
        if (scene.background instanceof THREE.Color) {
          scene.background.lerp(scratchColor.setHex(tdef.bg), lk);
        }
        if (scene.fog) scene.fog.color.lerp(scratchColor.setHex(tdef.fog), lk);
        renderer.toneMappingExposure +=
          (tdef.exposure - renderer.toneMappingExposure) * lk;
        renderer.render(scene, camera);
        labelRenderer.render(scene, camera);
        resolveLabels();
      } catch {
        // Satu frame gagal tidak boleh mematikan loop.
      }
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("keydown", onKey);
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      mount.removeChild(labelRenderer.domElement);
      const ctxNow = sceneRef.current;
      if (ctxNow) disposeRoom(ctxNow.roomGroup, ctxNow.roomTextures);
      sceneRef.current = null;
      stateRef.current.nodes.clear();
      stateRef.current.claims.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ----- ganti ruangan saat tema berubah -----
     Hanya grup ruangan + meja yang dibangun ulang; grup agen, node agen,
     posisi, antrean misi, dan kamera tidak disentuh sama sekali, jadi
     mengganti latar aman dilakukan kapan pun, termasuk di tengah misi. */
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx || ctx.theme === props.theme) return;
    const room = buildRoom(props.theme);
    ctx.scene.add(room.group);
    ctx.scene.remove(ctx.roomGroup);
    disposeRoom(ctx.roomGroup, ctx.roomTextures);
    ctx.roomGroup = room.group;
    ctx.roomTextures = room.textures;
    ctx.tvMat = room.tvMat;
    ctx.theme = props.theme;
  }, [props.theme]);

  /* ----- sinkronkan node agen + meja dengan roster ----- */
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    const st = stateRef.current;

    // Bangun ulang meja bila jumlah agen atau tema berubah.
    if (ctx.deskCount !== agents.length || ctx.deskTheme !== props.theme) {
      while (ctx.desksGroup.children.length > 0) {
        const child = ctx.desksGroup.children[0];
        if (child) ctx.desksGroup.remove(child);
      }
      ctx.deskInfos = agents.map((a, i) => {
        const { group, info } = buildDesk(i, a.color, props.theme);
        ctx.desksGroup.add(group);
        return info;
      });
      ctx.deskCount = agents.length;
      ctx.deskTheme = props.theme;
    }

    const seen = new Set<number>();
    agents.forEach((agent, i) => {
      seen.add(agent.id);
      let node = st.nodes.get(agent.id);
      if (!node) {
        const rig = buildCharacter(agent.charKey, agent.color);
        rig.root.scale.setScalar(1.12);
        // Kotak ketuk toleran mengelilingi seluruh tubuh karakter.
        const hitbox = new THREE.Mesh(
          new THREE.BoxGeometry(1.2, 2.3, 1.2),
          hitMaterial,
        );
        hitbox.position.y = 1.15;
        rig.root.add(hitbox);
        rig.root.traverse((o) => {
          o.userData.agentId = agent.id;
        });
        const desk = ctx.deskInfos[i] ?? null;
        const start = desk ? desk.standby : new THREE.Vector3(0, 0, 4);
        rig.root.position.copy(start);
        rig.root.rotation.y = 0;

        const labelEl = document.createElement("div");
        labelEl.className = "plaza-label";
        const nameEl = document.createElement("span");
        nameEl.className = "plaza-label-name";
        const statusEl = document.createElement("span");
        statusEl.className = "plaza-label-status";
        labelEl.appendChild(nameEl);
        labelEl.appendChild(statusEl);
        const label = new CSS2DObject(labelEl);
        label.position.set(0, 2.08, 0);
        rig.root.add(label);

        const bubbleEl = document.createElement("div");
        bubbleEl.className = "plaza-bubble";
        const bubbleObj = new CSS2DObject(bubbleEl);
        bubbleObj.position.set(0, 2.85, 0);
        bubbleObj.visible = false;
        rig.root.add(bubbleObj);

        ctx.group.add(rig.root);
        node = {
          id: agent.id,
          index: i,
          rig,
          label,
          labelName: nameEl,
          labelStatus: statusEl,
          bubbleObj,
          bubbleEl,
          desk,
          mode: agent.active ? "idle-stand" : "parked",
          yaw: 0,
          targetYaw: 0,
          target: null,
          spot: null,
          activity: null,
          activityUntil: 0,
          stateUntil: st.idleT + 0.2 + i * 0.25,
          partnerId: null,
          walkPhase: i * 1.3,
          hurry: 4.2,
          sit: 0,
          seed: (i * 0.37 + 0.13) % 1,
          firstPick: true,
          justSpawned: true,
          chatText: "",
          chatBubbleUntil: 0,
          nextChatBubble: 0,
          status: "",
          active: agent.active,
        };
        st.nodes.set(agent.id, node);
      }
      node.index = i;
      node.desk = ctx.deskInfos[i] ?? null;
      node.active = agent.active;
      node.labelName.textContent = shortName(agent.name);
      // Redupkan agen nonaktif lewat material miliknya sendiri.
      node.rig.mats.forEach((m) => {
        m.transparent = !agent.active;
        m.opacity = agent.active ? 1 : 0.45;
      });
      node.label.element.style.opacity = agent.active ? "1" : "0.55";
    });

    st.nodes.forEach((node, id) => {
      if (!seen.has(id)) {
        if (node.spot && st.claims.get(node.spot.key) === id) {
          st.claims.delete(node.spot.key);
        }
        // Elemen label/bubble CSS2D harus dilepas eksplisit dari DOM:
        // event 'removed' three.js hanya terpicu pada objek yang dicabut
        // langsung, bukan pada keturunannya, jadi tanpa ini label agen
        // yang dihapus akan tertinggal melayang di ruangan.
        node.label.element.remove();
        node.bubbleObj.element.remove();
        ctx.group.remove(node.rig.root);
        st.nodes.delete(id);
      }
    });
  }, [agents, props.theme]);

  return <div ref={mountRef} className="plaza-mount" aria-hidden="true" />;
}
