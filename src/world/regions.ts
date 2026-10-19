import type { Address, Lane, RegionId } from '../game/types';
import { clamp, hash, random, smoothstep } from '../game/math';

export interface Landmark {
  id: string;
  name: string;
  fraction: number;
  kind: string;
}

export interface RegionDefinition {
  id: RegionId;
  name: string;
  english: string;
  level: number;
  subtitle: string;
  color: string;
  landmarks: Landmark[];
  addresses: Address[];
  neighbors: RegionId[];
}

const definitions: { id: RegionId; name: string; english: string; level: number; subtitle: string; color: string; landmarks: [string, string][]; names: string[]; neighbors: RegionId[] }[] = [
  { id: 'coast', name: '海岸小镇', english: 'THE COAST IS CALLING', level: 1, subtitle: '把海风装进车筐，把问候送到窗前。', color: '#5b9389', landmarks: [['lighthouse', '灯塔岬角'], ['harbor', '渔港码头'], ['village', '彩屋坡街'], ['arch', '海蚀拱门'], ['square', '临海小广场']], names: ['灯塔守望小屋', '码头修船铺', '蓝窗花店', '拱门观潮屋', '海风面包房', '广场书店'], neighbors: ['coast', 'desert', 'forest'] },
  { id: 'desert', name: '吉萨沙漠', english: 'LETTERS ACROSS THE SAND', level: 2, subtitle: '沙丘会流动，远方的地址一直都在。', color: '#c7955d', landmarks: [['pyramid', '金字塔群'], ['sphinx', '狮身人面像'], ['temple', '河谷神庙遗迹'], ['quarry', '台地采石遗迹'], ['palms', '棕榈村街']], names: ['台地观测屋', '石匠的院子', '神庙资料室', '采石场值班室', '棕榈茶铺', '村口邮亭'], neighbors: ['coast', 'forest', 'alpine'] },
  { id: 'forest', name: '亚马孙雨林', english: 'UNDER THE GREEN CANOPY', level: 3, subtitle: '穿过树影，听见一封信的回声。', color: '#648b65', landmarks: [['roots', '板根巨树'], ['vines', '藤蔓廊道'], ['river', '曲流河湾'], ['dock', '木屋码头'], ['wetland', '淹水林']], names: ['巨树巡护站', '藤桥木屋', '河湾船屋', '码头小餐馆', '林间观测站', '苔藓花园'], neighbors: ['coast', 'alpine', 'cloud'] },
  { id: 'alpine', name: '瑞士山谷', english: 'A POSTCARD FROM THE ALPS', level: 4, subtitle: '钟声越过山谷，问候绕过雪峰。', color: '#7a9a9a', landmarks: [['clock', '木屋钟楼村'], ['viaduct', '石拱高桥'], ['waterfall', '瀑布崖壁'], ['pasture', '湖畔牧场'], ['overlook', '山口观景台']], names: ['钟楼木屋', '高桥管理室', '瀑布咖啡馆', '湖畔牧场', '观景台旅舍', '山谷织物铺'], neighbors: ['coast', 'desert', 'cloud'] },
  { id: 'cloud', name: '云鲸群岛', english: 'A LITTLE CLOSER TO THE SKY', level: 5, subtitle: '今天的邮路，漂浮在云的上面。', color: '#9a98b5', landmarks: [['whale', '云鲸停泊港'], ['rootbridge', '悬岛根桥'], ['chimes', '风铃塔'], ['cloudfall', '云海瀑布'], ['glasshouse', '星光温室']], names: ['云鲸候船室', '根桥守桥屋', '风铃工坊', '云瀑观测站', '星光温室', '云层杂货铺'], neighbors: ['forest', 'alpine', 'desk'] },
  { id: 'desk', name: '微缩工作台', english: 'SMALL WORLD, BIG LETTERS', level: 6, subtitle: '一张桌子，也是辽阔的远方。', color: '#b59678', landmarks: [['books', '书本峡谷'], ['pencilbridge', '铅笔斜拉桥'], ['spools', '线轴花园'], ['lamp', '台灯拱门'], ['clockwork', '旧钟机芯']], names: ['书页边的小屋', '铅笔桥邮亭', '线轴花园', '台灯看守屋', '钟表修理铺', '积木邮局'], neighbors: ['coast', 'cloud', 'forest'] },
];

