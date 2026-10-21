// Asset loading: binary (base64-JSON aware for the Artifact host), JSON, KTX2 textures (Basis transcoder), cached.
import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
export const DATA_URL: string = (window as any).HL_DATA ?? new URL('./data/', document.baseURI).href; // test pages in subfolders set HL_DATA
const b64 = () => (window as any).HL_B64 === true;
const cache = new Map<string, Promise<any>>();
let inflight = 0, done = 0; export const pendingLoads = () => inflight; export const completedLoads = () => done;
const track = <T>(p: Promise<T>): Promise<T> => { inflight++; return p.finally(() => { inflight--; done++; }); };
/** `{"b64":"..."}` -> bytes. Slices the payload out instead of JSON.parse (one less copy of a multi-MB string) and uses the
 * native Uint8Array.fromBase64 where the browser has it (much faster than atob + a per-byte loop, the fallback). */
export function decodeB64Json(text: string): ArrayBuffer {
  const a = text.indexOf('"b64"'); const q0 = text.indexOf('"', a + 5) + 1; const q1 = text.indexOf('"', q0); const s = text.slice(q0, q1);
  const fromB64 = (Uint8Array as any).fromBase64 as ((s: string) => Uint8Array) | undefined; if (fromB64) return fromB64(s).buffer as ArrayBuffer;
  const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer;
}
/** Fetch a binary asset. On the Artifact host non-web binaries are published as `<path>.b64.json`. */
export function loadBin(path: string): Promise<ArrayBuffer> {
  const url = DATA_URL + path;
  if (!cache.has(url)) cache.set(url, track((async () => {
    if (b64() && !/\.(json|png|jpg|webp|wasm|js)$/.test(path)) { const r = await fetch(url + '.b64.json'); if (!r.ok) throw new Error(`asset ${path}: HTTP ${r.status}`); return decodeB64Json(await r.text()); }
    const r = await fetch(url); if (!r.ok) throw new Error(`asset ${path}: HTTP ${r.status}`); return r.arrayBuffer();
  })()));
  return cache.get(url)!;
}
export function loadJSON<T = any>(path: string): Promise<T> {
  const url = DATA_URL + path; if (!cache.has(url)) cache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(`asset ${path}: HTTP ${r.status}`); return r.json(); })); return cache.get(url)!;
}
let ktx2: KTX2Loader | null = null;
export function initKTX2(renderer: THREE.WebGLRenderer) { ktx2 = new KTX2Loader().setTranscoderPath(DATA_URL + 'basis/').detectSupport(renderer); }
/** Load a KTX2 texture (mipmapped, repeat-wrapped). */
export function loadKTX2(path: string, srgb: boolean): Promise<THREE.CompressedTexture> {
  const key = 'ktx2:' + path + srgb;
  if (!cache.has(key)) cache.set(key, track(loadBin(path).then((buf) => new Promise<THREE.CompressedTexture>((res, rej) => ktx2!.parse(buf, (t: any) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; t.needsUpdate = true; res(t); }, rej)))));
  return cache.get(key)!;
}
