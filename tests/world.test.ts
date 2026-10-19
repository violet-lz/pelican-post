import { describe, expect, it } from 'vitest';
import { calendar } from '../src/game/clock';
import { CONFIG } from '../src/game/config';
import { intersectsRange } from '../src/game/math';
import { makeVisit } from '../src/game/mail';
import { ChunkWindow } from '../src/world/chunks';
import { availableLanes, canChangeLane, laneY, regionLength, REGION_IDS } from '../src/world/regions';

describe('calendar and bounded world', () => {
  it('advances one day per two effective minutes, a season every four days, a year every sixteen', () => {
    expect(calendar(119.99).day).toBe(1);
    expect(calendar(120).day).toBe(2);
    expect(calendar(479.99).season).toBe('春');
    expect(calendar(480).season).toBe('夏');
    expect(calendar(1920)).toMatchObject({ day: 17, year: 2, season: '春' });
    expect(new Set([0, 24, 48, 72, 96].map((s) => calendar(s).period)).size).toBe(5);
  });

  it('keeps a deterministic 5–7 minute cruising length for every region', () => {
    for (let seed = 0; seed < 50; seed++) for (const region of REGION_IDS) {
      const length = regionLength(seed, region);
      expect(length / CONFIG.cruise).toBeGreaterThanOrEqual(300);
      expect(length / CONFIG.cruise).toBeLessThanOrEqual(420);
      expect(regionLength(seed, region)).toBe(length);
    }
  });

  it('keeps at most five chunks through a hundred region changes and regenerates scenery identically', () => {
    const window = new ChunkWindow();
    let maximum = 0;
    for (let i = 0; i < 100; i++) {
      const region = REGION_IDS[i % REGION_IDS.length]; const visit = makeVisit(123, region, i + 1, 80);
      for (let x = 0; x < visit.length; x += 173) {
        const chunks = window.update(123, visit.id, region, x, visit.length);
        maximum = Math.max(maximum, chunks.length);
        expect(chunks.length).toBeLessThanOrEqual(5);
        expect(chunks.flatMap((c) => c.objects).length).toBeLessThanOrEqual(70);
      }
    }
    expect(maximum).toBe(5);
    const original = window.update(123, 'coast@200', 'coast', 700, 2800).map((c) => c.objects);
    window.clear();
    expect(window.update(123, 'coast@300', 'coast', 700, 2800).map((c) => c.objects)).toEqual(original);
  });

  it('connects the high bridge only at its ramps and merges without a height jump', () => {
    const length = 2700;
    expect(availableLanes(length * .35, length)).toEqual([1, 2, 3, 4]);
    expect(canChangeLane(2, 1, length * .27, length)).toBe(true);
    expect(canChangeLane(2, 1, length * .35, length)).toBe(false);
    expect(canChangeLane(1, 2, length * .41, length)).toBe(true);
    expect(laneY(1, length * .425, length)).toBeCloseTo(laneY(2, length * .425, length));
    expect(laneY(5, length * .79, length)).toBeCloseTo(laneY(4, length * .79, length));
  });

  it('detects an interaction crossed between two frames in either direction', () => {
    expect(intersectsRange(60, 90, 75, 4)).toBe(true);
    expect(intersectsRange(90, 60, 75, 4)).toBe(true);
    expect(intersectsRange(60, 65, 75, 4)).toBe(false);
  });

  it('keeps station and address approaches clear across 1000 world seeds', () => {
    const window = new ChunkWindow();
    let examined = 0;
    for (let seed = 0; seed < 1000; seed++) {
      const region = REGION_IDS[seed % REGION_IDS.length];
      const visit = makeVisit(seed, region, 1, 80);
      const seen = new Set<string>();
      for (let x = 0; x < visit.length; x += CONFIG.chunkSize) {
        for (const chunk of window.update(seed, visit.id, region, x, visit.length)) for (const object of chunk.objects) {
          if (seen.has(object.id)) continue;
          seen.add(object.id); examined++;
          const stationClear = object.x >= 115 && object.x <= visit.length - 130;
          const addressClear = [.155, .325, .51, .7, .83, .91].every((f) => Math.abs(object.x - visit.length * f) >= 27);
          if (!stationClear || !addressClear) throw new Error(`Seed ${seed}, ${object.id} obstructs a station or address at ${object.x} m`);
        }
      }
    }
    expect(examined).toBeGreaterThan(50000);
  });
});
