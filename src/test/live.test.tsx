import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FinancialHUD } from '@/app/FinancialHUD';
import { DataProvider } from '@/data/store';
import { createFixtureDataSource } from '@/data/fixtures';
import type { GameDataSource } from '@/data/types';
import { OperatingStatement } from '@/screens/OperatingStatement';

const fixture = createFixtureDataSource('normal', { delayMs: 0 });
const asServer = (over: Partial<GameDataSource> = {}): GameDataSource => ({ ...fixture, authority: 'server', load: async (k, o) => ({ ...(await fixture.load(k, o)), authority: 'server' }) as never, ...over });

describe('server vs fixture labelling in the shell', () => {
  it('server data shows a live-simulation badge with the day number and no illustrative badge', async () => {
    render(<DataProvider source={asServer()}><MemoryRouter><FinancialHUD /></MemoryRouter></DataProvider>);
    expect(await screen.findByText(/Live simulation · Day 1/)).toBeInTheDocument();
    expect(screen.queryByText('Demo data')).not.toBeInTheDocument();
  });
  it('fixture data shows the illustrative badge and no live badge', async () => {
    render(<DataProvider source={fixture}><MemoryRouter><FinancialHUD /></MemoryRouter></DataProvider>);
    expect(await screen.findByText('Demo data')).toBeInTheDocument();
    expect(screen.queryByText(/Live simulation/)).not.toBeInTheDocument();
  });
});

describe('operating statement', () => {
  const row = (tick: number, net: number) => ({ tick, gameDate: 'x', revenue: 10_000, cogs: 4_000, labour: 2_000, property: 500, marketing: 100, fees: 40, tax: 0, energyPaid: 30, inputPurchases: 3_000, grossProfit: 6_000, netProfit: net, cash: 500_000, inventoryValue: 0, unitsProduced: 10, unitsSold: 10, unpaid: 0, status: 'operating' });
  it('renders stored daily rows newest first with signed profit', async () => {
    const src = asServer({ loadFinancials: async () => [row(1, 3_360), row(2, -1_200)] });
    render(<DataProvider source={src}><OperatingStatement companyId="c" asOf="a" /></DataProvider>);
    const rows = await screen.findAllByRole('row');
    expect(rows[1]).toHaveTextContent('Day 2'); expect(rows[1]).toHaveTextContent('-12 EC'); expect(rows[2]).toHaveTextContent('+33.60 EC');
  });
  it('explains itself when the source has no history (fixtures)', async () => {
    render(<DataProvider source={fixture}><OperatingStatement companyId="c" asOf="a" /></DataProvider>);
    expect(await screen.findByText(/not available for illustrative data/)).toBeInTheDocument();
  });
});
