import type { SaveGameV1 } from '../game/types';
import { REGION_IDS, REGIONS, addressById } from '../world/regions';
import { DEFAULT_PREFERENCES } from '../game/config';

const DB_NAME = 'pelican-post-saves';
const STORE = 'snapshots';
const LOCK_STORE = 'leases';
let database: Promise<IDBDatabase> | undefined;

function db(): Promise<IDBDatabase> {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const result = request.result;
      if (!result.objectStoreNames.contains(STORE)) result.createObjectStore(STORE);
      if (!result.objectStoreNames.contains(LOCK_STORE)) result.createObjectStore(LOCK_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error ?? new Error('无法打开本地存档。')); };
  });
  return database;
}

export function validateSave(value: unknown): SaveGameV1 {
  if (!value || typeof value !== 'object') throw new Error('这不是有效的邮路存档。');
  const s = structuredClone(value) as SaveGameV1;
  if (s.player && typeof s.player === 'object' && !Object.prototype.hasOwnProperty.call(s.player, 'coinBonusHundredths')) s.player.coinBonusHundredths = 0;
  if (s.player && typeof s.player === 'object' && !Object.prototype.hasOwnProperty.call(s.player, 'cruiseActive')) s.player.cruiseActive = true;
  const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
  const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
  const strings = (v: unknown, max: number) => Array.isArray(v) && v.length <= max && v.every((x) => str(x)) && new Set(v).size === v.length;
  const offerValid = (o: SaveGameV1['bag'][number]) => o && str(o.id) && str(o.addressId) && addressById(o.addressId)?.region === o.targetRegion && REGION_IDS.includes(o.originRegion) && REGION_IDS.includes(o.targetRegion) && (o.targetVisit === null || (str(o.targetVisit) && new RegExp(`^${o.targetRegion}@[1-9][0-9]*$`).test(o.targetVisit))) && [1, 2, 3].includes(o.size) && ['明信片', '家书', '文件快递'].includes(o.kind) && finite(o.baseReward) && o.baseReward <= 1000 && finite(o.referenceDistance) && o.referenceDistance > 0 && ['thanks', 'claim'].includes(o.outcome);
  if (s.version !== 1 || !Number.isInteger(s.slot) || s.slot < 1 || s.slot > 3 || !str(s.id) || !str(s.name, 80) || !finite(s.worldSeconds) || !finite(s.updatedAt) || !Number.isInteger(s.seed) || s.seed < 0 || s.seed > 0xffffffff || !Number.isInteger(s.nextBatch) || s.nextBatch < 1) throw new Error('存档版本或基本信息不正确。');
  if (!s.player || !finite(s.player.x) || !finite(s.player.coins) || !finite(s.player.capacity) || s.player.capacity < 4 || s.player.capacity > 8 || ![1, -1].includes(s.player.facing) || ![1, 2, 3, 4, 5].includes(s.player.lane) || !finite(s.player.stamina) || s.player.stamina > 100 || !finite(s.player.cold) || s.player.cold > 100 || !finite(s.player.wet) || s.player.wet > 100 || !finite(s.player.water) || s.player.water > 3) throw new Error('存档的骑行状态不完整。');
  if (!Number.isInteger(s.player.coinBonusHundredths) || s.player.coinBonusHundredths < 0 || s.player.coinBonusHundredths >= 100) throw new Error('金币加成的零头记录不正确。');
  if (typeof s.player.cruiseActive !== 'boolean') throw new Error('巡航启停状态不正确。');
  if (!Number.isFinite(s.player.speed) || Math.abs(s.player.speed) > 30 || !finite(s.player.trust) || s.player.trust > 100 || !finite(s.player.waterEffect) || s.player.waterEffect > 60 || !strings(s.player.inventory, 60) || !strings(s.player.equipped, 20) || !['umbrella', 'umbrellaLocked', 'outfitLocked'].every((key) => typeof s.player[key as keyof typeof s.player] === 'boolean')) throw new Error('装备或体力数据不正确。');
  if (!s.routes || !Array.isArray(s.routes.visits) || s.routes.visits.length < 1 || s.routes.visits.length > 2 || !Number.isInteger(s.routes.active) || s.routes.active < 0 || s.routes.active >= s.routes.visits.length) throw new Error('地区回退记录不正确。');
  for (const visit of s.routes.visits) {
    if (!visit || !REGION_IDS.includes(visit.region) || !Number.isInteger(visit.ordinal) || visit.ordinal < 1 || visit.id !== `${visit.region}@${visit.ordinal}` || !finite(visit.length) || visit.length < 2000 || visit.length > 3100 || !strings(visit.taken, 14) || !strings(visit.discovered, 5) || !visit.discovered.every((id) => REGIONS[visit.region].landmarks.some((l) => l.id === id)) || !visit.offers || !['entrance', 'exit'].every((kind) => { const offers = visit.offers[kind as 'entrance' | 'exit']; return Array.isArray(offers) && offers.length <= 7 && offers.every((o) => offerValid(o as SaveGameV1['bag'][number])); })) throw new Error('地区数据不完整。');
    const ids = [...visit.offers.entrance, ...visit.offers.exit].map((o) => o.id);
    if (!visit.generation || !['entrance', 'exit'].every((k) => Number.isInteger(visit.generation[k as 'entrance' | 'exit']) && visit.generation[k as 'entrance' | 'exit'] >= 0) || !strings(visit.completed, 14) || new Set(ids).size !== ids.length || visit.taken.some((id) => !ids.includes(id)) || visit.completed.some((id) => !visit.taken.includes(id))) throw new Error('邮局抽屉的信件记录不一致。');
  }
  if (new Set(s.routes.visits.map((v) => v.id)).size !== s.routes.visits.length || !s.routes.exits || !REGION_IDS.every((id) => strings(s.routes.exits[id], 4) && s.routes.exits[id].every((next) => REGIONS[id].neighbors.includes(next)))) throw new Error('邮路连接数据不正确。');
  if (s.player.x > s.routes.visits[s.routes.active].length + 1) throw new Error('骑行位置超出了地区范围。');
  if (!Array.isArray(s.bag) || s.bag.length > 10 || !Array.isArray(s.history) || s.history.length > 100 || !Array.isArray(s.collections) || s.collections.length > 200 || !s.stats || !finite(s.stats.delivered) || !s.stats.regionVisits || !Array.isArray(s.stats.landmarks)) throw new Error('信包或手账数据不正确。');
  const statKeys = ['seconds', 'cyclingSeconds', 'distance', 'delivered', 'ordinaryDelivered', 'crossDelivered', 'loopDelivered', 'manualDelivered', 'autoDelivered', 'goodReviews', 'zeroReviews', 'returned', 'specialThanks', 'earned', 'spent', 'claims', 'falls', 'drinks', 'warmups', 'feeding'] as const;
  if (!statKeys.every((key) => finite(s.stats[key])) || !REGION_IDS.every((id) => finite(s.stats.regionVisits[id]) && Number.isInteger(s.stats.regionVisits[id])) || !strings(s.stats.landmarks, 30) || !strings(s.collections, 200) || !strings(s.purchases, 100)) throw new Error('手账统计不完整。');
  if (s.history.some((r) => !r || !str(r.id) || !str(r.recipient, 80) || !REGION_IDS.includes(r.region) || !Number.isInteger(r.stars) || r.stars < 0 || r.stars > 5 || !Number.isFinite(r.reward) || !finite(r.seconds) || !str(r.message, 300) || typeof r.loop !== 'boolean' || typeof r.automatic !== 'boolean')) throw new Error('送达回执不完整。');
  if (new Set(s.bag.map((letter) => letter.id)).size !== s.bag.length) throw new Error('信包里有重复信件。');
  for (const letter of s.bag) {
    if (!offerValid(letter) || !str(letter.batchId) || !finite(letter.pickedAt) || letter.pickedAt > s.worldSeconds || !['normal', 'loop'].includes(letter.state) || (letter.state === 'loop' ? !finite(letter.frozenElapsed) : letter.frozenElapsed !== null)) throw new Error('信件记录不完整。');
  }
  if (s.bag.reduce((sum, letter) => sum + letter.size, 0) > s.player.capacity + 2) throw new Error('信件超过背包的承载上限。');
  if (!s.preferences || !Object.keys(DEFAULT_PREFERENCES).every((key) => key === 'camera' ? ['far', 'near'].includes(s.preferences.camera) : typeof s.preferences[key as keyof typeof s.preferences] === 'boolean')) throw new Error('设置数据不完整。');
  return s;
}

