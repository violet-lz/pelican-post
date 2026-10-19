import { useState } from 'react';
import { calendar } from '../game/clock';
import { formatDistance, formatTime } from '../game/math';
import { activeVisit } from '../game/mail';
import type { SaveGameV1 } from '../game/types';
import { REGIONS, REGION_IDS, addressById, levelFor } from '../world/regions';
import { Icon } from './Icon';

export type JournalTab = 'overview' | 'bag' | 'places' | 'achievements';

export function Journal({ save, initialTab = 'overview', close }: { save: SaveGameV1 | null; initialTab?: JournalTab; close: () => void }) {
  const [tab, setTab] = useState<JournalTab>(initialTab);
  const stats = save?.stats; const time = calendar(save?.worldSeconds ?? 0);
  const achievements = [
    { name: '第一声问候', desc: '完成第一次信件投递', icon: 'mail', value: stats?.delivered ?? 0, goal: 1 },
    { name: '好消息邮差', desc: '收到 10 次好评', icon: 'star', value: stats?.goodReviews ?? 0, goal: 10 },
    { name: '风走了一公里', desc: '累计骑行 1 公里', icon: 'wind', value: Math.floor(stats?.distance ?? 0), goal: 1000 },
    { name: '海岸拾光', desc: '遇见海岸的 5 处特色风景', icon: 'camera', value: stats?.landmarks.filter((id) => id.startsWith('coast:')).length ?? 0, goal: 5 },
    { name: '久别的问候', desc: '送达一封循环信', icon: 'heart', value: stats?.loopDelivered ?? 0, goal: 1 },
    { name: '远方有六个名字', desc: '到访全部 6 个地区', icon: 'map', value: stats ? REGION_IDS.filter((id) => stats.regionVisits[id] > 0).length : 0, goal: 6 },
  ];
  return <div className="modal journal-modal" role="dialog" aria-modal="true" aria-label="邮差手账"><div className="modal-heading"><div><span className="eyebrow">LITTLE THINGS, WELL REMEMBERED</span><h2>邮差的旅行手账</h2></div><button className="icon-button" onClick={close} aria-label="关闭手账"><Icon name="close"/></button></div><div className="journal-tabs">{([['overview', '旅途记录'], ['bag', `信包 ${save?.bag.length ?? 0}`], ['places', '沿途风景'], ['achievements', '小小成就']] as const).map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</div><div className="journal-body">
    {tab === 'overview' && <><div className="journal-summary"><div><span>{save?.name ?? '还没出发的邮路'}</span><h3>{time.season}，第 {time.day} 天。</h3><p>每一次出发，每一声问候，都被好好记住。</p></div><span className="level-stamp">POST<br/><strong>{save ? levelFor(save.stats.delivered) : 1}</strong><small>邮差等级</small></span></div><div className="stats-grid">{[['骑行里程', formatDistance(stats?.distance ?? 0), 'wind'], ['已送达', `${stats?.delivered ?? 0} 封`, 'mail'], ['收到好评', `${stats?.goodReviews ?? 0} 次`, 'star'], ['遇见地标', `${stats?.landmarks.length ?? 0} 处`, 'camera']].map(([title, value, icon]) => <div className="stat-card" key={title}><Icon name={icon}/><small>{title}</small><strong>{value}</strong></div>)}</div><dl className="ledger">{[['有效旅途时间', formatTime(stats?.seconds ?? 0)], ['实际骑行时间', formatTime(stats?.cyclingSeconds ?? 0)], ['普通 / 跨区 / 循环送达', `${stats?.ordinaryDelivered ?? 0} / ${stats?.crossDelivered ?? 0} / ${stats?.loopDelivered ?? 0}`], ['手动 / 自动送达', `${stats?.manualDelivered ?? 0} / ${stats?.autoDelivered ?? 0}`], ['特别感谢 / 0 星 / 退件', `${stats?.specialThanks ?? 0} / ${stats?.zeroReviews ?? 0} / ${stats?.returned ?? 0}`], ['累计收入 / 消费 / 索赔', `${stats?.earned ?? 0} / ${stats?.spent ?? 0} / ${stats?.claims ?? 0} 金币`], ['近期信任', `${save?.player.trust ?? 100} / 100`]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><h3 className="section-label">最近的回信 <small>保留最近 100 次送达</small></h3><div className="receipts">{!save?.history.length ? <p className="quiet">第一封回信，会在第一次送达后出现在这里。</p> : save.history.map((r) => <article className="receipt" key={r.id}><Icon name="mail" size={18}/><div><strong>{r.recipient} <span>· {REGIONS[r.region].name}</span></strong><p>{r.message}</p></div><span className="receipt-stars">{r.loop ? '循环信' : '★'.repeat(r.stars) || '0 星'}<b>{r.reward >= 0 ? '+' : ''}{r.reward}</b></span></article>)}</div></>}
    {tab === 'bag' && <>{!save?.bag.length ? <div className="empty-state"><Icon name="mail" size={40}/><h3>轻装，也是一种旅行。</h3><p>经过邮局时按 E，挑几封想送的信。<br/>也可以什么都不带，去看看远方。</p></div> : save.bag.map((letter) => {
      const address = addressById(letter.addressId)!; const current = activeVisit(save);
      const here = letter.targetRegion === current.region;
      const distance = current.length * address.fraction - save.player.x;
      return <article className={`bag-letter ${letter.state === 'loop' ? 'loop-letter' : ''}`} key={letter.id}><span className="letter-stamp"><Icon name="mail" size={25}/></span><div><span className="eyebrow">{letter.state === 'loop' ? `循环信 · 冻结于 ${formatTime(letter.frozenElapsed ?? 0)}` : `在路上 ${formatTime(save.worldSeconds - letter.pickedAt)}`}</span><h3>{address.recipient} · {address.name}</h3><p>{REGIONS[letter.targetRegion].name} · {address.lane} 号路 · {letter.size} 格</p><small>{here ? `${distance >= 0 ? '前方' : '身后'} ${formatDistance(Math.abs(distance))}` : '在前方的邮路再次相遇'}{letter.state === 'loop' ? ' · 收件人的故事将在送达时揭晓' : ' · 普通信没有超时失败'}</small></div></article>;
    })}<p className="fine-print">在手账中，所有旅途与信件时钟均暂停。需办理退件时，请到邮局。</p></>}
    {tab === 'places' && <div className="places-grid">{REGION_IDS.map((id) => { const region = REGIONS[id]; const found = stats?.landmarks.filter((l) => l.startsWith(id + ':')).length ?? 0; const visited = (stats?.regionVisits[id] ?? 0) > 0; return <article className={`place-card ${!visited ? 'undiscovered' : ''}`} key={id}><div className="place-top"><Icon name="landmark" size={26}/><span>{visited ? `${found} / 5` : `Lv${region.level}`}</span></div><h3>{region.name}</h3><p>{region.subtitle}</p><ul>{region.landmarks.map((l) => <li key={l.id} className={stats?.landmarks.includes(l.id) ? 'found' : ''}><Icon name={stats?.landmarks.includes(l.id) ? 'check' : 'camera'} size={12}/>{l.name}</li>)}</ul>{visited && <small>到访 {stats?.regionVisits[id]} 次</small>}</article>; })}</div>}
    {tab === 'achievements' && <div className="achievement-grid">{achievements.map((a) => <article className={`achievement ${a.value >= a.goal ? 'earned' : ''}`} key={a.name}><span className="achievement-seal"><Icon name={a.icon} size={27}/></span><div><h3>{a.name}</h3><p>{a.desc}</p><div className="achievement-track"><i style={{ width: `${Math.min(100, a.value / a.goal * 100)}%` }}/></div><small>{a.value >= a.goal ? '已收进手账' : `${Math.min(a.value, a.goal)} / ${a.goal}`}</small></div></article>)}</div>}
    </div><div className="modal-foot"><Icon name="pause" size={13}/><span>停下来翻翻手账，问候不会因此迟到。</span></div></div>;
}
