import { CONFIG, DEFAULT_PREFERENCES } from './config';
import { clamp, hash, intersectsRange, lerp, smoothstep } from './math';
import { activeVisit, canDeliver, deliver, refreshCompletedStation, returnMail, takeMail } from './mail';
import { createSave } from './state';
import type { GameSnapshot, Lane, Notice, Overlay, Preferences, RegionId, SaveGameV1 } from './types';
import { availableLanes, canChangeLane, laneY, levelFor, REGIONS, stationX, addressById } from '../world/regions';
import { advanceRegion, retreatRegion } from '../world/routes';
import { ChunkWindow, type WorldObject } from '../world/chunks';
import { exportSave, readSlot, SlotLease, validateSave, writeSlot } from '../storage/saves';
import { purchase, shopItems } from './shop';
import { stepRiding } from './riding';

export interface Flight { id: string; x: number; lane: Lane; age: number; region: string }
export interface ExitOption { lane: Lane; region: RegionId; open: boolean }

export function exitOptions(save: SaveGameV1): ExitOption[] {
  return REGIONS[activeVisit(save).region].neighbors.map((region, index) => ({ region, lane: [3, 2, 4][index] as Lane, open: REGIONS[region].level <= levelFor(save.stats.delivered) }));
}

export function objectX(object: WorldObject, seconds: number): number {
  return object.x + (object.kind === 'car' || object.kind === 'pedestrian' ? Math.sin(seconds * 0.35 + hash(object.id) % 10) * 1.8 : 0);
}

export class GameEngine {
  save: SaveGameV1 | null = null;
  mode: 'home' | 'playing' = 'home';
  overlay: Overlay = 'none';
  station: 'entrance' | 'exit' | null = null;
  background = document.hidden;
  chunks = new ChunkWindow();
  flights: Flight[] = [];
  input = { brake: false, boost: false };
  visual = {
    laneFrom: 3 as Lane, laneTo: 3 as Lane, laneProgress: 1, turn: 1, turnFrom: 1,
    jump: 0, jumpTime: -1, phase: 0, bell: 0, bump: 0, drawer: 0, transition: 0,
    previewDistance: 0, previewRegion: null as RegionId | null,
  };
  menuPreferences = { ...DEFAULT_PREFERENCES };
  homeSeconds = 0;
  interaction = '';
  private snapshot: GameSnapshot;
  private listeners = new Set<() => void>();
  private notices: Notice[] = [];
  private noticeId = 0;
  private noticeTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private saveStatus: GameSnapshot['saveStatus'] = 'saved';
  private saveError = '';
  private owner = crypto.randomUUID();
  private lease = new SlotLease(this.owner);
  private saveQueue: Promise<void> = Promise.resolve();
  private savingCount = 0;
  private accumulator = 0;
  private uiElapsed = 0;
  private saveElapsed = 0;
  private collisionCooldown = 0;
  private bumpTimer = 0;
  private locked = false;
  private hasLease = false;
  private leaseLost = false;
  private coldPresses = { direction: 0, count: 0, time: 0, stage: 0 };
  private lastHold = 0;
  private keys = new Set<string>();
  private heartbeat: ReturnType<typeof setInterval>;
  private audio: AudioContext | null = null;

