import { useState } from 'react';
import { GameEngine } from '../game/engine';
import { activeVisit, usedCapacity } from '../game/mail';
import type { SaveGameV1 } from '../game/types';
import { addressById, REGIONS } from '../world/regions';
import { formatDistance, formatTime } from '../game/math';
import { Icon } from './Icon';

export function Station({ save, engine }: { save: SaveGameV1; engine: GameEngine }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [tab, setTab] = useState<'pick' | 'bag'>('pick');
  const [error, setError] = useState('');
  const [returnId, setReturnId] = useState('');
  const visit = activeVisit(save); const kind = engine.station!;
  const offers = visit.offers[kind];
  const selectedSize = offers.filter((o) => selected.includes(o.id)).reduce((sum, o) => sum + o.size, 0);
  const occupied = usedCapacity(save);
  const completed = offers.filter((o) => visit.completed.includes(o.id)).length;
  return <aside className="station-panel" role="dialog" aria-modal="true" aria-label="邮局信件抽屉">
    <div className="panel-heading"><div><span className="eyebrow">A DRAWER FULL OF HELLOS</span><h2>给远方，捎个信。</h2></div><button className="icon-button" onClick={() => engine.resume()} aria-label="离开邮局"><Icon name="close"/></button></div>
    <div className="station-note"><Icon name="pause" size={14}/><span>已停靠 · 时间与信件计时暂停</span></div>
    <div className="panel-tabs"><button className={tab === 'pick' ? 'active' : ''} onClick={() => setTab('pick')}>抽屉里的信</button><button className={tab === 'bag' ? 'active' : ''} onClick={() => setTab('bag')}>我的信包 <span>{save.bag.length}</span></button></div>
    {tab === 'pick' ? <>
      <div className="drawer-caption"><span>第 {visit.generation[kind] + 1} 批 · 已妥投 {completed} / {offers.length}</span><span>整批妥投后补信</span></div>
      <div className="letter-list">
        {offers.map((offer, index) => {
          const address = addressById(offer.addressId)!;
          const taken = visit.taken.includes(offer.id); const done = visit.completed.includes(offer.id);
          const inBag = save.bag.some((l) => l.id === offer.id);
          const checked = selected.includes(offer.id);
          const disabled = taken || (!checked && occupied + selectedSize + offer.size > save.player.capacity);
          return <label className={`letter-card ${checked ? 'selected' : ''} ${taken ? 'taken' : ''} ${disabled && !taken ? 'full' : ''}`} key={offer.id}>
            <input type="checkbox" checked={checked} disabled={disabled} onChange={() => { setError(''); setSelected((s) => checked ? s.filter((id) => id !== offer.id) : [...s, offer.id]); }}/>
            <span className={`letter-stamp stamp-${index % 3}`}><Icon name={done ? 'check' : offer.kind === '文件快递' ? 'book' : 'mail'} size={22}/><small>{String(index + 1).padStart(2, '0')}</small></span>
            <span className="letter-info"><span className="letter-title">{address.recipient} <small>{offer.kind}</small></span><span className="letter-address">{address.name} · {address.lane} 号路</span><span className="letter-meta">{offer.targetRegion === visit.region ? formatDistance(offer.referenceDistance) : `跨区 · ${REGIONS[offer.targetRegion].name}`}<i/>占 {offer.size} 格</span></span>
            <span className="letter-price">{taken ? <small>{done ? '已妥投' : inBag ? '信包里' : '已退件'}</small> : <><b>{offer.baseReward}</b><small>基础邮资</small></>}</span>
            <span className="check-box">{checked && <Icon name="check" size={13}/>}</span>
          </label>;
        })}
      </div>
      <div className="station-bottom"><div className="capacity-line"><span><Icon name="bag" size={16}/>信包容量</span><strong>{occupied + selectedSize} <em>/ {save.player.capacity} 格</em></strong></div><div className="capacity-track">{Array.from({ length: save.player.capacity }, (_, i) => <i key={i} className={i < occupied ? 'occupied' : i < occupied + selectedSize ? 'chosen' : ''}/>)}</div>{error && <p className="inline-error" role="alert">{error}</p>}<button className="button primary wide" disabled={!selected.length} onClick={() => { const err = engine.collect(selected); if (err) setError(err); }}>装好 {selected.length ? `${selected.length} 封信，` : ''}继续骑行<Icon name="arrow" size={17}/></button><p className="fine-print">确认领取时，同批信件一起开始计时。<br/>普通信没有超时失败，放心慢慢走。</p></div>
    </> : <>
      <div className="letter-list return-list">{!save.bag.length ? <div className="empty-state"><Icon name="bag" size={34}/><h3>信包轻轻的。</h3><p>去抽屉里挑几封问候吧。</p></div> : save.bag.map((letter) => {
        const address = addressById(letter.addressId)!;
        const fee = Math.max(1, Math.round(letter.baseReward * .1));
        return <article className="return-card" key={letter.id}><div><span className="eyebrow">{letter.state === 'loop' ? '循环信 · 计时冻结' : `在路上 ${formatTime(save.worldSeconds - letter.pickedAt)}`}</span><h3>{address.recipient} · {address.name}</h3><p>{REGIONS[letter.targetRegion].name} · {address.lane} 号路 · {letter.size} 格</p><p className="return-terms">退件：处理费 {Math.min(save.player.coins, fee)} 金币，信任 −2。退件不计入整批妥投。</p></div><button className={`button small ${returnId === letter.id ? 'danger' : ''}`} onClick={() => { if (returnId !== letter.id) { setReturnId(letter.id); return; } engine.returnLetter(letter.id); setReturnId(''); }}>{returnId === letter.id ? '确认退件' : '办理退件'}</button></article>;
      })}</div><div className="station-bottom"><button className="button primary wide" onClick={() => engine.resume()}>把剩下的问候带在身边<Icon name="arrow" size={17}/></button></div>
    </>}
  </aside>;
}
