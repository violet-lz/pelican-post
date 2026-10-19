import { activeVisit, bindFirstArrival, freezeRetiredMail, makeVisit, replenishOnRevisit } from '../game/mail';
import { levelFor, REGIONS } from './regions';
import type { RegionId, SaveGameV1 } from '../game/types';

export function advanceRegion(save: SaveGameV1, next: RegionId): { entered: boolean; loops: number; reason?: string } {
  const source = activeVisit(save);
  if (!REGIONS[source.region].neighbors.includes(next)) return { entered: false, loops: 0, reason: '这条路没有通往那里。' };
  if (REGIONS[next].level > levelFor(save.stats.delivered)) return { entered: false, loops: 0, reason: `公司还在准备这条邮路，快递等级 Lv${REGIONS[next].level} 后开放。` };
  if (source.region === next) {
    save.player.x = 0;
    return { entered: true, loops: 0 };
  }
  const future = save.routes.visits[save.routes.active + 1];
  if (future?.region === next) {
    save.routes.active++;
    save.player.x = 0;
    replenishOnRevisit(save, future);
    bindFirstArrival(save, future);
    return { entered: true, loops: 0 };
  }
  const retired = save.routes.visits.filter((visit) => visit.id !== source.id).map((visit) => visit.id);
  const ordinal = ++save.stats.regionVisits[next];
  const visit = makeVisit(save.seed, next, ordinal, save.stats.delivered);
  save.routes.visits = [source, visit];
  save.routes.active = 1;
  save.player.x = 0;
  const loops = freezeRetiredMail(save, retired);
  bindFirstArrival(save, visit);
  return { entered: true, loops };
}

export function retreatRegion(save: SaveGameV1): boolean {
  if (save.routes.active <= 0) {
    save.player.x = 0;
    save.player.speed = 0;
    return false;
  }
  save.routes.active--;
  replenishOnRevisit(save, activeVisit(save));
  bindFirstArrival(save, activeVisit(save));
  save.player.x = activeVisit(save).length - 0.01;
  return true;
}
