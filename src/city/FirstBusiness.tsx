import { useAuth } from '@/data/authClient';
import { Link } from 'react-router-dom';
import type { CityScreenState } from '@/data/types';
import { formatMoney } from '@/domain/money';
import { ConnectionNotice } from '@/ui/ConnectionNotice';

export function FirstBusiness({ data, illustrative }: { data: CityScreenState; illustrative: boolean }) {
  const hideOnboarding = useAuth(s => s.user?.settings.hideOnboarding);
  if (illustrative) return <ConnectionNotice />;
  const owned = data.directory.filter(c => c.owner.kind === 'player' && c.owner.id === data.player.id);
  if (owned.length) return <div className="pe-city-next"><Link className="pe-btn" to={`/companies?company=${encodeURIComponent(owned[0]!.id)}`}>Manage {owned[0]!.name}</Link><Link className="pe-btn pe-btn--ghost" to="/opportunities">Find your next opportunity</Link></div>;
  if (hideOnboarding) return null;
  return <section className="pe-first-business" aria-labelledby="first-business-title">
    <div><h2 id="first-business-title">Your first business starts here.</h2><p>You have <strong>{formatMoney(data.player.coins)}</strong> in Empire Coins. Find a gap in Bristol's market, review the startup bill, then keep enough company cash for ingredients and wages.</p></div>
    <Link className="pe-btn pe-btn--primary" to="/opportunities">Find my first opportunity</Link>
    <ol aria-label="Your first trading day"><li>Choose a business</li><li>Set a production plan</li><li>Buy supplies or use auto-purchasing</li><li>Review sales after the next game day</li></ol>
  </section>;
}
