import { CONFIG } from './config';
import { hash, random } from './math';
import { addressById, levelFor, REGIONS, REGION_IDS, regionLength, stationX } from '../world/regions';
import type { DeliveryRecord, Letter, MailOffer, RegionId, RegionVisit, SaveGameV1 } from './types';

export function makeVisit(seed: number, region: RegionId, ordinal: number, delivered: number): RegionVisit {
  const id = `${region}@${ordinal}`;
  const length = regionLength(seed, region);
  const level = levelFor(delivered);
  const visit: RegionVisit = { id, region, ordinal, length, offers: { entrance: [], exit: [] }, generation: { entrance: 0, exit: 0 }, taken: [], completed: [], discovered: [] };
  visit.offers.entrance = generateOffers(seed, visit, 'entrance', level);
  visit.offers.exit = generateOffers(seed, visit, 'exit', level);
  return visit;
}

function generateOffers(seed: number, visit: RegionVisit, station: 'entrance' | 'exit', level: number): MailOffer[] {
    const { region, id, length } = visit;
    const generation = visit.generation[station];
    const rng = random(hash(seed, id, station, generation));
    return Array.from({ length: 7 }, (_, index) => {
      const candidates = REGIONS[region].neighbors.filter((next) => next !== region && REGIONS[next].level <= level);
      const cross = index === 6 && candidates.length > 0;
      const targetRegion = cross ? candidates[Math.floor(rng() * candidates.length)] : region;
      const addresses = REGIONS[targetRegion].addresses;
      const address = addresses[index % addresses.length];
      const targetLength = regionLength(seed, targetRegion);
      const fromX = stationX(station, length);
      const referenceDistance = cross
        ? length - fromX + targetLength * address.fraction
        : Math.abs(length * address.fraction - fromX);
      const file = index === 5;
      const size = file ? (rng() < 0.5 ? 2 : 3) : 1;
      return {
        id: `${id}:${station}:${generation}:${index}`,
        addressId: address.id,
        originRegion: region,
        targetRegion,
        targetVisit: cross ? null : id,
        size,
        kind: file ? '文件快递' : index % 2 === 0 ? '明信片' : '家书',
        referenceDistance: Math.max(20, referenceDistance),
        baseReward: 12 + Math.min(4, Math.floor(referenceDistance / 650)),
        outcome: level >= 3 && rng() < 0.15 ? 'claim' : 'thanks',
      };
    });
}

export function refreshCompletedStation(save: SaveGameV1, station: 'entrance' | 'exit'): boolean {
  const visit = activeVisit(save);
  const offers = visit.offers[station];
  if (!offers.length || !offers.every((offer) => visit.completed.includes(offer.id))) return false;
  const oldIds = new Set(offers.map((offer) => offer.id));
  visit.taken = visit.taken.filter((id) => !oldIds.has(id));
  visit.completed = visit.completed.filter((id) => !oldIds.has(id));
  visit.generation[station]++;
  visit.offers[station] = generateOffers(save.seed, visit, station, levelFor(save.stats.delivered));
  return true;
}

export function replenishOnRevisit(save: SaveGameV1, visit: RegionVisit): void {
  // A different region was visited in between. Existing carried letters keep their IDs.
  visit.generation.entrance++;
  save.stats.regionVisits[visit.region]++;
  visit.generation.exit++;
  visit.taken = [];
  visit.completed = [];
  visit.offers.entrance = generateOffers(save.seed, visit, 'entrance', levelFor(save.stats.delivered));
  visit.offers.exit = generateOffers(save.seed, visit, 'exit', levelFor(save.stats.delivered));
}

export const activeVisit = (save: SaveGameV1): RegionVisit => save.routes.visits[save.routes.active];
export const usedCapacity = (save: SaveGameV1): number => save.bag.reduce((sum, letter) => sum + letter.size, 0);

export function takeMail(save: SaveGameV1, station: 'entrance' | 'exit', ids: string[]): string | null {
  const visit = activeVisit(save);
  const unique = [...new Set(ids)];
  const offers = visit.offers[station].filter((offer) => unique.includes(offer.id) && !visit.taken.includes(offer.id));
  if (!offers.length || offers.length !== unique.length) return '请选择仍在抽屉里的信件。';
  if (usedCapacity(save) + offers.reduce((sum, offer) => sum + offer.size, 0) > save.player.capacity) return '这次的信件超过了背包容量。';
  const batchId = `${save.id}:batch:${save.nextBatch++}`;
  save.bag.push(...offers.map((offer): Letter => ({ ...offer, batchId, pickedAt: save.worldSeconds, state: 'normal', frozenElapsed: null })));
  visit.taken.push(...offers.map((offer) => offer.id));
  return null;
}

export function freezeRetiredMail(save: SaveGameV1, retiredIds: string[]): number {
  let count = 0;
  for (const letter of save.bag) {
    if (letter.state === 'normal' && letter.targetVisit && retiredIds.includes(letter.targetVisit)) {
      letter.state = 'loop';
      letter.frozenElapsed = Math.max(0, save.worldSeconds - letter.pickedAt);
      count++;
    }
  }
  return count;
}