async function readRaw(slot: number): Promise<unknown[]> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE).objectStore(STORE).get(slot);
    request.onsuccess = () => {
      if (request.result === undefined) resolve([]);
      else if (Array.isArray(request.result)) resolve(request.result);
      else reject(new Error('这个槽位的记录已损坏，请通过备份导入恢复。'));
    };
    request.onerror = () => reject(request.error);
  });
}

export async function readSlot(slot: number): Promise<{ save: SaveGameV1 | null; recovered: boolean }> {
  const snapshots = await readRaw(slot);
  for (let index = 0; index < snapshots.length; index++) {
    try { return { save: validateSave(snapshots[index]), recovered: index > 0 }; } catch { /* Try the two recovery snapshots. */ }
  }
  if (snapshots.length) throw new Error('这个槽位的三份快照都无法读取，可以导入备份恢复。');
  return { save: null, recovered: false };
}

export async function writeSlot(save: SaveGameV1, owner: string): Promise<void> {
  const snapshot = validateSave(save);
  snapshot.updatedAt = Date.now();
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE, LOCK_STORE], 'readwrite');
    const store = transaction.objectStore(STORE);
    let ownershipError = false;
    const leaseRequest = transaction.objectStore(LOCK_STORE).get(save.slot);
    leaseRequest.onsuccess = () => {
      if (leaseRequest.result?.owner !== owner) { ownershipError = true; transaction.abort(); return; }
      transaction.objectStore(LOCK_STORE).put({ owner, time: Date.now() }, save.slot);
      const previous = store.get(save.slot);
      previous.onsuccess = () => {
        const history = Array.isArray(previous.result) ? previous.result : [];
        store.put([snapshot, ...history.slice(0, 2)], save.slot);
      };
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('本地空间不足，未能保存。'));
    transaction.onabort = () => reject(ownershipError ? new Error('这个邮路已在另一个标签页打开，当前骑行已暂停以保护存档。') : transaction.error ?? new Error('存档写入被中断。'));
  });
}

