import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from '@/App';
import { DataProvider } from '@/data/store';
import { createFixtureDataSource, type FixtureMode } from '@/data/fixtures';
import { useUi } from '@/state/ui';

function setup(path = '/city', mode: FixtureMode = 'normal') {
  useUi.setState({ selectedCompanyId: null, inspectorOpen: true, notices: [] });
  const user = userEvent.setup();
  render(<DataProvider source={createFixtureDataSource(mode, { delayMs: 0 })}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></DataProvider>);
  return user;
}

describe('navigation and the eight sections', () => {
  const sections: [string, RegExp][] = [
    ['/city', /Bristol economy/], ['/companies', /My Companies/], ['/commodities', /Commodity Exchange/], ['/stocks', /Stock Exchange/],
    ['/state', /State services/], ['/portfolio', /^Portfolio$/], ['/prestige', /^Prestige$/], ['/wallet', /Wallet \(simulated\)/],
  ];
  it.each(sections)('%s renders its screen', async (path, heading) => {
    setup(path);
    expect(await screen.findByRole('heading', { name: heading, level: path === '/city' ? 2 : 1 })).toBeInTheDocument();
  });
  it('the main navigation links to all nine sections (seven game sections plus Opportunities and News & Rankings) and switches screens', async () => {
    const user = setup('/city');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('link')).toHaveLength(10);
    await user.click(within(nav).getByRole('link', { name: /Stock Exchange/ }));
    expect(await screen.findByRole('heading', { name: 'Stock Exchange', level: 1 })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /Stock Exchange/ })).toHaveAttribute('aria-current', 'page');
  });
  it('unknown routes show a not-found state with a way back', async () => {
    setup('/nope');
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
  });
  it('the HUD shows EC values and flags the data as illustrative', async () => {
    setup('/city');
    expect(await screen.findByText('24,850 EC')).toBeInTheDocument();
    expect(screen.getByText('+510 EC')).toBeInTheDocument();
    expect(screen.getAllByText('Demo data').length).toBeGreaterThan(0);
  });
  it('an advertising slot is reserved but inert', async () => {
    setup('/city');
    const ad = await screen.findByRole('complementary', { name: /Sponsored space/ });
    expect(within(ad).queryAllByRole('link')).toHaveLength(0);
    expect(within(ad).queryAllByRole('button')).toHaveLength(0);
  });
});

describe('city: selecting a company', () => {
  it('opens company information from the accessible business list', async () => {
    const user = setup('/city');
    const list = await screen.findByRole('list', { name: 'Businesses in Bristol' });
    expect(within(list).getAllByRole('button')).toHaveLength(6);
    await user.click(within(list).getByRole('button', { name: /Mad Slices/ }));
    const panel = await screen.findByRole('article', { name: 'Mad Slices' });
    expect(within(panel).getByText('Pizza restaurant · Level 2')).toBeInTheDocument();
    expect(within(panel).getByText('Your company')).toBeInTheDocument();
    expect(within(panel).getByText('Operating')).toBeInTheDocument();
    expect(within(panel).getByText('Illustrative data')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Manage company' })).toHaveAttribute('href', '/companies?company=co-mad-slices');
  });
  it('shows an NPC company as read-only with its fictional owner', async () => {
    const user = setup('/city');
    const list = await screen.findByRole('list', { name: 'Businesses in Bristol' });
    await user.click(within(list).getByRole('button', { name: /Brunel Milling/ }));
    const panel = await screen.findByRole('article', { name: 'Brunel Milling' });
    expect(within(panel).getByText(/NPC company · read-only/)).toBeInTheDocument();
    expect(within(panel).getByText('Brunel Milling Ltd')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'View company details' })).toBeInTheDocument();
    expect(within(panel).queryByRole('link', { name: /Buy supplies/ })).not.toBeInTheDocument();
  });
  it('clearing the selection returns to the city overview', async () => {
    const user = setup('/city');
    const list = await screen.findByRole('list', { name: 'Businesses in Bristol' });
    await user.click(within(list).getByRole('button', { name: /Harbour Bean/ }));
    await user.click(await screen.findByRole('button', { name: 'Clear selection' }));
    expect(await screen.findByText('Bristol economy')).toBeInTheDocument();
  });
});

describe('loading, empty, error and stale states', () => {
  it('shows a loading skeleton before data arrives', () => {
    setup('/wallet');
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });
  it('shows an error state with retry when the source fails', async () => {
    setup('/companies', 'error');
    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn't load my companies/i);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
  it('shows an empty state with a next action instead of fabricated companies', async () => {
    setup('/companies', 'empty');
    expect(await screen.findByText("You don't own a company yet")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Find an opportunity/ })).toBeInTheDocument();
  });
  it('empty portfolio links to the exchange', async () => {
    setup('/portfolio', 'empty');
    expect(await screen.findByText('Your portfolio is empty')).toBeInTheDocument();
  });
});

