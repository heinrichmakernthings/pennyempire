import type { Company, Industry, Owner } from '@/contracts/game-state';

const INDUSTRY: Record<Industry, string> = { farm: 'Farm', mill: 'Flour mill', dairy: 'Dairy', pizza: 'Pizza restaurant', cafe: 'Café', timber: 'Timber yard' };
export const industryLabel = (i: Industry) => INDUSTRY[i];
export const ownerKindLabel = (k: Owner['kind']) => (k === 'player' ? 'Player' : k === 'npc' ? 'NPC' : 'State');
export const companyStatusTone = (s: Company['status']) => (s === 'operating' ? 'Operating' : s === 'paused' ? 'Paused' : 'Insolvent');

const COMMODITIES: Record<string, string> = { wheat: 'Wheat', flour: 'Flour', milk: 'Milk', cheese: 'Cheese', timber: 'Timber', pizza: 'Pizza', energy: 'Energy', 'cafe-drink': 'Café drinks' };
export const commodityLabel = (id: string) => COMMODITIES[id] ?? id;
