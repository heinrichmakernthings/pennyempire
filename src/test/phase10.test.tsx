import { render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { FirstBusiness } from '@/city/FirstBusiness';
import { createFixtureDataSource } from '@/data/fixtures';
import { chooseDataSource } from '@/data/serverSource';
import { useQuery } from '@/data/managementApi';
import { HelpTip } from '@/ui/HelpTip';
import { ProductionPanel } from '@/screens/company/panels';
import { ConnectionNotice } from '@/ui/ConnectionNotice';
import type { Company } from '@/contracts/game-state';
import type { Management } from '@/shared/management';

it('uses the actual player balance for the first-business guide and hides it for previews', async () => {
  const loaded = await createFixtureDataSource('normal', { delayMs: 0 }).load('city');
  const data = { ...loaded.envelope.data, directory: [], player: { ...loaded.envelope.data.player, coins: { currency: 'EC' as const, minor: 123456 } } };
  const view = render(<MemoryRouter><FirstBusiness data={data} illustrative={false} /></MemoryRouter>);
  expect(screen.getByText('1,234.56 EC')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Find my first opportunity' })).toHaveAttribute('href', '/opportunities');
  view.rerender(<MemoryRouter><FirstBusiness data={data} illustrative /></MemoryRouter>);
  expect(screen.queryByRole('link', { name: 'Find my first opportunity' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Preview mode')).toHaveTextContent('cannot be saved');
});

it('does not suggest reconnecting fixes a screen that still needs server integration', () => {
  render(<ConnectionNotice connected />);
  expect(screen.getByLabelText('Preview mode')).toHaveTextContent('awaiting server integration');
  expect(screen.queryByRole('button', { name: 'Reconnect to game' })).not.toBeInTheDocument();
});

it('keeps production overcommitment visible while the accessible meter stays in range', () => {
  const m = { production: { plannedBatches: 12, effectiveBatches: 8, outputPerBatch: 3, outputUnits: 36, log: [] } } as unknown as Management;
  render(<ProductionPanel c={{} as Company} m={m} />);
  expect(screen.getByText('8 batches (24 units)')).toBeInTheDocument();
  expect(screen.getByRole('meter', { name: 'Target vs capacity' })).toHaveAttribute('aria-valuenow', '100');
  expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '150%');
});

it('supports keyboard opening and Escape dismissal of contextual help', async () => {
  const user = userEvent.setup();
  render(<HelpTip label="Marketing help">Awareness fades each game day.</HelpTip>);
  await user.tab(); await user.keyboard('{Enter}');
  expect(screen.getByRole('note')).toHaveTextContent('Awareness fades');
  await user.keyboard('{Escape}');
  expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('note')).not.toBeInTheDocument();
});

it('does not call management APIs until authoritative data is enabled', async () => {
  const load = vi.fn().mockResolvedValue({ ok: true });
  const { result, rerender } = renderHook(({ enabled }) => useQuery(load, [], false, enabled), { initialProps: { enabled: false } });
  expect(load).not.toHaveBeenCalled();
  rerender({ enabled: true });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(load).toHaveBeenCalledTimes(1);
});

it('turns an HTML gateway failure into a useful, explicitly illustrative fallback', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Gateway failure</html>', { status: 502 })));
  try {
    const result = await chooseDataSource('');
    expect(result.source.authority).toBe('illustrative-fixture');
    expect(result.fallbackReason).toContain('Reconnect to game');
    expect(result.fallbackReason).not.toMatch(/Unexpected|SyntaxError|<html>/);
  } finally { vi.unstubAllGlobals(); }
});

it('renders one frame of approved animation-strip icons instead of shrinking all four', async () => {
  const { Icon } = await import('@/ui/Icon');
  const view = render(<Icon name="production-timber" size={24} />);
  expect(view.container.firstChild).toHaveStyle({ maskSize: '400% 100%', maskPosition: 'left center' });
  view.rerender(<Icon name="companies" size={24} />);
  expect((view.container.firstChild as HTMLElement).style.maskSize).toBe('');
});
