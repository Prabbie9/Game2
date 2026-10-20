// Generates the 10MB binary used by the delivery test (kept out of git).
import fs from 'node:fs'; import crypto from 'node:crypto';
const p = new URL('../public/test/blob10mb.bin', import.meta.url);
if (!fs.existsSync(p)) { fs.mkdirSync(new URL('../public/test/', import.meta.url), { recursive: true }); fs.writeFileSync(p, crypto.randomBytes(10 * 1024 * 1024)); }
