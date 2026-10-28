export interface RouteDef { path: string; label: string; short: string; icon: string; mobile: 'primary' | 'more' }

/** The seven main game sections. `icon` names a file in assets/art/ui. */
export const ROUTES: RouteDef[] = [
  { path: '/city', label: 'City', short: 'City', icon: 'city', mobile: 'primary' },
  { path: '/opportunities', label: 'Opportunities', short: 'Ideas', icon: 'startup', mobile: 'more' },
  { path: '/bristol', label: 'News & Rankings', short: 'News', icon: 'ranking', mobile: 'more' },
  { path: '/companies', label: 'My Companies', short: 'Companies', icon: 'companies', mobile: 'primary' },
  { path: '/commodities', label: 'Commodity Exchange', short: 'Market', icon: 'marketplace', mobile: 'primary' },
  { path: '/stocks', label: 'Stock Exchange', short: 'Stocks', icon: 'stocks', mobile: 'more' },
  { path: '/portfolio', label: 'Portfolio', short: 'Portfolio', icon: 'portfolio', mobile: 'primary' },
  { path: '/prestige', label: 'Prestige', short: 'Prestige', icon: 'prestige', mobile: 'more' },
  { path: '/wallet', label: 'Wallet (simulated)', short: 'Wallet', icon: 'wallet', mobile: 'more' },
];
