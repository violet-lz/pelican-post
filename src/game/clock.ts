import { CONFIG } from './config';
import type { DayPeriod, Season } from './types';

export function calendar(seconds: number): { day: number; season: Season; year: number; phase: number; period: DayPeriod } {
  const elapsedDays = Math.floor(seconds / CONFIG.secondsPerDay);
  const phase = (seconds % CONFIG.secondsPerDay) / CONFIG.secondsPerDay;
  const seasons: Season[] = ['春', '夏', '秋', '冬'];
  const periods: DayPeriod[] = ['黎明', '上午', '午后', '黄昏', '夜晚'];
  return {
    day: elapsedDays + 1,
    season: seasons[Math.floor(elapsedDays / CONFIG.daysPerSeason) % 4],
    year: Math.floor(elapsedDays / CONFIG.daysPerYear) + 1,
    phase,
    period: periods[Math.min(4, Math.floor(phase * 5))],
  };
}