describe('companies: draft editing never writes authoritative state', () => {
  it('validates the draft, keeps it on failure, and reports that nothing was sent', async () => {
    const user = setup('/companies?company=co-mad-slices');
    await user.click(await screen.findByRole('tab', { name: 'Operations' }));
    const price = await screen.findByLabelText(/Price per unit/);
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await user.clear(price); await user.type(price, '3');
    expect(await screen.findByText('Price is outside the allowed range.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await user.clear(price); await user.type(price, '11');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Settings not saved')).toBeInTheDocument();
    expect(screen.getByText(/No game server is connected/)).toBeInTheDocument();
    expect(price).toHaveValue('11'); // draft preserved
    expect(screen.getByText(/unsaved changes/)).toBeInTheDocument();
  });
  it('NPC companies are read-only', async () => {
    useUi.setState({ notices: [] });
    setup('/companies');
    expect(screen.queryByLabelText(/Price per unit/)).not.toBeInTheDocument();
  });
});

describe('commodity and stock tickets', () => {
  it('requires a quote and shows subtotal, fee and total before confirming', async () => {
    const user = setup('/commodities');
    const qty = await screen.findByLabelText(/Quantity/);
    await user.clear(qty); await user.type(qty, '10');
    await user.click(screen.getByRole('button', { name: 'Get quote' }));
    const quote = await screen.findByRole('region', { name: 'Quote' });
    expect(within(quote).getByText('24 EC')).toBeInTheDocument(); // 10 × 2.40
    expect(within(quote).getByText('0.48 EC')).toBeInTheDocument(); // 2% fee
    expect(within(quote).getByText('24.48 EC')).toBeInTheDocument();
    await user.click(within(quote).getByRole('button', { name: /Confirm purchase/ }));
    expect(await screen.findByText('Order not placed')).toBeInTheDocument();
  });
  it('editing the ticket invalidates a previous quote', async () => {
    const user = setup('/commodities');
    await user.click(await screen.findByRole('button', { name: 'Get quote' }));
    await screen.findByRole('region', { name: 'Quote' });
    await user.type(screen.getByLabelText(/Quantity/), '5');
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Quote' })).not.toBeInTheDocument());
  });
  it('reports quantity errors from the quote engine', async () => {
    const user = setup('/commodities');
    const qty = await screen.findByLabelText(/Quantity/);
    await user.clear(qty); await user.type(qty, '999999');
    await user.click(screen.getByRole('button', { name: 'Get quote' }));
    expect(await screen.findByText(/Only 410 units available/)).toBeInTheDocument();
  });
  it('state enterprises are shown but not tradable', async () => {
    const user = setup('/stocks');
    await user.click(await screen.findByRole('button', { name: /Bristol Energy/ }));
    expect(await screen.findAllByText('Not tradable')).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Get quote' })).not.toBeInTheDocument();
  });
});

describe('wallet is permanently simulated and separate from Empire Coins', () => {
  it('shows the SIMULATED banner, GBP_TEST balances and no card or bank fields', async () => {
    setup('/wallet');
    expect(await screen.findByText('SIMULATED')).toBeInTheDocument();
    expect(screen.getByText('£12.50 GBP_TEST')).toBeInTheDocument();
    expect(screen.queryByLabelText(/card|bank|sort code|account number|cvv/i)).not.toBeInTheDocument();
    expect(screen.getByText(/cannot be converted into GBP_TEST or real money/)).toBeInTheDocument();
  });
  it('rejects a withdrawal below £5 and over-balance withdrawals', async () => {
    const user = setup('/wallet');
    const form = await screen.findByRole('form', { name: 'Simulated withdrawal' });
    const input = within(form).getByLabelText(/Amount/);
    await user.clear(input); await user.type(input, '4.99');
    await user.click(within(form).getByRole('button', { name: /Review simulated withdrawal/ }));
    expect(await within(form).findByText(/Minimum simulated withdrawal is £5.00/)).toBeInTheDocument();
    await user.clear(input); await user.type(input, '50');
    await user.click(within(form).getByRole('button', { name: /Review simulated withdrawal/ }));
    expect(await within(form).findByText(/exceeds your available GBP_TEST balance/)).toBeInTheDocument();
  });
  it('a valid withdrawal needs explicit confirmation and is not executed without a server', async () => {
    const user = setup('/wallet');
    const form = await screen.findByRole('form', { name: 'Simulated withdrawal' });
    await user.click(within(form).getByRole('button', { name: /Review simulated withdrawal/ }));
    await user.click(await within(form).findByRole('button', { name: /Confirm simulated withdrawal/ }));
    expect(await screen.findByText('Simulated request not sent')).toBeInTheDocument();
  });
});

describe('prestige: unavailable art is never purchasable', () => {
  it('lists missing-art items as unavailable with a reason and no buy flow', async () => {
    const user = setup('/prestige');
    await user.click(await screen.findByRole('button', { name: /Supercar/ }));
    expect(await screen.findByText(/Artwork not yet produced/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /quote/i })).not.toBeInTheDocument();
  });
  it('discloses boost size and duration', async () => {
    const user = setup('/prestige');
    await user.click(await screen.findByRole('button', { name: /Striped parasol/ }));
    expect(await screen.findByText(/\+2% customers at this company \(2%, 7 days\)/)).toBeInTheDocument();
  });
});
