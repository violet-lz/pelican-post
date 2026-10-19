import type { SaveGameV1 } from './types';

export interface ShopItem { id: string; name: string; label: string; effect: string; price: number; owned: boolean; icon: 'bag' | 'pin' | 'wheel' }

export function shopItems(save: SaveGameV1): ShopItem[] {
  return [
    { id: 'capacity', name: '帆布信件包', label: '把问候多带一份', effect: `容量 ${save.player.capacity} → ${Math.min(8, save.player.capacity + 1)} 格`, price: 60 + (save.player.capacity - 4) * 35, owned: save.player.capacity >= 8, icon: 'bag' },
    { id: 'smooth-bearing', name: '轻巧轴承', label: '让脚踏轻盈一点', effect: '巡航速度 +3%', price: 48, owned: save.player.inventory.includes('smooth-bearing'), icon: 'wheel' },
    { id: 'lucky-pin', name: '海风小徽章', label: '车筐上的一点心意', effect: '送达金币 +2% · 零头满 1 枚发放', price: 32, owned: save.player.inventory.includes('lucky-pin'), icon: 'pin' },
  ];
}

export function purchase(save: SaveGameV1, id: string): string | null {
  const item = shopItems(save).find((i) => i.id === id);
  if (!item || item.owned) return '这件物品已经备好了。';
  if (save.player.coins < item.price) return '金币还不够，路上的问候会慢慢攒起来。';
  save.player.coins -= item.price;
  save.stats.spent += item.price;
  if (id === 'capacity') {
    save.player.capacity++;
    save.purchases.push(`bag-${save.player.capacity}`);
  } else {
    save.player.inventory.push(id);
    save.player.equipped.push(id);
    save.purchases.push(id);
  }
  return null;
}
