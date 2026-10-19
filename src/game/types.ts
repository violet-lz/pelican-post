export type RegionId = 'coast' | 'desert' | 'forest' | 'alpine' | 'cloud' | 'desk';
export type Lane = 1 | 2 | 3 | 4 | 5;
export type Season = '春' | '夏' | '秋' | '冬';
export type DayPeriod = '黎明' | '上午' | '午后' | '黄昏' | '夜晚';

export interface Preferences {
  autoDelivery: boolean;
  autoLoopMail: boolean;
  autoItems: boolean;
  autoOutfit: boolean;
  autoFeeding: boolean;
  camera: 'far' | 'near';
  reducedMotion: boolean;
  sound: boolean;
  holdAssist: boolean;
}

export interface Address {
  id: string;
  region: RegionId;
  name: string;
  recipient: string;
  fraction: number;
  lane: Lane;
}

export interface MailOffer {
  id: string;
  addressId: string;
  originRegion: RegionId;
  targetRegion: RegionId;
  targetVisit: string | null;
  size: 1 | 2 | 3;
  kind: '明信片' | '家书' | '文件快递';
  referenceDistance: number;
  baseReward: number;
  outcome: 'thanks' | 'claim';
}

export interface Letter extends MailOffer {
  batchId: string;
  pickedAt: number;
  state: 'normal' | 'loop';
  frozenElapsed: number | null;
}

export interface RegionVisit {
  id: string;
  region: RegionId;
  ordinal: number;
  length: number;
  offers: Record<'entrance' | 'exit', MailOffer[]>;
  generation: Record<'entrance' | 'exit', number>;
  taken: string[];
  completed: string[];
  discovered: string[];
}

export interface RouteWindow {
  visits: RegionVisit[];
  active: number;
  exits: Record<RegionId, RegionId[]>;
}

export interface Player {
  x: number;
  lane: Lane;
  facing: 1 | -1;
  speed: number;
  cruiseActive: boolean;
  stamina: number;
  capacity: number;
  coins: number;
  coinBonusHundredths: number;
  trust: number;
  cold: number;
  wet: number;
  water: number;
  waterEffect: number;
  inventory: string[];
  equipped: string[];
  umbrella: boolean;
  umbrellaLocked: boolean;
  outfitLocked: boolean;
}

export interface Stats {
  seconds: number;
  cyclingSeconds: number;
  distance: number;
  delivered: number;
  ordinaryDelivered: number;
  crossDelivered: number;
  loopDelivered: number;
  manualDelivered: number;
  autoDelivered: number;
  goodReviews: number;
  zeroReviews: number;
  returned: number;
  specialThanks: number;
  earned: number;
  spent: number;
  claims: number;
  falls: number;
  drinks: number;
  warmups: number;
  feeding: number;
  regionVisits: Record<RegionId, number>;
  landmarks: string[];
}

export interface DeliveryRecord {
  id: string;
  recipient: string;
  region: RegionId;
  stars: number;
  reward: number;
  seconds: number;
  loop: boolean;
  automatic: boolean;
  message: string;
}

export interface SaveGameV1 {
  version: 1;
  slot: number;
  id: string;
  name: string;
  seed: number;
  updatedAt: number;
  worldSeconds: number;
  player: Player;
  routes: RouteWindow;
  bag: Letter[];
  preferences: Preferences;
  stats: Stats;
  history: DeliveryRecord[];
  collections: string[];
  purchases: string[];
  nextBatch: number;
}

export type Overlay = 'none' | 'station' | 'pause' | 'settings' | 'journal' | 'shop';

export interface InputState {
  brake: boolean;
  boost: boolean;
}

export interface Notice {
  id: number;
  title: string;
  body: string;
  kind: 'info' | 'delivery' | 'warning';
}

export interface GameSnapshot {
  save: SaveGameV1 | null;
  mode: 'home' | 'playing';
  overlay: Overlay;
  station: 'entrance' | 'exit' | null;
  notices: Notice[];
  saveStatus: 'saved' | 'saving' | 'error';
  saveError: string;
  background: boolean;
  interaction: string;
}
