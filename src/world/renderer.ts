import { Application, Assets, Container, Graphics, Rectangle, RenderTexture, Sprite, Text, Texture } from 'pixi.js';
import { GameEngine, exitOptions, objectX } from '../game/engine';
import { calendar } from '../game/clock';
import { CONFIG } from '../game/config';
import { activeVisit } from '../game/mail';
import { clamp, hash, lerp, smoothstep } from '../game/math';
import type { Lane, RegionId } from '../game/types';
import { houseSvg, landmarkSvg, objectSvgs, shopSvg, stationSvg, treeSvg } from './art';
import { laneY, levelFor, nearestExitToward, REGIONS, REGION_IDS, stationX } from './regions';

type Color = [number, number, number];
function rgb(hex: number): Color { return [hex >> 16, (hex >> 8) & 255, hex & 255]; }
function mix(a: number, b: number, t: number): number { const aa = rgb(a), bb = rgb(b); return (Math.round(lerp(aa[0], bb[0], t)) << 16) | (Math.round(lerp(aa[1], bb[1], t)) << 8) | Math.round(lerp(aa[2], bb[2], t)); }

const PALETTES = [
  { at: 0, top: 0xdde6d7, bottom: 0xf3e1bc, sea: 0x8caf9c, ground: 0xc2c6a9, road: 0x9aaa90 },
  { at: .22, top: 0xd1e2d4, bottom: 0xece6c9, sea: 0x7fa99c, ground: 0xc6cbb0, road: 0x9cae95 },
  { at: .46, top: 0xe1e6d2, bottom: 0xf4e7c7, sea: 0x88ada1, ground: 0xcacfaf, road: 0x9eae92 },
  { at: .68, top: 0xd0b6a9, bottom: 0xf0ceac, sea: 0x91a9a0, ground: 0xc6b99b, road: 0x9c9d86 },
  { at: .87, top: 0x233e46, bottom: 0x6a827d, sea: 0x547c78, ground: 0x738773, road: 0x617b6b },
  { at: 1, top: 0xdde6d7, bottom: 0xf3e1bc, sea: 0x8caf9c, ground: 0xc2c6a9, road: 0x9aaa90 },
];

export class SceneRenderer {
  private app = new Application();
  private root = new Container();
  private sky = new Graphics();
  private distant = new Graphics();
  private scenery = new Container();
  private roads = new Graphics();
  private objects = new Container();
  private details = new Graphics();
  private actor!: Sprite;
  private shadow = new Graphics();
  private overlayArt = new Graphics();
  private textures = new Map<string, Texture>();
  private sprites = new Map<string, Sprite>();
  private labels = new Map<string, Text>();
  private touched = new Set<string>();
  private actorFrames: Texture[] = [];
  private resizeObserver?: ResizeObserver;
  private dead = false;
  private zoom = 1;
  private anchor = 0.6;
  private actorY = 525;
  private actorScale = 1.176;
  private lastMode = 'home';
  private phaseOffset = 0;
  private lastActorPhase = 0;
  private palette: Record<string, number> = { ...PALETTES[0] };
  private host: HTMLElement;
  private engine: GameEngine;
  private lastRegion = '';
  private fade = 1;
  private textureBytes = 0;
  private desiredRegions = new Set<RegionId>(['coast']);
  private residentRegions = new Map<RegionId, string[]>();
  private regionLoads = new Map<RegionId, Promise<void>>();
  private cleaned = false;
  private transitionImage: Sprite | null = null;
  private transitionBytes = 0;
  private transitionAge = 1;
  private sceneKey = '';
  private lastWorldX = 0;

  constructor(host: HTMLElement, engine: GameEngine) { this.host = host; this.engine = engine; }

