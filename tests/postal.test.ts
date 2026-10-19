import { describe, expect, it } from 'vitest';
import { createSave } from '../src/game/state';
import { activeVisit, deliver, makeVisit, refreshCompletedStation, returnMail, starRating, takeMail, usedCapacity } from '../src/game/mail';
import { advanceRegion, retreatRegion } from '../src/world/routes';
import { validateSave } from '../src/storage/saves';
import { REGIONS } from '../src/world/regions';

function experienced() {
  const save = createSave(1, '测试邮路', 12345);
  save.stats.delivered = 80; save.player.capacity = 8;
  save.routes.visits = [makeVisit(save.seed, 'coast', 1, 80)];
  return save;
}

describe('letters remain consistent while traveling and revisiting', () => {
  it('shares a pickup clock but rates each distance separately and settles only once', () => {
    const save = createSave(1, '同批信件', 200);
    const offers = activeVisit(save).offers.entrance;
    save.worldSeconds = 9;
    expect(takeMail(save, 'entrance', [offers[0].id, offers[4].id])).toBeNull();
    expect(save.bag[0].pickedAt).toBe(save.bag[1].pickedAt);
    const at = 250;
    const near = deliver(save, offers[0].id, false, at)!;
    const far = deliver(save, offers[4].id, true, at)!;
    expect(far.stars).toBeGreaterThan(near.stars);
    const earned = save.player.coins;
    expect(deliver(save, offers[0].id, true, at)).toBeNull();
    expect(save.player.coins).toBe(earned);
    expect(save.stats.delivered).toBe(2);
    expect(save.stats.manualDelivered).toBe(1);
    expect(save.stats.autoDelivered).toBe(1);
  });

  it('freezes only retired destinations, and permits delivery on the first return', () => {
    const save = experienced(); const offer = activeVisit(save).offers.entrance[0];
    takeMail(save, 'entrance', [offer.id]);
    save.worldSeconds = 40;
    advanceRegion(save, 'desert');
    expect(save.bag[0].state).toBe('normal');
    save.worldSeconds = 90;
    advanceRegion(save, 'forest');
    expect(save.routes.visits.map((v) => v.region)).toEqual(['desert', 'forest']);
    expect(save.bag[0].state).toBe('loop');
    expect(save.bag[0].frozenElapsed).toBe(90);
    save.worldSeconds = 900;
    advanceRegion(save, 'coast');
    const outcome = deliver(save, offer.id, false)!;
    expect(outcome.loop).toBe(true);
    expect(outcome.seconds).toBe(90);
    expect(save.bag).toHaveLength(0);
  });

  it('keeps an unvisited cross-region destination timing even after its origin retires', () => {
    const save = experienced(); const offer = activeVisit(save).offers.entrance[0];
    takeMail(save, 'entrance', [offer.id]);
    Object.assign(save.bag[0], { targetRegion: 'desert', addressId: REGIONS.desert.addresses[0].id, targetVisit: null });
    advanceRegion(save, 'forest'); advanceRegion(save, 'alpine');
    expect(save.bag[0].state).toBe('normal');
    expect(save.bag[0].targetVisit).toBeNull();
    advanceRegion(save, 'desert');
    expect(save.bag[0].targetVisit).toBe(activeVisit(save).id);
    expect(save.bag[0].state).toBe('normal');
  });

  it('retires C when returning from C to B and choosing B → D, never reopening A', () => {
    const save = experienced();
    advanceRegion(save, 'desert'); advanceRegion(save, 'forest');
    const offer = activeVisit(save).offers.entrance[0];
    takeMail(save, 'entrance', [offer.id]);
    save.worldSeconds = 130;
    expect(retreatRegion(save)).toBe(true);
    expect(activeVisit(save).region).toBe('desert');
    expect(save.bag[0].state).toBe('normal');
    advanceRegion(save, 'alpine');
    expect(save.routes.visits.map((v) => v.region)).toEqual(['desert', 'alpine']);
    expect(save.bag[0].state).toBe('loop');
    expect(retreatRegion(save)).toBe(true);
    expect(retreatRegion(save)).toBe(false);
    expect(save.player.x).toBe(0);
  });

  it('binds a cross-region letter when its first arrival is a backward trip', () => {
    const save = experienced(); advanceRegion(save, 'desert');
    const offer = activeVisit(save).offers.entrance[0];
    takeMail(save, 'entrance', [offer.id]);
    Object.assign(save.bag[0], { targetRegion: 'coast', addressId: REGIONS.coast.addresses[0].id, targetVisit: null });
    retreatRegion(save);
    expect(save.bag[0].targetVisit).toBe(activeVisit(save).id);
    expect(deliver(save, offer.id, false)).not.toBeNull();
  });

  it('does not regenerate when a small pickup batch is delivered, but does after the entire drawer', () => {
    const save = createSave(1, '整批邮局', 82);
    const visit = activeVisit(save); const ids = visit.offers.entrance.map((o) => o.id);
    for (let i = 0; i < ids.length; i++) {
      expect(takeMail(save, 'entrance', [ids[i]])).toBeNull();
      expect(deliver(save, ids[i], false)).not.toBeNull();
      expect(refreshCompletedStation(save, 'entrance')).toBe(i === ids.length - 1);
    }
    expect(visit.generation.entrance).toBe(1);
    expect(visit.offers.entrance.map((o) => o.id)).not.toEqual(ids);
    expect(refreshCompletedStation(save, 'entrance')).toBe(false);
    expect(visit.taken).toHaveLength(0);
    expect(visit.completed).toHaveLength(0);
    expect(validateSave(save)).toEqual(save);
  });

  it('does not count returns as successful delivery and preserves old carried letters on neighboring revisits', () => {
    const save = experienced(); const visit = activeVisit(save);
    const offers = visit.offers.entrance;
    takeMail(save, 'entrance', [offers[0].id, offers[1].id]);
    returnMail(save, offers[0].id);
    expect(refreshCompletedStation(save, 'entrance')).toBe(false);
    const retained = structuredClone(save.bag[0]);
    advanceRegion(save, 'desert'); retreatRegion(save);
    expect(save.bag[0]).toEqual(retained);
    expect(activeVisit(save).generation.entrance).toBe(1);
    expect(activeVisit(save).offers.entrance.map((o) => o.id)).not.toContain(retained.id);
    expect(validateSave(save)).toEqual(save);
  });

  it('honors parcel sizes and rejects duplicate or over-capacity pickup', () => {
    const save = createSave(1, '容量', 500); const offers = activeVisit(save).offers.entrance;
    expect(takeMail(save, 'entrance', offers.slice(0, 5).map((o) => o.id))).not.toBeNull();
    expect(save.bag).toHaveLength(0);
    takeMail(save, 'entrance', [offers[5].id]);
    expect(usedCapacity(save)).toBe(offers[5].size);
    expect(takeMail(save, 'entrance', [offers[5].id])).not.toBeNull();
  });

  it('caps a claim and never takes the final ten coins or creates debt', () => {
    for (const coins of [0, 7, 10, 11, 50, 500]) {
      const save = experienced(); const offer = activeVisit(save).offers.entrance[0];
      takeMail(save, 'entrance', [offer.id]);
      Object.assign(save.bag[0], { state: 'loop', frozenElapsed: 100, outcome: 'claim' });
      save.player.coins = coins;
      const record = deliver(save, offer.id, false)!;
      expect(record.stars).toBe(0);
      expect(save.player.coins).toBeGreaterThanOrEqual(Math.min(10, coins));
      expect(-record.reward).toBeLessThanOrEqual(Math.floor(coins * .5));
      expect(save.player.trust).toBe(88);
    }
  });

  it('carries the exact two-percent bonus through save/load and never rewards duplicates', () => {
    let save = createSave(1, '小小的加成', 188);
    save.player.inventory.push('lucky-pin'); save.player.equipped.push('lucky-pin');
    const ids = activeVisit(save).offers.entrance.map((o) => o.id);
    let originalRewards = 0;
    for (let index = 0; index < ids.length; index++) {
      const offer = activeVisit(save).offers.entrance.find((o) => o.id === ids[index])!;
      takeMail(save, 'entrance', [offer.id]);
      const stars = starRating(offer.referenceDistance, 30);
      originalRewards += Math.round(offer.baseReward * [0, .65, .8, 1, 1.15, 1.3][stars]);
      expect(deliver(save, offer.id, false, 30)).not.toBeNull();
      const credit = save.player.coinBonusHundredths;
      expect(deliver(save, offer.id, true, 30)).toBeNull();
      expect(save.player.coinBonusHundredths).toBe(credit);
      save = validateSave(JSON.parse(JSON.stringify(save)));
      expect(save.player.coins).toBe(originalRewards + Math.floor(originalRewards * 2 / 100));
      expect(save.player.coinBonusHundredths).toBe(originalRewards * 2 % 100);
    }
  });
});
