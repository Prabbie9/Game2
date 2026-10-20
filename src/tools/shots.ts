// Named reference shots (URL ?shot=<name>). Captured headless by tools/shoot.mjs via tools/shots.json.
import type { WeatherName } from '../lighting/environment';
export interface Shot { t: number; w: WeatherName; start?: number[]; yaw?: number; route?: string; speed?: number; frames?: number; hideHud?: boolean }
export const SHOTS: Record<string, Shot> = {
  m1_golden: { t: 18.7, w: 'clear', start: [0, 1.2, -60], route: 'straight', speed: 14, frames: 150, hideHud: true },
  m1_overcast: { t: 13, w: 'overcast', start: [0, 1.2, -60], route: 'straight', speed: 14, frames: 150, hideHud: true },
  m1_rain_night: { t: 22.5, w: 'rain', start: [0, 1.2, -40], route: 'straight', speed: 12, frames: 200, hideHud: true },
  m1_speed: { t: 16.5, w: 'clear', start: [0, 1.2, -240], route: 'straight', speed: 45, frames: 360 },
  m1_drift: { t: 18.9, w: 'clear', start: [0, 1.2, -100], route: 'loop', speed: 26, frames: 300 },
};
