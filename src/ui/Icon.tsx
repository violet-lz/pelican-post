import type { CSSProperties } from 'react';

const paths: Record<string, string> = {
  mail: 'M3 5h18v14H3z M3 6l9 7 9-7',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  chevron: 'm9 5 7 7-7 7',
  close: 'm6 6 12 12M6 18 18 6',
  pause: 'M8 5v14M16 5v14',
  play: 'm7 4 13 8-13 8z',
  book: 'M12 5v15M3 4q5-2 9 1 4-3 9-1v15q-5-2-9 1-4-3-9-1z',
  settings: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5M16 12a4 4 0 1 0-8 0 4 4 0 1 0 8 0',
  moon: 'M20 15a9 9 0 0 1-11-11 9 9 0 1 0 11 11z',
  bag: 'M5 8h14l1 12H4zM8 8V6a4 4 0 0 1 8 0v2M8 12v2m8-2v2',
  coin: 'M21 12a9 9 0 1 0-18 0 9 9 0 1 0 18 0M14.5 8h-3a2 2 0 0 0 0 4h1a2 2 0 0 1 0 4h-3M12 6v12',
  star: 'm12 3 2.8 5.7L21 9.6l-4.5 4.5 1 6.2-5.5-3-5.5 3 1-6.2L3 9.6l6.2-.9z',
  check: 'm5 12 4 4L19 6',
  map: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 3v16m6-14v16',
  wheel: 'M8 12a5 5 0 1 0 0 .1M21 12a5 5 0 1 0 0 .1M3 12l5-8 5 8H3l4-6h8l3 6M14 3h4',
  pin: 'M6 3h12l-1 8-5 3-5-3zM12 14v7',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  upload: 'M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5',
  heart: 'M12 21 4 13C-3 6 7-1 12 6 17-1 27 6 20 13z',
  wind: 'M3 8h12a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 17h5a2 2 0 1 1-2 2',
  clock: 'M21 12a9 9 0 1 0-18 0 9 9 0 1 0 18 0M12 7v5l3 2',
  camera: 'M3 6h5l2-3h4l2 3h5v15H3zM16 13a4 4 0 1 0-8 0 4 4 0 1 0 8 0',
  landmark: 'M3 9h18L12 3zM5 10v9m5-9v9m4-9v9m5-9v9M3 21h18',
  volume: 'M3 9h4l5-5v16l-5-5H3zM16 8q5 4 0 8m3-11q8 7 0 14',
  bell: 'M5 17h14l-2-4V8a5 5 0 0 0-10 0v5zM10 21h4',
  home: 'm3 11 9-8 9 8M5 9v12h14V9M10 21v-7h4v7',
};

export function Icon({ name, size = 20, className = '', style }: { name: string; size?: number; className?: string; style?: CSSProperties }) {
  return <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name] ?? paths.mail}/></svg>;
}

export function Logo({ small = false }: { small?: boolean }) {
  return <span className={`brand ${small ? 'brand-small' : ''}`}><svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true"><rect width="36" height="36" rx="12" fill="#e2e6d7"/><path d="M6 27c-1-6 3-12 11-12h3v-4q0-7 7-4l2 6 5 2-12 3q-2 10-16 9Z" fill="#6a8b75"/><path d="m26 12 8 3-9 2" fill="#d7aa72"/><circle cx="25" cy="10" r="1.3" fill="#f8f2dd"/></svg><span>鹈鹕邮差<small>PELICAN POST CLUB</small></span></span>;
}