  async init(): Promise<void> {
    await this.app.init({ width: this.host.clientWidth, height: this.host.clientHeight, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true, antialias: true, backgroundAlpha: 0, powerPreference: 'low-power', preference: 'webgl' });
    if (this.dead) { this.app.destroy(true); return; }
    this.app.canvas.setAttribute('aria-label', '鹈鹕骑着自行车，穿过海岸、岔路和远方的风景');
    this.app.canvas.setAttribute('role', 'img');
    this.host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.root);
    this.root.addChild(this.sky, this.distant, this.scenery, this.roads, this.shadow, this.objects, this.details, this.overlayArt);
    this.scenery.sortableChildren = true; this.objects.sortableChildren = true;
    const atlas = await Assets.load<Texture>(`${import.meta.env.BASE_URL}assets/pelican-riding.png`);
    this.textureBytes += atlas.source.width * atlas.source.height * 4;
    for (let i = 0; i < CONFIG.actorFrames; i++) this.actorFrames.push(new Texture({ source: atlas.source, frame: new Rectangle((i % CONFIG.actorColumns) * CONFIG.actorWidth, Math.floor(i / CONFIG.actorColumns) * CONFIG.actorHeight, CONFIG.actorWidth, CONFIG.actorHeight) }));
    this.actor = new Sprite(this.actorFrames[0]); this.actor.anchor.set(183 / 420, .95); this.objects.addChild(this.actor);
    const sources: [string, string][] = Object.entries(objectSvgs);
    sources.push(['shop', shopSvg()]);
    await Promise.all([
      ...sources.map(async ([key, svg]) => {
        const texture = await this.rasterize(svg);
        if (this.dead) texture.destroy(true);
        else { this.textures.set(key, texture); this.textureBytes += texture.source.width * texture.source.height * 4; }
      }),
      this.loadRegion('coast'),
    ]);
    if (this.dead) { this.cleanup(); return; }
    this.resizeObserver = new ResizeObserver(() => { if (!this.dead && this.host.clientWidth && this.host.clientHeight) this.app.renderer.resize(this.host.clientWidth, this.host.clientHeight); });
    this.resizeObserver.observe(this.host);
    this.app.ticker.maxFPS = 60;
    this.app.ticker.add((ticker) => { const dt = ticker.deltaMS / 1000; this.engine.update(dt); if (!document.hidden) this.draw(dt); });
    this.draw(0.016);
  }

  private async rasterize(svg: string): Promise<Texture> {
    const blob = new Blob([svg], { type: 'image/svg+xml' }); const url = URL.createObjectURL(blob);
    try {
      const image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      canvas.getContext('2d')!.drawImage(image, 0, 0);
      return Texture.from(canvas);
    } finally { URL.revokeObjectURL(url); }
  }

  private loadRegion(region: RegionId): Promise<void> {
    if (this.residentRegions.has(region)) return Promise.resolve();
    const pending = this.regionLoads.get(region); if (pending) return pending;
    const sources: [string, string][] = [[`station:${region}`, stationSvg(region)], [`tree:${region}`, treeSvg(region)]];
    for (let i = 0; i < 3; i++) sources.push([`house:${region}:${i}`, houseSvg(region, i)]);
    for (const landmark of REGIONS[region].landmarks) sources.push([`landmark:${landmark.kind}`, landmarkSvg(landmark.kind)]);
    const operation = Promise.all(sources.map(async ([key, svg]) => [key, await this.rasterize(svg)] as const)).then((entries) => {
      if (this.dead || !this.desiredRegions.has(region)) { entries.forEach(([, texture]) => texture.destroy(true)); return; }
      for (const [key, texture] of entries) {
        this.textures.set(key, texture);
        this.textureBytes += texture.source.width * texture.source.height * 4;
      }
      this.residentRegions.set(region, entries.map(([key]) => key));
    }).finally(() => this.regionLoads.delete(region));
    this.regionLoads.set(region, operation);
    return operation;
  }

  private evictRegions(): void {
    for (const [region, keys] of this.residentRegions) if (!this.desiredRegions.has(region)) {
      for (const key of keys) {
        const texture = this.textures.get(key);
        if (texture) { this.textureBytes -= texture.source.width * texture.source.height * 4; texture.destroy(true); this.textures.delete(key); }
      }
      this.residentRegions.delete(region);
    }
  }

  private captureTransition(): void {
    if (this.engine.preferences.reducedMotion || !this.sceneKey) return;
    // Keep one small image of the departing landscape; it releases after one second.
    const resolution = Math.min(1, 1920 / this.app.screen.width, 1080 / this.app.screen.height);
    const texture = RenderTexture.create({ width: this.app.screen.width, height: this.app.screen.height, resolution });
    const hidden = [this.actor, this.shadow, this.objects, this.details, this.overlayArt];
    const visibility = hidden.map((item) => item.visible);
    try {
      hidden.forEach((item) => { item.visible = false; });
      this.app.renderer.render({ container: this.root, target: texture, clear: true });
    } finally { hidden.forEach((item, i) => { item.visible = visibility[i]; }); }
    this.releaseTransition();
    this.transitionImage = new Sprite(texture);
    this.transitionImage.width = this.app.screen.width / this.root.scale.x;
    this.transitionImage.height = this.app.screen.height / this.root.scale.y;
    this.root.addChildAt(this.transitionImage, this.root.getChildIndex(this.shadow));
    this.transitionBytes = Math.ceil(this.app.screen.width * resolution) * Math.ceil(this.app.screen.height * resolution) * 4;
    this.transitionAge = 0;
  }

  private releaseTransition(): void {
    if (!this.transitionImage) return;
    this.transitionImage.texture.destroy(true);
    this.transitionImage.destroy(); this.transitionImage = null; this.transitionBytes = 0;
  }

  private sprite(key: string, texture: string, x: number, y: number, scale: number, layer = this.scenery, z = y): Sprite {
    this.touched.add(key);
    let sprite = this.sprites.get(key);
    const tex = this.textures.get(texture) ?? Texture.EMPTY;
    if (!sprite) { sprite = new Sprite(tex); sprite.anchor.set(.5, 1); this.sprites.set(key, sprite); layer.addChild(sprite); }
    if (sprite.texture !== tex) sprite.texture = tex;
    sprite.position.set(x, y); sprite.scale.set(scale); sprite.zIndex = z; sprite.alpha = 1;
    return sprite;
  }
  private label(key: string, value: string, x: number, y: number, size = 11, color = '#4f7160', alpha = 1): Text {
    this.touched.add(key);
    let text = this.labels.get(key);
    if (!text) { text = new Text({ text: value, style: { fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif', fontSize: size, fill: color, letterSpacing: 1, fontWeight: '500' }, resolution: 2 }); text.anchor.set(.5); this.labels.set(key, text); this.objects.addChild(text); }
    text.text = value; text.position.set(x, y); text.alpha = alpha; text.zIndex = 1000;
    return text;
  }

  private draw(dt: number): void {
    if (!this.actor || this.dead) return;
    const engine = this.engine; const playing = engine.mode === 'playing' && !!engine.save;
    const save = engine.save; const visit = playing ? activeVisit(save!) : null;
    const homeRegion = REGION_IDS[Math.floor(engine.homeSeconds / 40) % REGION_IDS.length];
    const region = visit?.region ?? homeRegion;
    const length = visit?.length ?? 2600;
    const x = playing ? engine.renderX : 230 + (engine.homeSeconds % 40) * 6.5;
    const seconds = playing ? save!.worldSeconds : 14 + engine.homeSeconds * .25;
    const { phase, season } = calendar(seconds);
    const height = 700; const baseScale = this.app.screen.height / height; const width = this.app.screen.width / baseScale;
    this.root.scale.set(baseScale);
    const targetZoom = playing ? engine.preferences.camera === 'far' ? 1 : 1.33 : 1.08;
    this.zoom = lerp(this.zoom, targetZoom, 1 - Math.exp(-dt * 3));
    const zoom = this.zoom;
    const direction = playing ? save!.player.facing : 1;
    const targetAnchor = playing ? direction === 1 ? .34 : .64 : .58;
    this.anchor = lerp(this.anchor, targetAnchor, 1 - Math.exp(-dt * 2.8));
    const anchor = width * this.anchor;
    const ground = 515;
    const sx = (wx: number, parallax = 1) => anchor + (wx - x) * CONFIG.pixelsPerMeter * parallax * zoom;
    const sy = (lane: Lane, wx: number) => ground + (laneY(lane, wx, length) - 525) * zoom;
    const sceneKey = `${engine.mode}:${visit?.id ?? homeRegion}`;
    if (sceneKey !== this.sceneKey || Math.abs(x - this.lastWorldX) > 90) this.captureTransition();
    this.sceneKey = sceneKey; this.lastWorldX = x;
    if (this.transitionImage) {
      this.transitionAge += dt;
      this.transitionImage.alpha = 1 - smoothstep(this.transitionAge);
      this.transitionImage.width = this.app.screen.width / baseScale;
      this.transitionImage.height = height;
      if (this.transitionAge >= 1) this.releaseTransition();
    }
    this.desiredRegions = new Set(playing ? save!.routes.visits.map((v) => v.region) : [homeRegion]);
    if (playing && length - save!.player.x < 200) {
      const preview = engine.visual.previewRegion ?? engine.selectedExit?.region;
      if (preview) this.desiredRegions.add(preview);
    } else if (!playing) {
      if (engine.homeSeconds % 40 > 32) this.desiredRegions.add(REGION_IDS[(Math.floor(engine.homeSeconds / 40) + 1) % REGION_IDS.length]);
      if (save) this.desiredRegions.add(activeVisit(save).region);
    }
    for (const desired of this.desiredRegions) void this.loadRegion(desired).catch(() => {});
    if (this.lastRegion !== region) { this.lastRegion = region; this.fade = 0; }
    if (this.residentRegions.has(region)) this.fade = Math.min(1, this.fade + dt * 1.3);
    this.touched.clear(); this.details.clear(); this.overlayArt.clear();
    this.drawBackground(width, height, region, x, phase, seconds, dt, season);

    // Major landmarks move more slowly than the road and remain readable while riding.
    for (const landmark of REGIONS[region].landmarks) {
      const px = sx(landmark.fraction * length, .22);
      if (px < -330 || px > width + 330) continue;
      const scale = .94 * zoom;
      const p = this.sprite(`landmark:${landmark.id}`, `landmark:${landmark.kind}`, px, 443, scale, this.scenery, 15);
      p.alpha = this.fade;
      this.label(`landmark-title:${landmark.id}`, landmark.name, px, 444, 11, '#647961', this.fade * .9);
    }

    // A bounded set of local homes and trees creates changing neighborhoods between landmarks.
    const localStart = Math.floor((x - width / (16 * .5)) / 45);
    const localEnd = Math.ceil((x + width / (16 * .5)) / 45);
    for (let index = localStart; index <= localEnd; index++) {
      const wx = index * 45; const px = sx(wx, .5);
      if (px < -210 || px > width + 210) continue;
      const variant = hash(region, index) % 3;
      if (index % 3 === 0) {
        const p = this.sprite(`home:${region}:${index}`, `house:${region}:${variant}`, px, 454, .58 * zoom, this.scenery, 20);
        p.alpha = .9 * this.fade;
      } else {
        const p = this.sprite(`tree:${region}:${index}`, `tree:${region}`, px, 454, (.37 + variant * .08) * zoom, this.scenery, 25);
        p.alpha = .86 * this.fade;
      }
    }

    this.drawRoads(width, x, length, anchor, zoom, ground, playing ? save!.player.lane : 3, region);

    if (playing) {
      for (const chunk of engine.chunks.chunks.values()) for (const object of chunk.objects) {
        const wx = objectX(object, seconds); const px = sx(wx);
        if (px < -150 || px > width + 150) continue;
        const decorative = ['planter', 'flowers', 'bench', 'sign'].includes(object.kind);
        const py = sy(object.lane, wx) + (decorative ? -24 : 0);
        const scale = (object.kind === 'car' ? .95 : object.kind === 'pedestrian' ? .85 : .9) * zoom;
        const p = this.sprite(`object:${object.id}`, object.kind, px, py, scale, this.objects, py);
        if (object.kind === 'pedestrian' && engine.visual.bell > 0) p.x += Math.sin(engine.visual.bell * 4) * 5;
        p.tint = object.variant === 1 && object.kind === 'car' ? 0xa9c4b5 : 0xffffff;
      }
    }

    // Post offices stay attached to the middle road. The open drawer is part of the scene.
    for (const kind of ['entrance', 'exit'] as const) {
      const wx = stationX(kind, length); const px = sx(wx);
      if (px < -220 || px > width + 220) continue;
      const py = sy(3, wx) - 24 * zoom; const scale = .82 * zoom;
      this.sprite(`station:${kind}`, `station:${region}`, px, py, scale, this.scenery, 50);
      this.label(`station-label:${kind}`, kind === 'entrance' ? '海风邮局'.replace('海风', region === 'coast' ? '海风' : REGIONS[region].name.slice(0, 2)) : '远行邮亭', px, py + 9 * zoom, 11);
      if (engine.overlay === 'station' && engine.station === kind && engine.visual.drawer > .01) {
        const amount = smoothstep(engine.visual.drawer);
        const dx = px + (218 - 175) * scale - amount * 3;
        const dy = py + (214 - 280) * scale + amount * 15;
        this.details.rect(dx - 28 * scale, dy, 57 * scale, 24 * scale).fill(0xc3a176);
        this.details.rect(dx - 28 * scale, dy - 7 * amount, 57 * scale, 8 * amount + 2).fill(0x6d7155);
        this.details.roundRect(dx - 18 * scale, dy - 9 * amount, 35 * scale, 8, 1).fill(0xf5e8c7);
        this.details.moveTo(dx - 6, dy + 10).lineTo(dx + 6, dy + 10).stroke({ color: 0x73684b, width: 2 });
      }
    }

    for (const address of REGIONS[region].addresses) {
      const wx = address.fraction * length; const px = sx(wx);
      if (px < -120 || px > width + 120) continue;
      const py = sy(address.lane, wx) - 13 * zoom;
      this.sprite(`mailbox:${address.id}`, 'mailbox', px, py, .74 * zoom, this.objects, py);
      const pending = playing && save!.bag.some((letter) => letter.addressId === address.id && (letter.state === 'loop' || letter.targetVisit === visit!.id));
      if (pending) {
        const by = py - 94 * zoom - Math.sin(seconds * 2.5) * 3;
        this.details.roundRect(px - 14, by - 11, 28, 21, 3).fill(0xfff6dc).stroke({ color: 0xb18759, width: 1.5 });
        this.details.moveTo(px - 12, by - 9).lineTo(px, by).lineTo(px + 12, by - 9).stroke({ color: 0xb18759, width: 1.5 });
      }
      this.label(`mailbox-label:${address.id}`, `${address.name} · ${address.lane} 号路`, px, py - 101 * zoom - (pending ? 20 : 0), 10);
    }

    if (playing && levelFor(save!.stats.delivered) >= 2) {
      const wx = length * .565; const px = sx(wx);
      if (px > -210 && px < width + 210) {
        this.sprite('shop', 'shop', px, sy(3, wx) - 26, .85 * zoom, this.scenery, 55);
        this.label('shop-label', '路边的小物件', px, sy(3, wx) - 8, 11);
      }
    }

    if (playing && save!.routes.active === 0 && x < 90) {
      const px = sx(-3); const py = sy(3, 0);
      if (px > -200) {
        this.sprite('block', 'block', px, py, .85 * zoom, this.objects, py + 10);
        this.label('block-label', region === 'desert' ? '前方落石清理中 · 换个方向看看吧' : '海鸥正在修路 · 往前总有好风景', px, py - 112 * zoom, 10);
      }
    }

    if (playing && (length - x < 180 || engine.visual.previewRegion)) this.drawExits(width, length, sx, sy, zoom);

    const actualY = playing ? ground + (engine.lanePosition() - 525) * zoom : sy(3, x);
    this.actorY = lerp(this.actorY, actualY, 1 - Math.exp(-dt * 18));
    const jumping = playing ? engine.visual.jump * zoom : 0;
    this.actorScale = lerp(this.actorScale, playing ? CONFIG.actorScale : 1.176, 1 - Math.exp(-dt * 3));
    const actorScale = this.actorScale * zoom;
    const turn = playing && engine.visual.turn < 1 ? engine.visual.turnFrom * Math.cos(smoothstep(engine.visual.turn) * Math.PI) : direction;
    const rawPhase = playing ? engine.visual.phase : engine.homeSeconds * 6.5 / (2 * Math.PI * 45 * 1.176 / 16 * 4);
    if (engine.mode !== this.lastMode) { this.phaseOffset = this.lastActorPhase - rawPhase; this.lastMode = engine.mode; }
    const ridingPhase = rawPhase + this.phaseOffset;
    this.lastActorPhase = ridingPhase;
    this.actor.texture = this.actorFrames[((Math.floor(ridingPhase * CONFIG.actorFrames) % CONFIG.actorFrames) + CONFIG.actorFrames) % CONFIG.actorFrames];
    this.actor.position.set(anchor, this.actorY - jumping);
    this.actor.scale.set(turn * actorScale, actorScale);
    this.actor.zIndex = this.actorY + 2;
    this.actor.rotation = playing && !engine.preferences.reducedMotion ? Math.sin(engine.visual.bump * 22) * .025 * Math.min(1, engine.visual.bump) : 0;
    this.actor.tint = phase > .78 && phase < .95 ? 0xd8e4d5 : 0xffffff;
    this.shadow.clear().ellipse(anchor + 16, this.actorY + 1, 103 * actorScale * (1 - jumping / 300), 8 * actorScale).fill({ color: 0x3e6653, alpha: .19 - jumping / 900 });
    if (playing && save!.player.equipped.includes('lucky-pin')) this.details.circle(anchor + 99 * zoom * direction, this.actorY - 91 * zoom - jumping, 4 * zoom).fill(0xe4bc70);
    if (engine.visual.bell > 0) this.label('bell', '♪', anchor + 116 * zoom * direction, this.actorY - 125 * zoom - (2 - engine.visual.bell) * 14, 22, '#ad8957', Math.min(1, engine.visual.bell));

    if (playing) for (const flight of engine.flights) {
      if (flight.region !== visit!.id) continue;
      const t = smoothstep(flight.age / 1.15);
      const ex = lerp(anchor + 60 * direction, sx(flight.x), t);
      const ey = lerp(this.actorY - 100, sy(flight.lane, flight.x) - 50, t) - Math.sin(t * Math.PI) * 70;
      this.overlayArt.roundRect(ex - 10, ey - 6, 20, 13, 2).fill({ color: 0xfff6dc, alpha: 1 - t * .5 }).stroke({ color: 0xb99865, width: 1 });
      this.overlayArt.moveTo(ex - 10, ey - 6).lineTo(ex, ey).lineTo(ex + 10, ey - 6).stroke({ color: 0xb99865, width: 1 });
    }
    // Remove display objects as soon as they leave the visible window; shared textures are finite.
    for (const [key, sprite] of this.sprites) if (!this.touched.has(key)) { sprite.destroy(); this.sprites.delete(key); }
    for (const [key, label] of this.labels) if (!this.touched.has(key)) { label.destroy(); this.labels.delete(key); }
    this.evictRegions();
  }

  private drawBackground(width: number, height: number, region: RegionId, x: number, phase: number, seconds: number, dt: number, season: string): void {
    let a = PALETTES[0], b = PALETTES[1];
    for (let i = 0; i < PALETTES.length - 1; i++) if (phase >= PALETTES[i].at && phase <= PALETTES[i + 1].at) { a = PALETTES[i]; b = PALETTES[i + 1]; break; }
    const t = smoothstep((phase - a.at) / (b.at - a.at));
    const desert = region === 'desert';
    for (const key of ['top', 'bottom', 'sea', 'ground', 'road'] as const) {
      let target = mix(a[key], b[key], t);
      if (desert) target = mix(target, key === 'top' ? 0xe6d6b8 : key === 'bottom' ? 0xf4dfb7 : key === 'ground' ? 0xddbf91 : key === 'road' ? 0xc6ae87 : 0xd0ae7d, key === 'top' ? .48 : .8);
      if (region === 'forest') target = mix(target, key === 'ground' ? 0x9cae88 : 0x8eaf94, .35);
      if (region === 'cloud') target = mix(target, key === 'ground' ? 0xc3c6c0 : 0xbdc7cc, .5);
      if (region === 'desk') target = mix(target, key === 'ground' ? 0xc2ad8d : 0xd4c8b0, .5);
      if (region === 'alpine' && season === '冬') target = mix(target, 0xdce2d2, .4);
      this.palette[key] = mix(this.palette[key], target, 1 - Math.exp(-dt * 2));
    }
    this.sky.clear();
    for (let i = 0; i < 22; i++) this.sky.rect(0, i * 21, width, 22).fill(mix(this.palette.top, this.palette.bottom, i / 21));
    const sunProgress = phase / .8;
    const sunX = -100 + sunProgress * (width + 200); const sunY = 322 - Math.sin(sunProgress * Math.PI) * 224;
    if (phase < .8) {
      for (let i = 4; i > 0; i--) this.sky.circle(sunX, sunY, 29 + i * 16).fill({ color: 0xffedc2, alpha: .025 * (5 - i) });
      this.sky.circle(sunX, sunY, 28).fill({ color: 0xfff0c5, alpha: .9 });
    }
    const moonProgress = ((phase + .2) % 1) / .4;
    if (phase > .77 || phase < .09) {
      const mx = -60 + moonProgress * (width + 120); const my = 310 - Math.sin(moonProgress * Math.PI) * 213;
      this.sky.circle(mx, my, 19).fill({ color: 0xf4e9c8, alpha: phase < .09 ? .35 : .9 });
      this.sky.circle(mx + 8, my - 5, 17).fill(this.palette.top);
    }
    const night = phase > .72 ? Math.sin((phase - .72) / .28 * Math.PI) : 0;
    for (let i = 0; i < 27; i++) {
      const seed = hash('stars', i); const px = (seed % 1000) / 1000 * width; const py = 30 + ((seed >> 5) % 220);
      this.sky.circle(px, py, i % 6 === 0 ? 1.6 : 1).fill({ color: 0xfff2d0, alpha: Math.max(0, night) * (.4 + .2 * Math.sin(seconds * .8 + i)) });
    }
    // Slow clouds use analytic positions, so there is no accumulating particle list.
    for (let i = 0; i < 5; i++) {
      const px = ((i * 357 - x * .13 + seconds * 1.6) % (width + 450) + width + 450) % (width + 450) - 170;
      const py = 95 + (i % 3) * 45;
      this.sky.ellipse(px, py, 80 + (i % 2) * 24, 13).ellipse(px + 42, py - 8, 43, 21).ellipse(px - 38, py - 6, 32, 15).fill({ color: 0xfff7dd, alpha: desert ? .22 : .38 });
    }
    this.distant.clear();
    if (region === 'coast' || region === 'alpine' || region === 'forest') {
      this.distant.rect(0, 328, width, 130).fill(this.palette.sea);
      const drift = x * .1;
      for (let i = -1; i < 4; i++) {
        const px = i * 530 - drift % 530;
        const land = mix(this.palette.sea, region === 'alpine' ? 0x859e91 : 0x9bb295, .5);
        if (region === 'alpine') {
          this.distant.poly([px - 140, 355, px + 60, 127, px + 235, 355]).fill(land);
          this.distant.poly([px + 1, 194, px + 60, 127, px + 113, 197, px + 65, 180, px + 41, 203, px + 26, 185]).fill(0xdce0cc);
        } else this.distant.moveTo(px - 120, 350).bezierCurveTo(px - 30, 268, px + 42, 308, px + 130, 270).bezierCurveTo(px + 219, 273, px + 280, 337, px + 390, 350).fill(land);
      }
      for (let row = 0; row < 5; row++) for (let i = 0; i < 9; i++) {
        const px = i * 181 + (row % 2) * 60 + Math.sin(seconds * .25 + row) * 10 - (x * .08) % 181;
        this.distant.roundRect(px, 354 + row * 17, 35 + ((i + row) % 3) * 16, 1.5, 1).fill({ color: 0xe5e9cd, alpha: .15 + row * .035 });
      }
      if (region === 'coast') for (let i = 0; i < 3; i++) {
        const bx = ((seconds * (9 + i * 2) + i * 390) % (width + 120)) - 60; const by = 219 + i * 24 + Math.sin(seconds + i) * 5;
        const flap = Math.sin(seconds * 4 + i) * 5;
        this.distant.moveTo(bx - 10, by + flap).quadraticCurveTo(bx - 4, by - 7, bx, by).quadraticCurveTo(bx + 5, by - 7, bx + 11, by + flap).stroke({ color: 0xfaf3de, width: 2, alpha: .8 });
      }
    } else if (desert) {
      for (let row = 0; row < 4; row++) {
        const py = 326 + row * 34; const offset = -(x * (.05 + row * .025)) % 500;
        this.distant.moveTo(-500, 458).lineTo(-500, py);
        for (let i = -1; i < width / 500 + 2; i++) this.distant.bezierCurveTo(offset + i * 500 + 120, py - 80, offset + i * 500 + 350, py + 25, offset + (i + 1) * 500, py);
        this.distant.lineTo(width + 600, 458).lineTo(-500, 458).fill(mix(0xe6c79a, 0xc7a475, row / 4));
      }
    } else if (region === 'cloud') {
      this.distant.rect(0, 330, width, 150).fill(0xcdd4cf);
      for (let i = -1; i < 7; i++) this.distant.ellipse(i * 240 - (x * .15) % 240, 366 + (i % 2) * 22, 190, 48).fill({ color: 0xe2e3d7, alpha: .7 });
    } else {
      this.distant.rect(0, 325, width, 140).fill(0xc8bda3);
      for (let i = -1; i < 7; i++) {
        const px = i * 280 - (x * .12) % 280;
        this.distant.roundRect(px, 190 + (i % 2) * 70, 112, 238, 3).fill({ color: i % 2 ? 0xa1b1a3 : 0xb6a087, alpha: .5 });
      }
    }
    this.distant.rect(0, 435, width, height - 435).fill(this.palette.ground);
    this.distant.rect(0, 435, width, 7).fill(mix(this.palette.ground, 0xf2e3b9, .5));
    this.distant.rect(0, 442, width, 4).fill({ color: 0x688e72, alpha: .15 });
    // Low shore rail and sparse foreground tufts are inexpensive geometry.
    if (region === 'coast') {
      this.distant.moveTo(0, 422).lineTo(width, 422).moveTo(0, 432).lineTo(width, 432).stroke({ color: 0xe7e6c9, width: 3 });
      for (let i = -1; i < width / 62 + 1; i++) { const px = i * 62 - (x * 16 * .65) % 62; this.distant.moveTo(px, 418).lineTo(px, 443).stroke({ color: 0x9daa8b, width: 3 }); }
    }
  }

  private drawRoads(width: number, x: number, length: number, anchor: number, zoom: number, ground: number, activeLane: Lane, region: RegionId): void {
    const graphics = this.roads.clear();
    const minX = x - (anchor + 100) / (16 * zoom), maxX = x + (width - anchor + 100) / (16 * zoom);
    const sx = (wx: number) => anchor + (wx - x) * 16 * zoom;
    const sy = (lane: Lane, wx: number) => ground + (laneY(lane, wx, length) - 525) * zoom;
    const path = (lane: Lane, from: number, to: number, offset = 0) => {
      graphics.moveTo(sx(from), sy(lane, from) + offset);
      for (let wx = from + 1.3; wx < to; wx += 1.3) graphics.lineTo(sx(wx), sy(lane, wx) + offset);
      graphics.lineTo(sx(to), sy(lane, to) + offset);
    };
    for (const lane of [2, 3, 4, 5, 1] as Lane[]) {
      let from = minX, to = maxX;
      if (lane === 1) { from = Math.max(from, length * .255); to = Math.min(to, length * .425); }
      if (lane === 5) { from = Math.max(from, length * .64); to = Math.min(to, length * .79); }
      if (from >= to) continue;
      if (lane === 1) {
        for (let wx = Math.ceil(from / 11) * 11; wx < to; wx += 11) {
          const px = sx(wx); const top = sy(1, wx); const bottom = sy(2, wx) + 12;
          if (bottom - top > 55) graphics.roundRect(px - 7 * zoom, top + 9, 14 * zoom, bottom - top - 5, 3).fill(0xb7af91);
        }
      }
      path(lane, from, to, 3 * zoom); graphics.stroke({ color: 0x6c896d, width: 38 * zoom, alpha: .19 });
      path(lane, from, to); graphics.stroke({ color: lane === 1 ? 0xc1b99a : mix(this.palette.road, lane === 4 ? 0xb7bd9d : lane === 2 ? 0x849d89 : 0xa2af90, .28), width: 31 * zoom, cap: 'round', join: 'round' });
      if (lane === activeLane) { path(lane, from, to, -13 * zoom); graphics.stroke({ color: 0xf2ebcb, width: 1.5, alpha: .34 }); }
      if (lane === 3) for (let wx = Math.ceil(from / 8) * 8; wx < to; wx += 8) {
        graphics.moveTo(sx(wx), sy(lane, wx)).lineTo(sx(wx + 1.9), sy(lane, wx + 1.9)).stroke({ color: 0xf1e6c6, alpha: .43, width: 1.8 * zoom });
      }
      if (lane === 1) {
        path(lane, from, to, -20 * zoom); graphics.stroke({ color: 0x81967e, width: 2 * zoom });
        for (let wx = Math.ceil(from / 2.4) * 2.4; wx < to; wx += 2.4) graphics.moveTo(sx(wx), sy(1, wx) - 21 * zoom).lineTo(sx(wx), sy(1, wx) - 6 * zoom).stroke({ color: 0x81967e, width: 1.6 * zoom });
      }
    }
    // Crosswalks are landmarks in the road, with a safe low-density neighborhood around them.
    const crossingX = length * .207;
    if (sx(crossingX) > -100 && sx(crossingX) < width + 100 && region !== 'desert') {
      for (let i = -3; i <= 3; i++) graphics.rect(sx(crossingX) + i * 13 * zoom, sy(2, crossingX) - 9 * zoom, 7 * zoom, (sy(4, crossingX) - sy(2, crossingX)) + 18 * zoom).fill({ color: 0xeee8ce, alpha: .55 });
      this.label('crossing', '慢行 · 礼让行人', sx(crossingX), sy(2, crossingX) - 34 * zoom, 10);
    }
    for (let wx = Math.ceil(minX / 6) * 6; wx < maxX; wx += 6) {
      const n = hash(region, Math.round(wx)); const py = 653 + (n % 25);
      graphics.moveTo(sx(wx), py).lineTo(sx(wx) - 3, py - 6).moveTo(sx(wx) + 2, py).lineTo(sx(wx) + 7, py - 9).stroke({ color: region === 'desert' ? 0xbda575 : 0x8fa27d, width: 1.5, alpha: .45 });
    }
  }

  private drawExits(width: number, length: number, sx: (x: number, p?: number) => number, sy: (lane: Lane, x: number) => number, zoom: number): void {
    const save = this.engine.save!;
    const exits = exitOptions(save);
    const x = length - 22;
    for (const option of exits) {
      const px = sx(x);
      if (px < -150 || px > width + 220) continue;
      const py = sy(option.lane, x);
      this.sprite(`exit:${option.lane}`, 'sign', px + 5, py - 12, .8 * zoom, this.objects, py - 12);
      this.label(`exit-label:${option.lane}`, `${option.open ? '→' : '◇'} ${option.region === activeVisit(save).region ? '海岸环线' : REGIONS[option.region].name}${option.open ? '' : ` · Lv${REGIONS[option.region].level}`}`, px + 65, py - 49 * zoom, 11, option.open ? '#496f59' : '#8b8b70');
    }
    const target = save.bag.find((letter) => letter.targetRegion !== activeVisit(save).region)?.targetRegion;
    if (target) {
      const toward = nearestExitToward(activeVisit(save).region, target, levelFor(save.stats.delivered));
      const option = exits.find((o) => o.region === toward);
      if (option) this.sprite('guide-dove', 'dove', sx(length - 38), sy(option.lane, length - 38) - 85 - Math.sin(save.worldSeconds * 3) * 5, .75 * zoom, this.objects, 1000);
    }
    if (this.engine.visual.previewRegion) {
      const px = sx(length + 31); const py = sy(save.player.lane, length + 31);
      this.sprite('preview-block', 'block', px, py, .9 * zoom, this.objects, py);
      this.label('preview-title', `邮政公司 · Lv${REGIONS[this.engine.visual.previewRegion].level} 后开通`, px, py - 120, 12);
      this.sprite('preview-scenery', `landmark:${REGIONS[this.engine.visual.previewRegion].landmarks[0].kind}`, px + 260, 443, .64, this.scenery, 10).alpha = .7;
    }
  }

  diagnostics() {
    return { displayObjects: this.sprites.size + this.labels.size + 12, chunks: this.engine.chunks.chunks.size, particles: this.engine.flights.length, textureBytes: this.textureBytes + this.transitionBytes, textures: this.textures.size + 1, residentRegions: [...this.residentRegions.keys()], region: this.lastRegion, fade: this.fade, transitioning: this.transitionImage !== null, limits: { objects: CONFIG.maxObjects, chunks: CONFIG.maxChunks, particles: CONFIG.maxParticles, textureBytes: CONFIG.maxTextureBytes } };
  }
  private cleanup(): void {
    if (this.cleaned) return; this.cleaned = true;
    this.resizeObserver?.disconnect();
    this.releaseTransition();
    this.textures.forEach((texture) => texture.destroy(true)); this.textures.clear();
    this.actorFrames.forEach((texture) => texture.destroy());
    this.app.destroy(true, { children: true });
  }
  destroy(): void { this.dead = true; if (this.app.renderer) this.cleanup(); }
}