  constructor() {
    this.snapshot = this.capture();
    this.heartbeat = setInterval(() => { void this.renewLease(); }, 5000);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.clearInput);
    document.addEventListener('visibilitychange', this.visibilityChanged);
    window.addEventListener('pagehide', this.pageHide);
    window.addEventListener('beforeunload', this.beforeUnload);
  }

  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = (): GameSnapshot => this.snapshot;
  get preferences(): Preferences { return this.save?.preferences ?? this.menuPreferences; }
  get paused(): boolean { return this.mode !== 'playing' || this.background || this.overlay !== 'none' || !this.hasLease; }
  get renderX(): number { return (this.save?.player.x ?? 0) + this.visual.previewDistance; }
  get laneChanging(): boolean { return this.visual.laneProgress < 1; }
  get selectedExit(): ExitOption | undefined { return this.save ? exitOptions(this.save).find((option) => option.lane === this.save!.player.lane) : undefined; }

  private capture(): GameSnapshot {
    return { save: this.save ? structuredClone(this.save) : null, mode: this.mode, overlay: this.overlay, station: this.station, notices: [...this.notices], saveStatus: this.saveStatus, saveError: this.saveError, background: this.background, interaction: this.interaction };
  }
  publish(): void { this.snapshot = this.capture(); this.listeners.forEach((listener) => listener()); }

  async start(slot: number): Promise<void> {
    if (this.locked || this.mode === 'playing') return;
    this.locked = true;
    try {
      if (!await this.lease.claim(slot)) throw new Error('这份邮路正在另一个标签页骑行，请先在那里返回主页。');
      this.hasLease = true;
      this.leaseLost = false;
      const { save, recovered } = await readSlot(slot);
      this.save = save ?? createSave(slot);
      if (!save) this.save.preferences = { ...this.menuPreferences };
      this.mode = 'playing'; this.overlay = 'none'; this.station = null;
      this.saveStatus = 'saved'; this.saveError = '';
      this.resetVisual();
      this.visual.transition = this.preferences.reducedMotion ? 1 : 0;
      this.accumulator = 0; this.saveElapsed = 0; this.notices = [];
      this.updateChunks(); this.updateInteraction(); this.publish();
      await this.persist();
      if (recovered) this.notify('邮路已恢复', '已从上一份完整快照继续骑行。');
      else if (!save) this.notify('今天，顺风。', '自动巡航已经开始。前方邮局，按 E 停靠；也可以先去看看海。');
    } catch (error) {
      if (this.mode !== 'playing') { await this.lease.release().catch(() => {}); this.hasLease = false; }
      throw error;
    } finally { this.locked = false; }
  }

  inspect(save: SaveGameV1 | null): void {
    if (this.mode === 'playing') return;
    this.save = save ? structuredClone(save) : null;
    this.publish();
  }

  async goHome(): Promise<void> {
    if (!this.save || this.mode !== 'playing') return;
    this.setOverlay('pause');
    await this.persist();
    if (this.saveStatus === 'error') throw new Error('当前进度尚未保存，请重试或先导出备份。');
    await this.lease.release();
    this.hasLease = false; this.mode = 'home'; this.overlay = 'none'; this.station = null;
    this.chunks.clear(); this.flights = []; this.clearInput(); this.publish();
  }

  async importInto(value: unknown, slot: number): Promise<void> {
    if (this.mode !== 'home') throw new Error('请先返回主页再导入邮路。');
    const save = validateSave(value);
    save.slot = slot;
    if (!await this.lease.claim(slot)) throw new Error('这个槽位在另一页使用中，暂时不能导入。');
    try { await writeSlot(save, this.owner); this.inspect(save); }
    finally { await this.lease.release(); }
  }

  update(dt: number): void {
    dt = clamp(dt, 0, 0.15);
    if (!this.background) this.homeSeconds += this.mode === 'home' && this.overlay === 'none' ? dt : 0;
    this.visual.transition = Math.min(1, this.visual.transition + dt);
    this.visual.drawer = lerp(this.visual.drawer, this.overlay === 'station' ? 1 : 0, 1 - Math.exp(-dt * 6));
    if (!this.paused) {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= CONFIG.step && steps++ < 8) { this.step(CONFIG.step); this.accumulator -= CONFIG.step; }
      if (steps >= 8) this.accumulator = 0;
    } else this.accumulator = 0;
    this.uiElapsed += dt;
    if (this.uiElapsed >= 0.1) { this.uiElapsed %= 0.1; this.updateInteraction(); this.publish(); }
  }

  private step(dt: number): void {
    const save = this.save!;
    const player = save.player;
    const visit = activeVisit(save);
    save.worldSeconds += dt; save.stats.seconds += dt;
    this.saveElapsed += dt;
    this.collisionCooldown = Math.max(0, this.collisionCooldown - dt);
    this.bumpTimer = Math.max(0, this.bumpTimer - dt);
    this.visual.bump = this.bumpTimer;
    this.visual.bell = Math.max(0, this.visual.bell - dt);
    player.waterEffect = Math.max(0, player.waterEffect - dt);
    this.visual.laneProgress = Math.min(1, this.visual.laneProgress + dt / CONFIG.laneChangeSeconds);
    if (this.visual.turn < 1) {
      this.visual.turn = Math.min(1, this.visual.turn + dt / 0.85);
      if (this.visual.turn === 1) player.facing = this.visual.turnFrom === 1 ? -1 : 1;
    }
    if (this.visual.jumpTime >= 0) {
      this.visual.jumpTime += dt;
      this.visual.jump = Math.sin(clamp(this.visual.jumpTime / 0.78, 0, 1) * Math.PI) * 78;
      if (this.visual.jumpTime >= 0.78) { this.visual.jumpTime = -1; this.visual.jump = 0; }
    }
    const wasCruising = player.cruiseActive;
    const speedBefore = player.speed;
    stepRiding(player, this.input, dt, {
      turning: this.visual.turn < 1,
      slowed: this.bumpTimer > 0,
      forwardBlocked: this.visual.previewRegion !== null && this.visual.previewDistance >= 22,
      retreatRemaining: !this.visual.previewRegion && save.routes.active === 0 && player.x < 8 ? player.x : undefined,
    });
    if (wasCruising !== player.cruiseActive) void this.persist();
    const previous = player.x;
    const distance = player.speed * dt;
    save.stats.distance += Math.abs(distance);
    if (Math.abs(player.speed) > 0.5) save.stats.cyclingSeconds += dt;
    this.visual.phase += distance / CONFIG.metersPerActorLoop;
    if (this.visual.previewRegion) {
      this.visual.previewDistance = clamp(this.visual.previewDistance + distance, 0, 22.05);
      if (this.visual.previewDistance === 0 && player.speed < 0) this.visual.previewRegion = null;
    } else {
      player.x += distance;
      if (save.routes.active === 0 && player.x < .15 && player.speed < 0) { player.x = 0; player.speed = 0; }
      if (player.x > visit.length) this.crossBoundary();
      else if (player.x < 0) {
        retreatRegion(save); this.resetLanes(); this.updateChunks(); void this.persist();
      }
      const current = activeVisit(save);
      if (!availableLanes(player.x, current.length).includes(player.lane)) {
        player.lane = player.lane === 1 ? 2 : player.lane === 5 ? 4 : 3;
        this.visual.laneFrom = this.visual.laneTo = player.lane; this.visual.laneProgress = 1;
      }
      this.updateChunks();
      if (current.id === visit.id && Math.abs(player.x - previous) < 3) {
        this.collide(previous, player.x);
        this.discover(previous, player.x);
        if (save.preferences.autoDelivery) this.autoDeliver(previous, player.x);
      }
    }
    for (const flight of this.flights) flight.age += dt;
    this.flights = this.flights.filter((flight) => flight.age < 1.15);
    if (save.preferences.holdAssist && save.worldSeconds - this.lastHold > 0.4) {
      if (this.keys.has('KeyW')) this.changeLane(-1);
      else if (this.keys.has('KeyS')) this.changeLane(1);
      this.lastHold = save.worldSeconds;
    }
    if (!player.cruiseActive && speedBefore !== 0 && player.speed === 0) void this.persist();
    if (this.saveElapsed >= CONFIG.autoSaveSeconds) { this.saveElapsed = 0; void this.persist(); }
  }

  lanePosition(): number {
    if (!this.save) return 525;
    const { x } = this.save.player; const { length } = activeVisit(this.save);
    return lerp(laneY(this.visual.laneFrom, x, length), laneY(this.visual.laneTo, x, length), smoothstep(this.visual.laneProgress));
  }

  private crossBoundary(): void {
    const save = this.save!;
    const visit = activeVisit(save);
    const next = this.selectedExit ?? exitOptions(save).find((exit) => exit.open)!;
    if (!next.open) {
      save.player.x = visit.length;
      this.visual.previewRegion = next.region; this.visual.previewDistance = 0;
      this.notify('前方邮路正在筹备', `${REGIONS[next.region].name} · Lv${REGIONS[next.region].level} 开放。可以看看入口，再按 Q 掉头。`);
      void this.persist(); return;
    }
    const result = advanceRegion(save, next.region);
    if (result.entered) {
      this.resetLanes(); this.flights = [];
      if (result.loops) this.notify('有几封信，要等下一次相遇', `${result.loops} 封信已成为循环信，计时已冻结。地址和信件都会留在信包里。`);
      else this.notify(REGIONS[next.region].name, REGIONS[next.region].subtitle);
      void this.persist();
    }
  }

  changeLane(direction: -1 | 1): void {
    if (this.paused || this.laneChanging || this.visual.previewRegion || this.visual.turn < 1) return;
    const save = this.save!; const visit = activeVisit(save);
    const from = save.player.lane; const to = (from + direction) as Lane;
    if (!canChangeLane(from, to, save.player.x, visit.length)) {
      this.coldPresses.count = 0;
      this.notify('沿着相连的路走', from === 1 || to === 1 ? '高桥只能从两端的坡道进入。' : to === 5 || from === 5 ? '等前面的连接小路出现，再试一次。' : '这里已经是道路边缘了。'); return;
    }
    const stage = save.player.cold >= 90 ? 3 : save.player.cold >= 70 ? 2 : 1;
    const press = this.coldPresses;
    if (stage > 1 && (press.direction !== direction || press.stage !== stage || save.worldSeconds - press.time > 1.5)) press.count = 0;
    press.direction = direction; press.stage = stage; press.time = save.worldSeconds; press.count++;
    if (press.count < stage) { this.notify('手有点冷', `再按 ${stage - press.count} 次 ${direction < 0 ? 'W' : 'S'}，就能握稳车把换路。`); return; }
    press.count = 0;
    this.visual.laneFrom = from; this.visual.laneTo = to; this.visual.laneProgress = 0;
    save.player.lane = to;
    this.publish();
  }

  setBrake(pressed: boolean): void {
    if (pressed && this.paused) return;
    this.input.brake = pressed;
    if (pressed && this.save && this.save.player.speed * this.save.player.facing <= 0 && this.save.player.cruiseActive) {
      this.save.player.cruiseActive = false;
      void this.persist(); this.publish();
    }
  }

  pedal(): void {
    if (this.paused || this.input.brake) return;
    const wasCruising = this.save!.player.cruiseActive;
    this.save!.player.cruiseActive = true;
    this.input.boost = true;
    if (!wasCruising) void this.persist();
    this.publish();
  }

  turn(): void {
    if (this.paused || this.visual.turn < 1) return;
    this.visual.turnFrom = this.save!.player.facing; this.visual.turn = 0;
    this.clearInput();
  }
  jump(): void { if (!this.paused && this.visual.jumpTime < 0 && this.visual.turn >= 1) this.visual.jumpTime = 0; }

  ring(): void {
    if (this.paused || this.visual.bell > 1.5) return;
    this.visual.bell = 2;
    if (!this.preferences.sound) return;
    try {
      this.audio ??= new AudioContext();
      void this.audio.resume();
      const now = this.audio.currentTime;
      [1400, 2100].forEach((frequency, i) => {
        const oscillator = this.audio!.createOscillator(); const gain = this.audio!.createGain();
        oscillator.frequency.value = frequency; oscillator.type = 'sine';
        gain.gain.setValueAtTime(0.045, now + i * 0.09); gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.65);
        oscillator.connect(gain); gain.connect(this.audio!.destination); oscillator.start(now + i * 0.09); oscillator.stop(now + 0.85);
      });
    } catch { /* Sound is optional on devices that prohibit Web Audio. */ }
  }

  interact(): void {
    if (this.mode !== 'playing') return;
    if (this.overlay === 'station' || this.overlay === 'shop') { this.setOverlay('none'); return; }
    if (this.paused || this.visual.previewRegion || this.visual.jump > 8 || this.laneChanging) return;
    const save = this.save!; const visit = activeVisit(save);
    const letter = this.reachableLetters(save.player.x, save.player.x)[0];
    if (letter) { this.completeLetter(letter.id, false); return; }
    if (save.player.lane === 3) {
      const station = (['entrance', 'exit'] as const).find((kind) => Math.abs(save.player.x - stationX(kind, visit.length)) <= 18);
      if (station) {
        if (refreshCompletedStation(save, station)) void this.persist();
        this.station = station; save.player.speed = 0; this.setOverlay('station'); return;
      }
      if (this.nearShop()) { save.player.speed = 0; this.setOverlay('shop'); }
    }
  }

  collect(ids: string[]): string | null {
    if (this.overlay !== 'station' || !this.save || !this.station) return '请先停靠邮局。';
    const error = takeMail(this.save, this.station, ids);
    if (error) return error;
    this.notify('问候已装进信包', `${ids.length} 封信在这一刻同时开始计时。去把它们送到窗前吧。`);
    this.setOverlay('none'); void this.persist(); return null;
  }
  returnLetter(id: string): void {
    if (this.overlay !== 'station' || !this.save) return;
    if (returnMail(this.save, id)) { this.notify('已办理退件', '已按信件卡说明扣除处理费与 2 点信任。', 'warning'); void this.persist(); this.publish(); }
  }
  nearShop(): boolean {
    if (!this.save || this.visual.previewRegion) return false;
    return levelFor(this.save.stats.delivered) >= 2 && Math.abs(this.save.player.x - activeVisit(this.save).length * 0.565) < 50;
  }
  buy(index: number): string | null {
    if (!this.save || this.mode !== 'playing' || (this.overlay !== 'shop' && (this.paused || !this.nearShop() || this.save.player.lane !== 3))) return '靠近商店的中间道路，就能购买。';
    const item = shopItems(this.save)[index]; if (!item) return null;
    const error = purchase(this.save, item.id);
    if (!error) { this.notify(`添置了${item.name}`, `${item.effect}，已经装好了。`); void this.persist(); this.publish(); }
    else this.notify('慢慢来', error);
    return error;
  }

  setOverlay(overlay: Overlay): void {
    this.overlay = overlay; this.clearInput(); this.accumulator = 0;
    if (overlay !== 'station') this.station = null;
    if (overlay !== 'none' && this.mode === 'playing') void this.persist();
    this.updateInteraction(); this.publish();
  }
  resume(): void {
    if (this.leaseLost) { this.notify('这份进度先留在这里', '另一页已经续骑。请先导出当前进度，再重新读取本地存档，避免覆盖新的旅途。', 'warning'); return; }
    if (this.mode === 'playing' && !this.hasLease) { void this.renewLease(); return; }
    this.setOverlay('none');
  }
  async configure<K extends keyof Preferences>(key: K, value: Preferences[K]): Promise<void> {
    if (!this.save) { this.menuPreferences[key] = value; this.publish(); return; }
    if (this.mode === 'home') {
      const slot = this.save.slot;
      const id = this.save.id;
      if (!await this.lease.claim(slot)) throw new Error('这份邮路在另一页使用中，暂时不能修改。');
      try {
        const latest = await readSlot(slot);
        if (!latest.save || latest.save.id !== id) throw new Error('这份邮路已有变化，请关闭设置后重新选择。');
        latest.save.preferences[key] = value;
        await writeSlot(latest.save, this.owner);
        this.save = latest.save;
      } finally { await this.lease.release(); }
    } else { this.save.preferences[key] = value; void this.persist(); }
    this.publish();
  }
  download(): void { if (this.save) exportSave(this.save); }

  async persist(): Promise<void> {
    if (!this.save || this.mode !== 'playing') return;
    if (this.leaseLost) { this.saveStatus = 'error'; this.publish(); return; }
    const snapshot = structuredClone(this.save);
    this.saveStatus = 'saving'; this.savingCount++; this.publish();
    const operation = this.saveQueue.catch(() => {}).then(() => writeSlot(snapshot, this.owner));
    this.saveQueue = operation;
    try {
      await operation;
      if (this.save?.id === snapshot.id) this.save.updatedAt = Date.now();
      this.saveError = ''; this.saveStatus = 'saved';
    } catch (error) {
      this.saveStatus = 'error'; this.saveError = error instanceof Error ? error.message : '本地存档暂时不可用，请导出备份。';
      if (this.saveError.includes('另一个标签页')) { this.hasLease = false; this.leaseLost = true; this.overlay = 'pause'; this.clearInput(); }
    } finally { this.savingCount--; if (this.savingCount && this.saveStatus !== 'error') this.saveStatus = 'saving'; this.publish(); }
  }

  notify(title: string, body: string, kind: Notice['kind'] = 'info'): void {
    const notice = { id: ++this.noticeId, title, body, kind };
    for (const old of this.notices.slice(0, Math.max(0, this.notices.length - 2))) {
      const timer = this.noticeTimers.get(old.id); if (timer) clearTimeout(timer); this.noticeTimers.delete(old.id);
    }
    this.notices = [...this.notices.slice(-2), notice]; this.publish();
    const timer = setTimeout(() => { this.notices = this.notices.filter((n) => n.id !== notice.id); this.noticeTimers.delete(notice.id); this.publish(); }, kind === 'delivery' ? 5500 : 6500);
    this.noticeTimers.set(notice.id, timer);
  }

  private reachableLetters(from: number, to: number) {
    const save = this.save!;
    if (this.laneChanging || this.visual.jump > 8 || this.visual.previewRegion) return [];
    const visit = activeVisit(save);
    return save.bag.filter((letter) => {
      const address = addressById(letter.addressId)!;
      return canDeliver(save, letter) && address.lane === save.player.lane && intersectsRange(from, to, visit.length * address.fraction, 9);
    });
  }
  private autoDeliver(from: number, to: number): void {
    for (const letter of this.reachableLetters(from, to)) {
      if (letter.state === 'loop' && !this.preferences.autoLoopMail) continue;
      this.completeLetter(letter.id, true);
    }
  }
  private completeLetter(id: string, automatic: boolean): void {
    const save = this.save!; const letter = save.bag.find((l) => l.id === id); if (!letter) return;
    const previousLevel = levelFor(save.stats.delivered);
    const record = deliver(save, id, automatic);
    if (!record) return;
    const address = addressById(letter.addressId)!;
    this.flights = [...this.flights.slice(-5), { id, x: activeVisit(save).length * address.fraction, lane: address.lane, age: 0, region: activeVisit(save).id }];
    this.notify(`${record.loop ? '循环信 · ' : ''}${record.recipient}收到了问候`, `${record.stars ? '★'.repeat(record.stars) : '0 星'}  ${record.reward >= 0 ? '+' : ''}${record.reward} 金币 · ${record.message}`, 'delivery');
    if (levelFor(save.stats.delivered) > previousLevel) this.notify('邮政公司来信', `你的快递等级升至 Lv${levelFor(save.stats.delivered)}。${Object.values(REGIONS).filter((r) => r.level === levelFor(save.stats.delivered)).map((r) => r.name).join('')}的邮路开通了！`);
    void this.persist(); this.publish();
  }
  private collide(from: number, to: number): void {
    if (this.collisionCooldown > 0 || this.laneChanging || this.visual.jump > 24) return;
    const save = this.save!;
    for (const chunk of this.chunks.chunks.values()) for (const object of chunk.objects) {
      if (object.lane !== save.player.lane || !['car', 'pedestrian', 'branch'].includes(object.kind) || (object.kind === 'pedestrian' && this.visual.bell > 0)) continue;
      if (intersectsRange(from, to, objectX(object, save.worldSeconds), object.kind === 'car' ? 3 : 1.4)) {
        this.bumpTimer = 1.8; this.collisionCooldown = 3.8; save.player.speed *= 0.35;
        this.notify('慢一点，也很好', object.kind === 'pedestrian' ? '等行人先走。按 B 鸣铃，可以提前打声招呼。' : object.kind === 'car' ? '留意路边的小汽车，换路就能从旁边经过。' : '轻轻颠了一下。换路或按空格跳过小障碍。'); return;
      }
    }
  }
  private discover(from: number, to: number): void {
    const save = this.save!; const visit = activeVisit(save);
    for (const landmark of REGIONS[visit.region].landmarks) {
      if (intersectsRange(from, to, visit.length * landmark.fraction, 15) && !visit.discovered.includes(landmark.id)) {
        visit.discovered.push(landmark.id);
        if (!save.stats.landmarks.includes(landmark.id)) {
          save.stats.landmarks.push(landmark.id);
          this.notify('沿途拾光', `${landmark.name}已收入手账。`); void this.persist();
        }
      }
    }
  }
  private updateChunks(): void {
    if (!this.save) return;
    const visit = activeVisit(this.save);
    this.chunks.update(this.save.seed, visit.id, visit.region, this.save.player.x, visit.length);
  }
  private updateInteraction(): void {
    if (!this.save || this.mode !== 'playing' || this.overlay !== 'none') { this.interaction = ''; return; }
    const save = this.save; const visit = activeVisit(save);
    if (this.visual.previewRegion) { this.interaction = '邮路筹备中 · 按 Q 掉头返回'; return; }
    if (this.reachableLetters(save.player.x, save.player.x).length) { this.interaction = 'E  把问候放进信箱'; return; }
    const station = (['entrance', 'exit'] as const).find((s) => Math.abs(save.player.x - stationX(s, visit.length)) < 38);
    if (station) { this.interaction = save.player.lane !== 3 ? '邮局在中间道路 · W / S 换路' : Math.abs(save.player.x - stationX(station, visit.length)) <= 18 ? 'E  停靠邮局 · 挑选信件' : '前方邮局 · 接近后按 E 停靠'; return; }
    if (save.routes.active === 0 && save.player.x < 10) { this.interaction = '前方正在修路，按 Q 掉头继续旅行'; return; }
    if (this.nearShop()) { this.interaction = '1 / 2 / 3  添置物件 · E 停靠慢慢看'; return; }
    if (visit.length - save.player.x < 140) { this.interaction = 'W / S 沿道路选下一程 · 保持骑行即可进入'; return; }
    this.interaction = '';
  }
  private resetLanes(): void {
    if (!this.save) return;
    this.visual.laneFrom = this.visual.laneTo = this.save.player.lane; this.visual.laneProgress = 1;
  }
  private resetVisual(): void {
    this.resetLanes(); this.visual.turn = 1; this.visual.turnFrom = this.save?.player.facing ?? 1;
    this.visual.previewDistance = 0; this.visual.previewRegion = null; this.visual.jumpTime = -1; this.visual.jump = 0; this.visual.phase = 0; this.visual.drawer = 0;
    this.coldPresses.count = 0; this.flights = []; this.chunks.clear(); this.clearInput();
  }
  private async renewLease(): Promise<void> {
    if (!this.save || this.mode !== 'playing' || this.leaseLost) return;
    const id = this.save.id;
    try {
      const allowed = await this.lease.claim(this.save.slot);
      if (this.mode !== 'playing' || this.save?.id !== id) return;
      this.hasLease = allowed;
      if (!this.hasLease) { this.leaseLost = true; this.overlay = 'pause'; this.clearInput(); this.saveStatus = 'error'; this.saveError = '这份邮路已在另一个标签页续骑。请导出当前进度，再重新读取本地存档，避免覆盖新的旅途。'; this.publish(); }
    } catch { this.saveStatus = 'error'; this.saveError = '暂时无法检查本地存档，请先导出备份。'; this.publish(); }
  }
  clearInput = (): void => { this.input.brake = false; this.input.boost = false; this.keys.clear(); };
  private visibilityChanged = (): void => { this.background = document.hidden; this.clearInput(); this.accumulator = 0; if (this.background) void this.persist(); else void this.renewLease(); this.publish(); };
  private pageHide = (): void => { this.clearInput(); void this.persist(); };
  private beforeUnload = (event: BeforeUnloadEvent): void => { if (this.mode === 'playing' && this.saveStatus !== 'saved') { event.preventDefault(); } };
  reloadSavedProgress(): void { this.mode = 'home'; this.hasLease = false; window.location.reload(); }
  private keyDown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.code === 'Escape') { event.preventDefault(); if (!event.repeat) this.overlay === 'none' ? this.setOverlay('pause') : this.resume(); return; }
    if ((event.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (this.mode !== 'playing') return;
    if (['Space', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'KeyB', 'Digit1', 'Digit2', 'Digit3'].includes(event.code)) event.preventDefault();
    this.keys.add(event.code);
    if (event.code === 'KeyA' && !this.paused) this.setBrake(true);
    else if (event.code === 'KeyD' && !event.repeat) this.pedal();
    if (event.repeat) return;
    if (event.code === 'KeyW') this.changeLane(-1);
    else if (event.code === 'KeyS') this.changeLane(1);
    else if (event.code === 'KeyQ') this.turn();
    else if (event.code === 'Space') this.jump();
    else if (event.code === 'KeyE') this.interact();
    else if (event.code === 'KeyB') this.ring();
    else if (['Digit1', 'Digit2', 'Digit3'].includes(event.code)) this.buy(Number(event.code.slice(-1)) - 1);
  };
  private keyUp = (event: KeyboardEvent): void => { this.keys.delete(event.code); if (event.code === 'KeyA') this.setBrake(false); if (event.code === 'KeyD') this.input.boost = false; };

  dispose(): void {
    clearInterval(this.heartbeat); this.noticeTimers.forEach(clearTimeout);
    window.removeEventListener('keydown', this.keyDown); window.removeEventListener('keyup', this.keyUp); window.removeEventListener('blur', this.clearInput);
    document.removeEventListener('visibilitychange', this.visibilityChanged); window.removeEventListener('pagehide', this.pageHide); window.removeEventListener('beforeunload', this.beforeUnload);
    if (this.save && this.hasLease) void this.persist().then(() => this.lease.release());
    void this.audio?.close(); this.listeners.clear();
  }
}
