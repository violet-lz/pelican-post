import { CONFIG } from './config';
import { clamp, lerp } from './math';
import type { InputState, Player } from './types';

export interface RidingLimits {
  turning?: boolean;
  slowed?: boolean;
  forwardBlocked?: boolean;
  retreatRemaining?: number;
}

export function stepRiding(player: Player, input: InputState, dt: number, limits: RidingLimits = {}): void {
  // Reverse is relative to the bird's facing, including after a Q turn.
  if (input.brake && player.speed * player.facing <= 0) player.cruiseActive = false;
  const boosted = player.cruiseActive && input.boost && player.stamina > 1 && !input.brake;
  player.stamina = clamp(player.stamina + (boosted ? -6 : 3.2) * dt, 0, 100);
  const bearing = player.equipped.includes('smooth-bearing') ? 1.03 : 1;
  let target = input.brake ? -player.facing * CONFIG.reverse
    : player.cruiseActive ? player.facing * (boosted ? CONFIG.boost : CONFIG.cruise) * bearing : 0;
  if (limits.turning) target = 0;
  if (limits.slowed) target *= .32;
  if (limits.forwardBlocked && target > 0) target = 0;
  if (limits.retreatRemaining !== undefined && target < 0) target *= clamp(limits.retreatRemaining / 8, 0, 1);
  player.speed = lerp(player.speed, target, 1 - Math.exp(-dt * (input.brake ? 3.5 : 2.6)));
  if (input.brake && player.speed * player.facing <= 0) player.cruiseActive = false;
  // Settle exactly instead of keeping a tiny exponential drift forever.
  if (target === 0 && Math.abs(player.speed) < .025) player.speed = 0;
}