export function bindFirstArrival(save: SaveGameV1, visit: RegionVisit): void {
  for (const letter of save.bag) {
    if (letter.state === 'normal' && letter.targetVisit === null && letter.targetRegion === visit.region) letter.targetVisit = visit.id;
  }
}

export function canDeliver(save: SaveGameV1, letter: Letter): boolean {
  const visit = activeVisit(save);
  return letter.targetRegion === visit.region && (letter.state === 'loop' || letter.targetVisit === visit.id);
}

export function starRating(referenceDistance: number, seconds: number): number {
  const ratio = referenceDistance / Math.max(1, seconds) / CONFIG.cruise;
  return ratio >= 0.88 ? 5 : ratio >= 0.7 ? 4 : ratio >= 0.5 ? 3 : ratio >= 0.3 ? 2 : 1;
}

export function deliver(save: SaveGameV1, letterId: string, automatic: boolean, at = save.worldSeconds): DeliveryRecord | null {
  const index = save.bag.findIndex((letter) => letter.id === letterId);
  if (index < 0 || !canDeliver(save, save.bag[index])) return null;
  const letter = save.bag[index];
  const seconds = letter.frozenElapsed ?? Math.max(0, at - letter.pickedAt);
  const loop = letter.state === 'loop';
  const stars = loop ? letter.outcome === 'claim' ? 0 : 5 : starRating(letter.referenceDistance, seconds);
  let reward = Math.round(letter.baseReward * [0, 0.65, 0.8, 1, 1.15, 1.3][stars]);
  let message = ['已经收到，谢谢你。', '纸上的问候，终于到了。', '海风把好消息一起送来了。'][hash(letter.id) % 3];
  if (loop && letter.outcome === 'thanks') {
    reward = letter.baseReward * 2;
    message = '隔了这么久，你还记得这封信。谢谢你！';
    save.stats.specialThanks++;
    const stamp = `stamp:${letter.targetRegion}`;
    if (!save.collections.includes(stamp)) save.collections.push(stamp);
    else reward += 2;
  } else if (loop) {
    reward = -Math.max(0, Math.min(letter.baseReward * 5, Math.floor(save.player.coins * 0.5), save.player.coins - 10));
    save.player.trust = Math.max(0, save.player.trust - 12);
    save.stats.zeroReviews++;
    save.stats.claims += -reward;
    message = '这封信让我等得太久了，按约定办理赔偿。';
  }
  if (stars > 0) save.player.trust = Math.min(100, save.player.trust + 1);
  if (reward > 0 && save.player.equipped.includes('lucky-pin')) {
    // Integer hundredths make the two-percent bonus exact across saves and deliveries.
    const credit = save.player.coinBonusHundredths + reward * 2;
    reward += Math.floor(credit / 100);
    save.player.coinBonusHundredths = credit % 100;
  }
  save.player.coins += reward;
  save.stats.earned += Math.max(0, reward);
  save.stats.delivered++;
  save.stats[automatic ? 'autoDelivered' : 'manualDelivered']++;
  if (loop) save.stats.loopDelivered++;
  else save.stats.ordinaryDelivered++;
  if (letter.targetRegion !== letter.originRegion) save.stats.crossDelivered++;
  if (stars >= 4) save.stats.goodReviews++;
  const record: DeliveryRecord = { id: letter.id, recipient: addressById(letter.addressId)?.recipient ?? '收件人', region: letter.targetRegion, stars, reward, seconds, loop, automatic, message };
  save.bag.splice(index, 1);
  for (const visit of save.routes.visits) {
    if ([...visit.offers.entrance, ...visit.offers.exit].some((offer) => offer.id === letter.id) && !visit.completed.includes(letter.id)) visit.completed.push(letter.id);
  }
  save.history = [record, ...save.history].slice(0, 100);
  return record;
}

export function returnMail(save: SaveGameV1, id: string): boolean {
  const index = save.bag.findIndex((letter) => letter.id === id);
  if (index < 0) return false;
  const fee = Math.min(save.player.coins, Math.max(1, Math.round(save.bag[index].baseReward * 0.1)));
  save.player.coins -= fee;
  save.player.trust = Math.max(0, save.player.trust - 2);
  save.stats.spent += fee;
  save.stats.returned++;
  save.bag.splice(index, 1);
  return true;
}

export function availableOffers(save: SaveGameV1, station: 'entrance' | 'exit'): MailOffer[] {
  const visit = activeVisit(save);
  return visit.offers[station].filter((offer) => !visit.taken.includes(offer.id));
}

export function createExits(): SaveGameV1['routes']['exits'] {
  return Object.fromEntries(REGION_IDS.map((id) => [id, [...REGIONS[id].neighbors]])) as SaveGameV1['routes']['exits'];
}
