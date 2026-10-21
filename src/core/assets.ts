// Asset loading: binary (base64-JSON aware for the Artifact host), JSON, KTX2 textures (Basis transcoder), cached.
import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
export const DATA_URL: string = (window as any).HL_DATA ?? new URL('./data/', document.baseURI).href; // test pages in subfolders set HL_DATA
const b64 = () => (window as any).HL_B64 === true;
const cache = new Map<string, Promise<any>>();
let inflight = 0, done = 0; export const pendingLoads = () => inflight; export const completedLoads = () => done;
const track = <T>(p: Promise<T>): Promise<T> => { inflight++; return p.finally(() => { inflight--; done++; }); };
/** Fetch a binary asset. On the Artifact host non-web binaries are published as `<path>.b64.json`. */
export function loadBin(path: string): Promise<ArrayBuffer> {
  const url = DATA_URL + path;
  if (!cache.has(url)) cache.set(url, track((async () => {
    if (b64() && !/\.(json|png|jpg|webp|wasm|js)$/.test(path)) { const j = await (await fetch(url + '.b64.json')).json(); const s = atob(j.b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; }
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
