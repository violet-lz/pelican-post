import { describe, expect, it } from 'vitest';
import { validateSave } from '../src/storage/saves';
import { createSave } from '../src/game/state';
import { activeVisit, takeMail } from '../src/game/mail';

describe('save validation before import or write', () => {
  it('roundtrips a complete snapshot without changing timers, preferences, or letters', () => {
    const save = createSave(2, '海边的问候', 555);
    save.worldSeconds = 99;
    takeMail(save, 'entrance', [activeVisit(save).offers.entrance[0].id]);
    save.preferences.autoDelivery = true; save.preferences.camera = 'near'; save.player.cold = 43;
    const decoded = validateSave(JSON.parse(JSON.stringify(save)));
    expect(decoded).toEqual(save);
    expect(decoded).not.toBe(save);
  });

  it.each([
    (s: ReturnType<typeof createSave>) => { s.stats.distance = Number.NaN; },
    (s: ReturnType<typeof createSave>) => { s.player.speed = Number.POSITIVE_INFINITY; },
    (s: ReturnType<typeof createSave>) => { s.player.coins = -1; },
    (s: ReturnType<typeof createSave>) => { s.player.coinBonusHundredths = 100; },
    (s: ReturnType<typeof createSave>) => { s.player.cruiseActive = 'yes' as unknown as boolean; },
    (s: ReturnType<typeof createSave>) => { s.routes.active = 2; },
    (s: ReturnType<typeof createSave>) => { s.routes.visits[0].completed = ['not-in-this-drawer']; },
    (s: ReturnType<typeof createSave>) => { s.player.x = 100000; },
    (s: ReturnType<typeof createSave>) => { s.preferences.autoDelivery = 'yes' as unknown as boolean; },
    (s: ReturnType<typeof createSave>) => { s.routes.visits[0].offers.entrance[0].addressId = 'missing'; },
  ])('rejects broken data before it can replace a valid snapshot', (mutate) => {
    const save = createSave(1, '坏记录', 5);
    mutate(save);
    expect(() => validateSave(save)).toThrow();
  });

  it('reads an earlier v1 snapshot with zero pending bonus without mutating the imported object', () => {
    const save = createSave(1, '早期邮路', 5);
    const earlier = JSON.parse(JSON.stringify(save));
    delete earlier.player.coinBonusHundredths;
    expect(validateSave(earlier).player.coinBonusHundredths).toBe(0);
    expect('coinBonusHundredths' in earlier.player).toBe(false);
  });

  it('migrates pre-parking saves to their original automatic cruise without mutating them', () => {
    const earlier = JSON.parse(JSON.stringify(createSave(1, '早期巡航', 5)));
    delete earlier.player.cruiseActive;
    expect(validateSave(earlier).player.cruiseActive).toBe(true);
    expect('cruiseActive' in earlier.player).toBe(false);
  });
});
