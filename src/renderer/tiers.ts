// Quality tiers. Auto-picked at first launch (renderer string + short benchmark), overridable and persisted.
export interface TierSettings {
  name: string; renderScale: number; maxPixelRatio: number; shadows: boolean; cascades: number; shadowMap: number; shadowFar: number;
  ao: boolean; ssr: boolean; volumetrics: number; drawDistance: number; lodBias: number; particles: number; traffic: number; crowd: number;
  maxLights: number; textureBudgetMB: number; dynamicRes: boolean; fpsCap: number;
}
export const TIERS: Record<'lite' | 'low' | 'medium' | 'high' | 'ultra', TierSettings> = {
  lite:   { name: 'Lite',   renderScale: 0.6,  maxPixelRatio: 1,   shadows: true, cascades: 1, shadowMap: 1024, shadowFar: 60,  ao: false, ssr: false, volumetrics: 0, drawDistance: 350,  lodBias: 0.35, particles: 0.2, traffic: 0.25, crowd: 0.25, maxLights: 2, textureBudgetMB: 512, dynamicRes: true,  fpsCap: 30 },
  low:    { name: 'Low',    renderScale: 0.75, maxPixelRatio: 1,   shadows: true, cascades: 2, shadowMap: 1024, shadowFar: 120, ao: false, ssr: false, volumetrics: 0, drawDistance: 600,  lodBias: 0.5, particles: 0.35, traffic: 0.4, crowd: 0.4, maxLights: 4,  textureBudgetMB: 1024, dynamicRes: true,  fpsCap: 30 },
  medium: { name: 'Medium', renderScale: 0.9,  maxPixelRatio: 1,   shadows: true, cascades: 3, shadowMap: 1536, shadowFar: 180, ao: true,  ssr: false, volumetrics: 1, drawDistance: 900,  lodBias: 0.75, particles: 0.6, traffic: 0.7, crowd: 0.7, maxLights: 8,  textureBudgetMB: 2048, dynamicRes: true,  fpsCap: 60 },
  high:   { name: 'High',   renderScale: 1,    maxPixelRatio: 1.5, shadows: true, cascades: 4, shadowMap: 2048, shadowFar: 260, ao: true,  ssr: true,  volumetrics: 2, drawDistance: 1400, lodBias: 1,   particles: 1,   traffic: 1,   crowd: 1,   maxLights: 12, textureBudgetMB: 4096, dynamicRes: false, fpsCap: 60 },
  ultra:  { name: 'Ultra',  renderScale: 1,    maxPixelRatio: 2,   shadows: true, cascades: 4, shadowMap: 4096, shadowFar: 380, ao: true,  ssr: true,  volumetrics: 3, drawDistance: 2200, lodBias: 1.4, particles: 1.4, traffic: 1.2, crowd: 1.3, maxLights: 16, textureBudgetMB: 8192, dynamicRes: false, fpsCap: 60 },
};
export type TierName = keyof typeof TIERS;
const KEY = 'harbourline.tier.v1';
/** Pick a tier from the GPU string; a later benchmark may lower it. Persisted user override wins. */
export function pickTier(gl: WebGL2RenderingContext | null): { tier: TierName; reason: string } {
  if (/[?&]lite\b/.test(location.search) || (window as any).HL_B64 === true) { try { const s = localStorage.getItem(KEY); if (s && s in TIERS) return { tier: s as TierName, reason: 'saved' }; } catch { /* no storage */ } return { tier: 'lite', reason: 'lite/artifact default' }; }
  try { const s = localStorage.getItem(KEY); if (s && s in TIERS) return { tier: s as TierName, reason: 'saved' }; } catch { /* no storage */ }
  if (!gl) return { tier: 'low', reason: 'no webgl2' };
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const r = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
  if (/swiftshader|llvmpipe|software/.test(r)) return { tier: 'low', reason: r };
  if (/rtx 40|rtx 30[789]|rx 7[89]00|rx 69|rx 79|radeon pro w7|apple m[1-4] (max|ultra)/.test(r)) return { tier: 'ultra', reason: r };
  if (/rtx|gtx 1(07|08)|rx 6[678]|rx 5[67]|apple m[1-4] pro|arc a7/.test(r)) return { tier: 'high', reason: r };
  if (/intel|uhd|iris|vega [0-9] |radeon\(tm\) graphics|mali|adreno|apple m[1-4]/.test(r)) return { tier: /iris xe|apple m/.test(r) ? 'medium' : 'low', reason: r };
  return { tier: 'medium', reason: r };
}
export function saveTier(t: TierName) { try { localStorage.setItem(KEY, t); } catch { /* ignore */ } }
