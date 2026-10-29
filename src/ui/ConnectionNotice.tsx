import '@/design/phase10.css';
import { Button } from './Button';

export function ConnectionNotice({ connected = false }: { connected?: boolean }) {
  return <aside className="pe-connection" aria-label="Preview mode">
    <div><strong>You're exploring a preview.</strong><p>These are example businesses and balances. Purchases and management changes cannot be saved here. {connected ? "This screen is awaiting server integration." : "Reconnect to load your game."}</p></div>
    {!connected && <Button onClick={() => { const url = new URL(window.location.href); url.searchParams.delete("source"); url.searchParams.delete("fixture"); window.location.assign(url.href); }}>Reconnect to game</Button>}
  </aside>;
}
