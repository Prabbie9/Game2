// Named reference shots (URL ?shot=<name>). Captured headless by tools/shoot.mjs via tools/shots.json.
import type { WeatherName } from '../lighting/environment';
export interface Shot { t: number; w: WeatherName; scene?: string; cam?: { pos: number[]; look: number[]; fov?: number }; start?: number[]; yaw?: number; route?: string; speed?: number; frames?: number; hideHud?: boolean }
export const SHOTS: Record<string, Shot> = {
  m2_golden: { t: 19.1, w: 'clear', start: [4.2, 1.2, -70], frames: 90, hideHud: true, cam: { pos: [-5.5, 1.7, -78], look: [2, 6, 10], fov: 58 } },
  m2_overcast: { t: 13.5, w: 'overcast', start: [4.2, 1.2, -70], frames: 90, hideHud: true, cam: { pos: [-5.5, 1.7, -78], look: [2, 6, 10], fov: 58 } },
  m2_night_wet: { t: 23, w: 'rain', start: [4.2, 1.2, -40], frames: 120, hideHud: true, cam: { pos: [-6, 1.6, -58], look: [3, 2.5, 5], fov: 58 } },
  m2_tower: { t: 17.5, w: 'clear', start: [4.2, 1.2, -70], frames: 60, hideHud: true, cam: { pos: [-9, 1.8, 6], look: [-24, 26, 22], fov: 62 } },
  m2_intersection: { t: 16.5, w: 'clear', start: [4.2, 1.2, -40], frames: 150, hideHud: true, cam: { pos: [-2, 15, -34], look: [0, 0, 6], fov: 55 } },
  m2_hero_char: { t: 18.6, w: 'clear', start: [4.2, 1.2, -30], frames: 75, hideHud: true, cam: { pos: [8.9, 1.55, -52.2], look: [10.5, 1.0, -56.5], fov: 40 } },
  m2_hero_car: { t: 18.6, w: 'clear', start: [4.2, 1.2, -30], frames: 60, hideHud: true, cam: { pos: [7.4, 1.25, -24.6], look: [4.2, 0.7, -30], fov: 42 } },
  m1_golden: { t: 18.7, w: 'clear', start: [0, 1.2, -60], route: 'straight', speed: 14, frames: 150, hideHud: true },
  m1_overcast: { t: 13, w: 'overcast', start: [0, 1.2, -60], route: 'straight', speed: 14, frames: 150, hideHud: true },
  m1_rain_night: { t: 22.5, w: 'rain', start: [0, 1.2, -40], route: 'straight', speed: 12, frames: 200, hideHud: true },
  m1_speed: { t: 16.5, w: 'clear', start: [0, 1.2, -240], route: 'straight', speed: 45, frames: 360 },
  m1_drift: { t: 18.9, w: 'clear', start: [0, 1.2, -100], route: 'loop', speed: 26, frames: 300 },
};
