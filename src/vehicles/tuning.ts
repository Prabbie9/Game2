// Resolves vehicle tuning from the single data file: base class values <- preset <- user overrides.
import data from '../data/vehicle_tuning.json';
export type PresetName = 'Grippy' | 'Balanced' | 'Drifty';
export const PRESETS: PresetName[] = ['Grippy', 'Balanced', 'Drifty'];
export const CLASSES = Object.keys(data.classes) as string[];
export function resolveTuning(cls: string, preset: PresetName = 'Balanced', overrides: Record<string, any> = {}) {
  const c = (data.classes as any)[cls] ?? (data.classes as any).sedan;
  return { ...structuredClone(c.base), ...(data.presets as any)[preset], ...overrides, cls, preset };
}
export function classLabel(cls: string) { return (data.classes as any)[cls]?.label ?? cls; }
