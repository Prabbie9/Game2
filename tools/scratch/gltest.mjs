import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage();
const r = await p.evaluate(() => { const c = document.createElement('canvas'); const g = c.getContext('webgl2'); if (!g) return 'no webgl2'; const d = g.getExtension('WEBGL_debug_renderer_info'); return [g.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : g.RENDERER), g.getParameter(g.MAX_TEXTURE_SIZE), !!g.getExtension('EXT_color_buffer_float'), 'gpu' in navigator].join(' | '); });
console.log(r); await b.close();
