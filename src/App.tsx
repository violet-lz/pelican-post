import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { GameEngine, exitOptions } from './game/engine';
import type { SaveGameV1 } from './game/types';
import { activeVisit, usedCapacity } from './game/mail';
import { calendar } from './game/clock';
import { formatDistance, formatTime } from './game/math';
import { shopItems } from './game/shop';
import { addressById, availableLanes, levelFor, REGIONS } from './world/regions';
import { SceneRenderer } from './world/renderer';
import { exportSave, readSlot, validateSave } from './storage/saves';
import { Icon, Logo } from './ui/Icon';
import { Station } from './ui/Station';
import { Journal, type JournalTab } from './ui/Journal';
import { Settings } from './ui/Settings';

interface Slot { save: SaveGameV1 | null; error: string; recovered: boolean }
declare global { interface Window { __PELICAN_DEV__?: { engine: GameEngine; diagnostics: () => ReturnType<SceneRenderer['diagnostics']> } } }

export function App({ engine }: { engine: GameEngine }) {
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const canvasHost = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const [renderError, setRenderError] = useState('');
  const [slots, setSlots] = useState<Slot[]>(Array.from({ length: 3 }, () => ({ save: null, error: '', recovered: false })));
  const [slotsLoaded, setSlotsLoaded] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [journalTab, setJournalTab] = useState<JournalTab>('overview');
  const [pendingImport, setPendingImport] = useState<SaveGameV1 | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const firstLoad = useRef(true);
  const playing = state.mode === 'playing';
  const save = state.save;
  const visit = save ? activeVisit(save) : null;
  const time = calendar(save?.worldSeconds ?? 0);

  const loadSlots = useCallback(async () => {
    const result = await Promise.allSettled([1, 2, 3].map((slot) => readSlot(slot)));
    const next = result.map((r): Slot => r.status === 'fulfilled' ? { ...r.value, error: '' } : { save: null, recovered: false, error: r.reason instanceof Error ? r.reason.message : '暂时无法读取' });
    setSlots(next); setSlotsLoaded(true);
    if (firstLoad.current) {
      firstLoad.current = false;
      const recent = next.map((v, i) => ({ ...v, index: i + 1 })).sort((a, b) => (b.save?.updatedAt ?? 0) - (a.save?.updatedAt ?? 0))[0];
      if (recent.save) { setSelectedSlot(recent.index); engine.inspect(recent.save); }
    }
  }, [engine]);

  useEffect(() => {
    void loadSlots();
    const renderer = new SceneRenderer(canvasHost.current!, engine);
    let cancelled = false;
    void renderer.init().then(() => { if (!cancelled) setReady(true); }).catch((e) => { if (!cancelled) setRenderError(e instanceof Error ? e.message : '场景暂时无法打开'); });
    if (import.meta.env.DEV) window.__PELICAN_DEV__ = { engine, diagnostics: () => renderer.diagnostics() };
    return () => { cancelled = true; delete window.__PELICAN_DEV__; renderer.destroy(); };
  }, [engine, loadSlots]);

  useEffect(() => { if (!playing && slotsLoaded) void loadSlots(); }, [playing, state.overlay, loadSlots, slotsLoaded]);

  const start = async (slot: number) => {
    setError(''); setSelectedSlot(slot); setBusy(true); setHelpOpen(false);
    try { await engine.start(slot); } catch (e) { setError(e instanceof Error ? e.message : '没能打开这份邮路。'); }
    finally { setBusy(false); }
  };
  const home = async () => {
    setError(''); setBusy(true);
    try { await engine.goHome(); await loadSlots(); } catch (e) { setError(e instanceof Error ? e.message : '请先导出备份再重试。'); }
    finally { setBusy(false); }
  };
  const openJournal = (tab: JournalTab = 'overview') => { setJournalTab(tab); engine.setOverlay('journal'); };
  const closeOverlay = () => { setError(''); engine.resume(); };
  const nearest = save && visit ? save.bag.map((letter) => ({ letter, address: addressById(letter.addressId)! })).filter(({ letter }) => letter.targetRegion === visit.region && (letter.state === 'loop' || letter.targetVisit === visit.id)).sort((a, b) => Math.abs(visit.length * a.address.fraction - save.player.x) - Math.abs(visit.length * b.address.fraction - save.player.x))[0] : null;
  const nextAddressDistance = nearest && save && visit ? visit.length * nearest.address.fraction - save.player.x : 0;
  const shopVisible = playing && save && visit && levelFor(save.stats.delivered) >= 2 && Math.abs(save.player.x - visit.length * .565) < 50 && (state.overlay === 'none' || state.overlay === 'shop');
  const level = levelFor(save?.stats.delivered ?? 0);

  return <div className={`app-shell ${playing ? 'is-playing' : 'is-home'} ${save?.preferences.reducedMotion ? 'reduce-motion' : ''}`}>
    <header className="masthead"><Logo/><div className="header-right"><span className="edition">沿途皆风景 <i/> Nº 001</span><button className="header-link" onClick={() => openJournal()}><Icon name="book" size={17}/><span>旅行手账</span></button><button className="header-link" onClick={() => engine.setOverlay('settings')} aria-label="打开骑行设置"><Icon name="settings" size={18}/><span>设置</span></button>{playing && <button className="icon-button pause-button" aria-label="暂停骑行" onClick={() => engine.setOverlay('pause')}><Icon name="pause" size={18}/></button>}</div></header>

    <div className="home-intro" aria-hidden={playing}><div><p className="eyebrow">A LITTLE RIDE. A LETTER OF JOY.</p><h1>今天，<em>顺风。</em></h1></div><p>把海风装进车筐，把问候送到窗前。<br/><span>一封信，一段路。走到哪里，都算远方。</span></p></div>

    <main className="game-layout"><section className={`scene-wrap ${state.overlay === 'station' ? 'station-is-open' : ''}`} aria-label="骑行风景"><div className="canvas-host" ref={canvasHost}/>
      {!ready && <div className="loading-scene"><span className="loading-seal"><Icon name="mail" size={28}/></span><p>{renderError ? '海风暂时没能抵达。' : '正在把海风装进车筐…'}</p>{renderError && <><small>{renderError}</small><button className="button" onClick={() => window.location.reload()}>重新打开</button></>}</div>}

      {!playing && <div className="scene-caption"><span><i className="live-dot"/>此刻，正在路上</span><span>有些问候，值得绕一点路。<Icon name="wind" size={17}/></span></div>}
      {playing && save && visit && <>
        <div className="game-topline"><div className="region-chip"><span className="region-symbol"><Icon name="map" size={20}/></span><div><span className="mini-label">{engine.visual.previewRegion ? '前方的邮路' : REGIONS[visit.region].english}</span><h2>{REGIONS[engine.visual.previewRegion ?? visit.region].name}</h2><div className="route-progress"><i style={{ width: `${save.player.x / visit.length * 100}%` }}/></div><small>{formatDistance(save.player.x)} <span>/ {formatDistance(visit.length)}</span></small></div></div><div className="ride-status"><div className="day-chip"><Icon name={time.period === '夜晚' ? 'moon' : 'sun'} size={17}/><span>{time.season} · 第 {time.day} 天 <i/>{time.period}</span><small>{visit.region === 'desert' ? '晴朗 · 干燥' : visit.region === 'forest' ? '树影 · 微风' : '微风 · 宜骑行'}</small></div><div className="coin-chip"><Icon name="coin" size={18}/><strong>{save.player.coins}</strong><span>金币</span></div><button className="view-toggle" onClick={() => { void engine.configure('camera', save.preferences.camera === 'far' ? 'near' : 'far'); }} aria-label={`当前${save.preferences.camera === 'far' ? '远' : '近'}视野，切换视野`}><Icon name="camera" size={16}/>{save.preferences.camera === 'far' ? '远视野' : '近视野'}</button></div></div>
        <div className="ride-side"><span className="speed-readout"><strong>{Math.round(Math.abs(save.player.speed) * 3.6)}</strong><small>km/h</small></span>{!save.player.cruiseActive && <span className="parking-hint">{save.player.speed === 0 ? "已停稳" : "巡航已关闭"}<small>按 D 重新出发</small></span>}<div className="stamina"><span>体力</span><i><b style={{ width: `${save.player.stamina}%` }}/></i></div><div className="lane-indicator" aria-label={`当前 ${save.player.lane} 号路`}>{[1, 2, 3, 4, 5].map((lane) => <span key={lane} className={`${save.player.lane === lane ? 'current' : ''} ${availableLanes(save.player.x, visit.length).includes(lane as 1 | 2 | 3 | 4 | 5) ? '' : 'unavailable'}`}>{lane}</span>)}<small>道路</small></div></div>
        {save.preferences.autoDelivery && <button className="automation-badge" onClick={() => engine.setOverlay('settings')}><Icon name="mail" size={13}/>自动投递已开启</button>}
        {visit.length - save.player.x < 140 && !engine.visual.previewRegion && <div className="fork-panel"><span className="eyebrow">下一程，自己选。</span>{exitOptions(save).map((option) => <span key={option.lane} className={save.player.lane === option.lane ? 'chosen' : ''}><b>{option.lane} 号路</b>{option.region === visit.region ? '海岸环线' : REGIONS[option.region].name}<small>{option.open ? '已开通' : `Lv${REGIONS[option.region].level}`}</small></span>)}</div>}
        {state.interaction && <button className="interaction-prompt" onClick={() => engine.visual.previewRegion || (save.routes.active === 0 && save.player.x < 10) ? engine.turn() : engine.interact()}><span className="prompt-dot"/>{state.interaction}</button>}
        <div className="scene-bottom"><button className="next-letter" onClick={() => openJournal('bag')}><span className="next-icon"><Icon name={save.bag.length ? 'mail' : 'wind'} size={23}/></span><span><small>{nearest ? '下一封问候' : save.bag.length ? '信包里，还有远方' : '轻装看风景'}</small><strong>{nearest ? `${nearest.address.name} · ${nearest.address.lane} 号路` : save.bag.length ? `${save.bag.length} 封信，在前方的邮路相遇` : '经过邮局时，按 E 挑几封信'}</strong>{nearest && <em>{nextAddressDistance >= 0 ? '前方' : '身后'} {formatDistance(Math.abs(nextAddressDistance))}{nearest.letter.state === 'loop' ? ' · 循环信' : ''}</em>}</span><Icon name="chevron" size={17}/></button><button className="bag-chip" onClick={() => openJournal('bag')}><Icon name="bag" size={19}/><span>{usedCapacity(save)} / {save.player.capacity} 格</span></button></div>
      </>}
      {shopVisible && save && <div className={`roadside-shop ${state.overlay === 'shop' ? 'stopped' : ''}`} aria-label="路边商店"><div className="shop-title"><span>路边，有些小物件。</span><small>{state.overlay === 'shop' ? '已停靠 · 计时暂停 · E 继续' : '路过时按 1 / 2 / 3 购买'}</small></div>{shopItems(save).map((item, index) => <button className={`goods-card ${item.owned ? 'owned' : ''}`} key={item.id} onClick={() => engine.buy(index)} disabled={item.owned || save.player.lane !== 3}><span className="goods-icon"><Icon name={item.icon} size={24}/></span><span><strong>{item.name}</strong><small>{item.effect}</small></span><span className="goods-price">{item.owned ? <Icon name="check" size={18}/> : <><b>{item.price}</b><kbd>{index + 1}</kbd></>}</span></button>)}</div>}
      <div className="notices" aria-live="polite" aria-atomic="false">{state.notices.map((notice) => <article key={notice.id} className={`notice notice-${notice.kind}`}><span className="notice-icon"><Icon name={notice.kind === 'delivery' ? 'mail' : notice.kind === 'warning' ? 'bell' : 'wind'} size={19}/></span><div><strong>{notice.title}</strong><p>{notice.body}</p></div></article>)}</div>
      {playing && state.overlay === 'station' && save && <Station key={`${visit!.id}:${engine.station}:${visit!.generation[engine.station!]}`} save={save} engine={engine}/>}
    </section>

    <div className="ride-toolbar"><div className="keyboard-hints"><span><kbd>W</kbd><kbd>S</kbd>换路</span><span><kbd>A</kbd>刹车 / 后退</span><span><kbd>D</kbd>启动 / 加速</span><span><kbd>Q</kbd>掉头</span><span><kbd>空格</kbd>跳跃</span><span><kbd>E</kbd>送信 / 停靠</span></div><span className={`save-indicator ${state.saveStatus === 'error' ? 'save-failed' : ''}`}><i/>{state.saveStatus === 'saving' ? '正在保存…' : state.saveStatus === 'error' ? '尚未保存 · 请导出备份' : '旅途已记好'}<span>· Lv{level}</span></span><button className="help-button" onClick={() => { setHelpOpen(!helpOpen); if (!helpOpen && playing) engine.setOverlay('pause'); }}>操作说明</button></div>

    {!playing && <section className="home-saves" aria-label="选择旅行存档"><div className="save-section-title"><span><Icon name="map" size={15}/>选一份邮路，继续今天的风景。</span><button onClick={() => { setError(''); fileInput.current?.click(); }} className="text-button"><Icon name="upload" size={14}/>导入备份</button></div><div className="save-grid">{slots.map((slot, index) => <article className={`save-card ${selectedSlot === index + 1 ? 'selected' : ''} ${slot.error ? 'slot-error' : ''}`} key={index} onClick={() => { if (busy) return; setSelectedSlot(index + 1); engine.inspect(slot.save); }}><div className="save-card-top"><span className="save-number">{String(index + 1).padStart(2, '0')}</span><div><h3>{slot.save?.name ?? '一段新的旅途'}</h3><p>{slot.error ? '存档需要恢复' : slot.save ? `${REGIONS[activeVisit(slot.save).region].name} · ${calendar(slot.save.worldSeconds).season} · 第 ${calendar(slot.save.worldSeconds).day} 天` : '风景、问候，和还没发生的故事。'}</p></div>{slot.save && <button className="icon-button export-slot" aria-label={`导出${slot.save.name}备份`} onClick={(e) => { e.stopPropagation(); exportSave(slot.save!); }}><Icon name="download" size={15}/></button>}</div><div className="save-card-bottom"><span>{slot.save ? <><b>{slot.save.stats.delivered}</b> 封送达 <i/> {formatDistance(slot.save.stats.distance)}</> : '从海岸小镇出发'}</span><button className={`button small ${selectedSlot === index + 1 ? 'primary' : ''}`} disabled={busy || !ready || !slotsLoaded || !!slot.error} onClick={(e) => { e.stopPropagation(); void start(index + 1); }}>{busy && selectedSlot === index + 1 ? '整理信包…' : slot.save ? '继续骑行' : '开始旅行'}<Icon name="arrow" size={14}/></button></div>{slot.error && <p className="slot-error-message">{slot.error}</p>}{slot.recovered && <span className="recovery-note">可从恢复快照继续</span>}</article>)}</div></section>}
    {!playing && <footer className="home-footer"><span>没有终点，也没有必须赶上的风景。</span><button className="text-button" onClick={() => { setHelpOpen(true); engine.setOverlay('pause'); }}>第一次骑行 <Icon name="arrow" size={13}/></button><span>随时出发 · 随时停留</span></footer>}
    </main>

    <div className="touch-controls" aria-label="触屏骑行操作" hidden={!playing || state.overlay !== 'none'}><div><button onPointerDown={() => engine.changeLane(-1)} aria-label="向上换路">W</button><button onPointerDown={() => engine.changeLane(1)} aria-label="向下换路">S</button><button onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); engine.setBrake(true); }} onPointerUp={() => { engine.setBrake(false); }} onPointerCancel={() => { engine.setBrake(false); }} onLostPointerCapture={() => engine.setBrake(false)} aria-label="刹车和后退">A</button><button onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); engine.pedal(); }} onPointerUp={() => { engine.input.boost = false; }} onPointerCancel={() => { engine.input.boost = false; }} onLostPointerCapture={() => { engine.input.boost = false; }} aria-label="启动巡航和加速">D</button></div><div><button onClick={() => engine.turn()}>Q</button><button onClick={() => engine.jump()} aria-label="跳跃">↥</button><button onClick={() => engine.interact()}>E</button></div></div>

    {(state.overlay === 'pause' || state.overlay === 'settings' || state.overlay === 'journal') && <div className="modal-backdrop">
      {state.overlay === 'settings' && <Settings engine={engine} preferences={save?.preferences ?? engine.menuPreferences} close={closeOverlay}/>}
      {state.overlay === 'journal' && <Journal save={save} initialTab={journalTab} close={closeOverlay}/>}
      {state.overlay === 'pause' && <div className="modal pause-modal" role="dialog" aria-modal="true" aria-label={helpOpen ? '骑行操作说明' : '骑行暂停'}><button className="icon-button modal-close" aria-label="关闭暂停" onClick={() => { setHelpOpen(false); closeOverlay(); }}><Icon name="close"/></button><span className="pause-seal"><Icon name={helpOpen ? 'wheel' : 'wind'} size={33}/></span><span className="eyebrow">THERE IS NO NEED TO HURRY</span><h2>{helpOpen ? '风会带你慢慢上手。' : '在这里，歇一会儿。'}</h2><p className="pause-copy">{playing ? '世界和信件的时钟都停下了。' : '自动巡航，不用一直按住前进。'}<br/>{helpOpen ? '经过邮局按 E 取信，骑到对应道路的信箱按 E 送达。' : '问候还在信包里，风景会等你回来。'}</p>{helpOpen && <div className="control-guide">{[['W / S', '向上 / 向下换一条相连的路'], ['A', '刹车至零后可倒骑；松开后平滑停稳'], ['D', '停车后按一下恢复巡航，按住则加速'], ['Q', '平滑掉头，转身继续旅行'], ['空格', '轻轻跳过小障碍'], ['E', '投信、停靠邮局、继续骑行'], ['B', '鸣铃，请行人留意'], ['Esc', '暂停，随时保存与离开']].map(([key, desc]) => <div key={key}><kbd>{key}</kbd><span>{desc}</span></div>)}</div>}<button className="button primary wide" onClick={() => { setHelpOpen(false); closeOverlay(); }}>{playing ? '继续，去下一处风景' : '好，准备出发'}<Icon name="arrow" size={17}/></button>{playing && <div className="pause-actions"><button className="button" onClick={() => openJournal()}><Icon name="book" size={16}/>手账</button><button className="button" onClick={() => engine.setOverlay('settings')}><Icon name="settings" size={16}/>设置</button><button className="button" onClick={() => engine.download()}><Icon name="download" size={16}/>备份</button><button className="button wide" disabled={busy} onClick={() => void home()}><Icon name="home" size={15}/>{busy ? '正在记好旅途…' : '保存并返回主页'}</button></div>}{(error || state.saveError) && <div className="save-error-box" role="alert"><p>{error || state.saveError}</p><button className="text-button" onClick={() => void engine.persist()}>重试保存</button><button className="text-button" onClick={() => engine.download()}>导出当前进度</button>{state.saveError.includes("另一个标签页") && <button className="text-button" onClick={() => engine.reloadSavedProgress()}>舍弃未保存部分，重读本地进度</button>}</div>}<p className="fine-print">{playing ? `有效旅途 ${formatTime(save?.stats.seconds ?? 0)} · 暂停、后台和离线均不计时` : '不会死亡，没有通关。按自己的节奏走就好。'}</p></div>}
    </div>}
    <input ref={fileInput} className="file-input" type="file" accept=".json,application/json" onChange={async (event) => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
      try { if (file.size > 2 * 1024 * 1024) throw new Error('备份文件过大，请选择这款游戏导出的 JSON 存档。'); setPendingImport(validateSave(JSON.parse(await file.text()))); } catch (e) { setError(e instanceof Error ? e.message : '无法读取这个备份。'); }
    }}/>
    {pendingImport && <div className="modal-backdrop"><div className="modal import-modal" role="dialog" aria-modal="true" aria-label="导入存档"><div className="modal-heading"><div><span className="eyebrow">WELCOME BACK, LITTLE POSTBIRD</span><h2>把这段旅途带回来。</h2></div><button className="icon-button" onClick={() => setPendingImport(null)} aria-label="取消导入"><Icon name="close"/></button></div><p>「{pendingImport.name}」· 已送达 {pendingImport.stats.delivered} 封</p><label className="import-slot-label">导入到<select value={selectedSlot} onChange={(e) => setSelectedSlot(Number(e.target.value))}>{[1, 2, 3].map((s) => <option value={s} key={s}>槽位 {s} · {slots[s - 1].save?.name ?? (slots[s - 1].error ? '需要恢复' : '空邮路')}</option>)}</select></label>{(slots[selectedSlot - 1].save || slots[selectedSlot - 1].error) && <p className="import-warning">这个槽位已有记录，确认后将替换。{slots[selectedSlot - 1].save && <button className="text-button" onClick={() => exportSave(slots[selectedSlot - 1].save!)}>先导出原有邮路备份</button>}</p>}<button className="button primary wide" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await engine.importInto(pendingImport, selectedSlot); setPendingImport(null); await loadSlots(); } catch (e) { setError(e instanceof Error ? e.message : '导入失败'); } finally { setBusy(false); } }}>{busy ? '正在收好旅途…' : '确认导入到这个槽位'}<Icon name="arrow" size={17}/></button>{error && <p className="inline-error" role="alert">{error}</p>}</div></div>}
    {error && !pendingImport && state.overlay === 'none' && <div className="global-error" role="alert"><Icon name="bell" size={18}/><span>{error}</span><button className="icon-button" onClick={() => setError('')} aria-label="关闭提示"><Icon name="close" size={15}/></button></div>}
  </div>;
}
