import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Tabs } from '@/ui/Tabs';
import { StatusLabel } from '@/ui/StatusLabel';
const layouts = import.meta.glob('/assets/art/phase8/qa/*-layout.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const destinations = [
  { id: 'london', label: 'London', description: 'Commercial streets and offices beyond Bristol.' },
  { id: 'lisbon', label: 'Lisbon', description: 'Hillside shops and a waterfront trading district.' },
  { id: 'mexico-city', label: 'Mexico City', description: 'Market stalls, workshops and neighbourhood shops.' },
  { id: 'port', label: 'Freight port', description: 'A cargo berth with cranes, warehouses and customs facilities.' },
  { id: 'airport', label: 'Air freight', description: 'An apron, cargo aircraft and freight terminal.' },
];
export function WorldScreen() {
  const [selected, setSelected] = useState('london');
  const destination = destinations.find(d => d.id === selected)!;
  return <section className="pe-screen">
    <div className="pe-screen-head"><h1 className="pe-h1">Beyond Bristol</h1><StatusLabel tone="neutral">Coming later</StatusLabel></div>
    <p>Explore the destinations and transport hubs planned for your empire. Bristol is the playable city; international expansion and freight routes are not open yet.</p>
    <Tabs tabs={destinations.map(({ id, label }) => ({ id, label }))} value={selected} onChange={setSelected} label="Destinations">
      <figure style={{ margin: 0 }}>
        <img className="pe-pixel-art" src={layouts[`/assets/art/phase8/qa/${destination.id}-layout.png`]} alt={`${destination.label}: ${destination.description}`} width={1920} height={1180} style={{ width: '100%', height: 'auto' }} />
        <figcaption><h2 className="pe-h2">{destination.label}</h2><p>{destination.description}</p></figcaption>
      </figure>
    </Tabs>
    <Link className="pe-btn" to="/city">Return to Bristol</Link>
  </section>;
}