const recipients = ['阿晴', '林爷爷', '米娅', '周先生', '小满', '安娜'];
const landmarkFractions = [0.12, 0.3, 0.49, 0.68, 0.86];
const addressFractions = [0.155, 0.325, 0.51, 0.7, 0.83, 0.91];

export const REGIONS = Object.fromEntries(definitions.map((d) => [d.id, {
  ...d,
  landmarks: d.landmarks.map(([kind, name], index) => ({ id: `${d.id}:${kind}`, kind, name, fraction: landmarkFractions[index] })),
  addresses: d.names.map((name, index) => ({ id: `${d.id}:address:${index}`, region: d.id, name, recipient: recipients[index], fraction: addressFractions[index], lane: (index % 3 + 2) as Lane })),
}])) as unknown as Record<RegionId, RegionDefinition>;

export const REGION_IDS = definitions.map((d) => d.id);

export function regionLength(seed: number, region: RegionId): number {
  return Math.round(2200 + random(hash(seed, region, 'length'))() * 800);
}

export function levelFor(deliveries: number): number {
  return [0, 5, 15, 30, 50, 80].filter((threshold) => deliveries >= threshold).length;
}

export function addressById(id: string): Address | undefined {
  return REGION_IDS.flatMap((region) => REGIONS[region].addresses).find((address) => address.id === id);
}

export function stationX(kind: 'entrance' | 'exit', length: number): number {
  return kind === 'entrance' ? 70 : length - 85;
}

export function availableLanes(x: number, length: number): Lane[] {
  const u = x / length;
  const lanes: Lane[] = [2, 3, 4];
  if (u >= 0.255 && u <= 0.425) lanes.unshift(1);
  if (u >= 0.64 && u <= 0.79) lanes.push(5);
  return lanes;
}

export function canChangeLane(from: Lane, to: Lane, x: number, length: number): boolean {
  if (Math.abs(to - from) !== 1 || !availableLanes(x, length).includes(to)) return false;
  const u = x / length;
  if (from === 1 || to === 1) return (u >= 0.255 && u <= 0.285) || (u >= 0.395 && u <= 0.425);
  if (from === 5 || to === 5) return (u >= 0.64 && u <= 0.675) || (u >= 0.755 && u <= 0.79);
  return true;
}

export function laneY(lane: Lane, x: number, length: number): number {
  const terrain = Math.sin(x * 0.005) * 10 + Math.sin(x * 0.013) * 5;
  const separation = 51 + Math.sin(x * 0.003) * 9;
  const base = 525 + terrain;
  const u = x / length;
  if (lane === 1) {
    const ramp = Math.min(smoothstep((u - 0.255) / 0.03), smoothstep((0.425 - u) / 0.03));
    return base - separation - clamp(ramp, 0, 1) * 125;
  }
  if (lane === 5) {
    const ramp = Math.min(smoothstep((u - 0.64) / 0.035), smoothstep((0.79 - u) / 0.035));
    return base + separation + clamp(ramp, 0, 1) * 58;
  }
  return base + (lane - 3) * separation;
}

export function nearestExitToward(from: RegionId, target: RegionId, unlocked: number): RegionId | null {
  if (from === target) return null;
  const queue: { region: RegionId; first: RegionId | null }[] = [{ region: from, first: null }];
  const seen = new Set<RegionId>([from]);
  while (queue.length) {
    const node = queue.shift()!;
    for (const next of REGIONS[node.region].neighbors) {
      if (seen.has(next) || REGIONS[next].level > unlocked) continue;
      const first = node.first ?? next;
      if (next === target) return first;
      seen.add(next);
      queue.push({ region: next, first });
    }
  }
  return null;
}