async function claimSlot(slot: number, owner: string, holdsExclusiveBrowserLock = false): Promise<boolean> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(LOCK_STORE, 'readwrite');
    const store = tx.objectStore(LOCK_STORE);
    const request = store.get(slot);
    let allowed = false;
    request.onsuccess = () => {
      const lease = request.result as { owner: string; time: number } | undefined;
      allowed = holdsExclusiveBrowserLock || !lease || lease.owner === owner || Date.now() - lease.time > 20000;
      if (allowed) store.put({ owner, time: Date.now() }, slot);
    };
    tx.oncomplete = () => resolve(allowed);
    tx.onerror = () => reject(tx.error);
  });
}

export class SlotLease {
  private slot: number | null = null;
  private unlock: (() => void) | null = null;
  private claiming = false;
  constructor(private owner: string) {}

  async claim(slot: number): Promise<boolean> {
    if (this.slot === slot) return claimSlot(slot, this.owner);
    if (this.slot !== null || this.claiming) return false;
    this.claiming = true;
    try {
      let exclusive = false;
      if (navigator.locks) {
        const acquired = await new Promise<boolean>((resolve, reject) => {
          void navigator.locks.request(`pelican-post-slot-${slot}`, { ifAvailable: true }, async (lock) => {
            if (!lock) { resolve(false); return; }
            exclusive = true;
            await new Promise<void>((release) => { this.unlock = release; resolve(true); });
          }).catch(reject);
        });
        if (!acquired) return false;
      }
      const allowed = await claimSlot(slot, this.owner, exclusive);
      if (allowed) this.slot = slot;
      else { this.unlock?.(); this.unlock = null; }
      return allowed;
    } catch (error) { this.unlock?.(); this.unlock = null; throw error; }
    finally { this.claiming = false; }
  }

  async release(): Promise<void> {
    try { if (this.slot !== null) await releaseSlot(this.slot, this.owner); }
    finally { this.slot = null; this.unlock?.(); this.unlock = null; }
  }
}

export async function releaseSlot(slot: number, owner: string): Promise<void> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(LOCK_STORE, 'readwrite');
    const store = tx.objectStore(LOCK_STORE);
    const request = store.get(slot);
    request.onsuccess = () => { if (request.result?.owner === owner) store.delete(slot); };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function exportSave(save: SaveGameV1): void {
  const blob = new Blob([JSON.stringify(validateSave(save), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `鹈鹕邮差-${save.name}-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
