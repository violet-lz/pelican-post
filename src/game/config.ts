import type { Preferences } from './types';

export const CONFIG = {
  step: 1 / 60,
  cruise: 7.2,
  boost: 11,
  reverse: 3.6,
  secondsPerDay: 120,
  daysPerSeason: 4,
  daysPerYear: 16,
  chunkSize: 256,
  maxChunks: 7,
  maxObjects: 1200,
  maxParticles: 180,
  maxTextureBytes: 128 * 1024 * 1024,
  pixelsPerMeter: 16,
  laneChangeSeconds: 0.62,
  actorFrames: 144,
  actorWidth: 350,
  actorHeight: 300,
  actorColumns: 12,
  actorScale: .612,
  metersPerActorLoop: 2 * Math.PI * 45 * .612 / 16 * 4,
  autoSaveSeconds: 15,
} as const;

export const DEFAULT_PREFERENCES: Preferences = {
  autoDelivery: false,
  autoLoopMail: true,
  autoItems: true,
  autoOutfit: true,
  autoFeeding: false,
  camera: 'far',
  reducedMotion: false,
  sound: true,
  holdAssist: false,
};
