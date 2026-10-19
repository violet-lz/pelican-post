import { CONFIG } from '../game/config';
import { hash, random } from '../game/math';
import type { Lane, RegionId } from '../game/types';

export interface WorldObject {
  id: string;
  x: number;
  lane: Lane;
  kind: 'planter' | 'pedestrian' | 'car' | 'branch' | 'sign' | 'flowers' | 'bench';
  variant: number;
}

export interface MapChunk { key: string; index: number; objects: WorldObject[] }

export class ChunkWindow {
  readonly chunks = new Map<string, MapChunk>();
  private lastWindow = '';
  private nearby: MapChunk[] = [];

  update(seed: number, visitId: string, region: RegionId, x: number, length: number): MapChunk[] {
    const center = Math.floor(x / CONFIG.chunkSize);
    const window = `${seed}:${visitId}:${length}:${center}`;
    if (window === this.lastWindow) return this.nearby;
    const desired = new Set<string>();
    for (let i = center - 2; i <= center + 2; i++) {
      if (i < 0 || i * CONFIG.chunkSize >= length) continue;
      const key = `${visitId}/${i}`;
      desired.add(key);
      if (!this.chunks.has(key)) this.chunks.set(key, this.generate(seed, visitId, region, i, length));
    }
    for (const key of this.chunks.keys()) if (!desired.has(key)) this.chunks.delete(key);
    this.lastWindow = window;
    this.nearby = [...this.chunks.values()];
    return this.nearby;
  }

  private generate(seed: number, visitId: string, region: RegionId, index: number, length: number): MapChunk {
    // Visit-independent placement keeps addresses and road scenery recognizable on return.
    const rng = random(hash(seed, region, index));
    const kinds: WorldObject['kind'][] = region === 'desert' ? ['branch', 'sign', 'planter', 'pedestrian'] : ['planter', 'pedestrian', 'car', 'branch', 'flowers', 'bench'];
    const objects: WorldObject[] = [];
    for (let i = 0; i < 14; i++) {
      const x = index * CONFIG.chunkSize + 10 + rng() * (CONFIG.chunkSize - 20);
      // Stations, mailboxes and exits retain clear braking/interaction space.
      const fraction = x / length;
      const protectedFractions = [0.155, 0.325, 0.51, 0.7, 0.83, 0.91];
      if (x < 115 || x > length - 130 || protectedFractions.some((f) => Math.abs(fraction - f) * length < 27)) continue;
      objects.push({ id: `${region}:${index}:${i}`, x, lane: (2 + Math.floor(rng() * 3)) as Lane, kind: kinds[Math.floor(rng() * kinds.length)], variant: Math.floor(rng() * 3) });
    }
    objects.sort((a, b) => a.x - b.x);
    return { key: `${visitId}/${index}`, index, objects };
  }

  clear(): void { this.chunks.clear(); this.lastWindow = ''; this.nearby = []; }
}
