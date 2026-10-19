import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/game/config';
import { stepRiding } from '../src/game/riding';
import { createSave } from '../src/game/state';
import { validateSave } from '../src/storage/saves';
import type { InputState, Player } from '../src/game/types';

const released: InputState = { brake: false, boost: false };
const braking: InputState = { brake: true, boost: false };
function ride(player: Player, input: InputState, seconds: number): void {
  for (let i = 0; i < Math.ceil(seconds / CONFIG.step); i++) stepRiding(player, input, CONFIG.step);
}

describe('braking, reverse and persistent parking', () => {
  it('starts a new trip in automatic cruise', () => {
    const player = createSave(1, '出发', 7).player;
    ride(player, released, 3);
    expect(player.cruiseActive).toBe(true);
    expect(player.speed).toBeGreaterThan(7);
  });

  it('resumes ordinary cruise if A is released before reaching zero', () => {
    const player = createSave(1, '轻刹', 7).player;
    player.speed = CONFIG.cruise;
    ride(player, braking, .1);
    expect(player.speed).toBeGreaterThan(0);
    expect(player.speed).toBeLessThan(CONFIG.cruise);
    ride(player, released, 3);
    expect(player.cruiseActive).toBe(true);
    expect(player.speed).toBeGreaterThan(7);
  });

  it.each([1, -1] as const)('settles reverse smoothly to exact zero and stays parked when facing %i', (facing) => {
    const player = createSave(1, '停车', 7).player;
    player.facing = facing; player.speed = facing * CONFIG.cruise;
    ride(player, braking, 1.2);
    expect(player.cruiseActive).toBe(false);
    expect(player.speed * facing).toBeLessThan(-3);
    for (let i = 0; i < 240; i++) {
      const before = player.speed;
      stepRiding(player, released, CONFIG.step);
      expect(Math.abs(player.speed)).toBeLessThanOrEqual(Math.abs(before));
      expect(player.speed * facing).toBeLessThanOrEqual(0);
    }
    expect(player.speed).toBe(0);
    ride(player, released, 30);
    expect(player.speed).toBe(0);
    expect(player.facing).toBe(facing);
    expect(player.cruiseActive).toBe(false);
  });

  it('cancels cruise when braking starts at zero', () => {
    const player = createSave(1, '原地刹车', 7).player;
    stepRiding(player, braking, CONFIG.step);
    expect(player.cruiseActive).toBe(false);
    ride(player, released, 4);
    expect(player.speed).toBe(0);
  });

  it('does not let an already-held boost restart cancelled cruise or drain stamina', () => {
    const player = createSave(1, '刹车优先', 7).player;
    player.speed = CONFIG.cruise;
    ride(player, { brake: true, boost: true }, 1.2);
    player.stamina = 50;
    ride(player, { brake: false, boost: true }, 4);
    expect(player.speed).toBe(0);
    expect(player.cruiseActive).toBe(false);
    expect(player.stamina).toBeGreaterThan(50);
  });

  it('preserves parking and coasting through a save roundtrip', () => {
    const save = createSave(1, '随时停留', 7);
    save.player.speed = CONFIG.cruise;
    ride(save.player, braking, 1.2);
    const loaded = validateSave(JSON.parse(JSON.stringify(save)));
    expect(loaded.player.cruiseActive).toBe(false);
    expect(loaded.player.speed).toBe(save.player.speed);
    ride(loaded.player, released, 4);
    expect(loaded.player.speed).toBe(0);
    loaded.player.facing = -1;
    ride(loaded.player, released, 4);
    expect(loaded.player.speed).toBe(0);
    expect(loaded.player.cruiseActive).toBe(false);
  });
});
