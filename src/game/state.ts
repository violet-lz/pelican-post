import { DEFAULT_PREFERENCES } from './config';
import { createExits, makeVisit } from './mail';
import type { SaveGameV1, Stats } from './types';

export function createSave(slot: number, name = `邮路 ${['一', '二', '三'][slot - 1]}`, seed = crypto.getRandomValues(new Uint32Array(1))[0]): SaveGameV1 {
  const stats: Stats = {
    seconds: 0, cyclingSeconds: 0, distance: 0, delivered: 0, ordinaryDelivered: 0, crossDelivered: 0, loopDelivered: 0,
    manualDelivered: 0, autoDelivered: 0, goodReviews: 0, zeroReviews: 0, returned: 0, specialThanks: 0,
    earned: 0, spent: 0, claims: 0, falls: 0, drinks: 0, warmups: 0, feeding: 0,
    regionVisits: { coast: 1, desert: 0, forest: 0, alpine: 0, cloud: 0, desk: 0 }, landmarks: [],
  };
  return {
    version: 1, slot, id: crypto.randomUUID(), name, seed, updatedAt: Date.now(), worldSeconds: 0,
    player: {
      x: 24, lane: 3, facing: 1, speed: 0, cruiseActive: true, stamina: 100, capacity: 4, coins: 0, coinBonusHundredths: 0, trust: 100,
      cold: 0, wet: 0, water: 3, waterEffect: 0, inventory: ['bottle'], equipped: [], umbrella: false, umbrellaLocked: false, outfitLocked: false,
    },
    routes: { visits: [makeVisit(seed, 'coast', 1, 0)], active: 0, exits: createExits() },
    bag: [], preferences: { ...DEFAULT_PREFERENCES }, stats, history: [], collections: [], purchases: [], nextBatch: 1,
  };
}
