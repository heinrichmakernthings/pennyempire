import people from '@art/phase7/characters.json';
import { artUrl } from './artAssets';
// Presentation identity only. This never changes an NPC's strategy, ownership or accounts.
const REPRESENTATIVES: Record<string,string> = {
  'co-mad-slices':'leo-marsh','co-clifton-slice':'dev-patel','co-harbour-bean':'nora-bell','co-bean-there':'maya-reed',
  'co-severn-farm':'arthur-vale','co-brunel-mill':'farah-ali','co-clifton-dairy':'aisha-cole','co-avon-timber':'kit-morgan',
};
export function npcPortrait(companyId: string, kind: string) {
  if(kind!=='npc')return null;
  const id=REPRESENTATIVES[companyId];
  const person=people.people.find(p=>p.id===id);
  if(!person)return null;
  return { name:person.name, url:artUrl(person.assets.portrait.neutral), avatar:artUrl(person.assets.avatar.neutral) };
}
