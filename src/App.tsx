import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './app/AppShell';
import { CityScreen } from './city/CityScreen';
import { NotFound } from './screens/NotFound';

// City is the landing screen and stays in the main bundle; management/market screens are split.
const Companies = lazy(() => import('./screens/CompaniesScreen').then((m) => ({ default: m.CompaniesScreen })));
const Commodities = lazy(() => import('./screens/CommodityScreen').then((m) => ({ default: m.CommodityScreen })));
const State = lazy(() => import('./screens/StateScreen').then((m) => ({ default: m.StateScreen })));
const Rewards = lazy(() => import('./screens/RewardsScreen').then((m) => ({ default: m.RewardsScreen })));
const Membership = lazy(() => import('./screens/MembershipScreen').then((m) => ({ default: m.MembershipScreen })));
const DevTreasury = lazy(() => import('./screens/DevTreasuryScreen').then((m) => ({ default: m.DevTreasuryScreen })));
const Stocks = lazy(() => import('./screens/shares/SharesScreen').then((m) => ({ default: m.SharesRoute })));
const Ipo = lazy(() => import('./screens/shares/IpoScreen').then((m) => ({ default: m.IpoScreen })));
const Portfolio = lazy(() => import('./screens/PortfolioScreen').then((m) => ({ default: m.PortfolioScreen })));
const Prestige = lazy(() => import('./screens/PrestigeScreen').then((m) => ({ default: m.PrestigeScreen })));
const DevEconomy = lazy(() => import('./screens/DevEconomyScreen').then((m) => ({ default: m.DevEconomyScreen })));
const Opportunities = lazy(() => import('./screens/OpportunitiesScreen').then((m) => ({ default: m.OpportunitiesScreen })));
const StartCompany = lazy(() => import('./screens/StartCompanyScreen').then((m) => ({ default: m.StartCompanyScreen })));
const Bristol = lazy(() => import('./screens/BristolScreen').then((m) => ({ default: m.BristolScreen })));
const Competitor = lazy(() => import('./screens/CompetitorScreen').then((m) => ({ default: m.CompetitorScreen })));
const Wallet = lazy(() => import('./screens/WalletScreen').then((m) => ({ default: m.WalletScreen })));

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/city" replace />} />
        <Route path="/city" element={<CityScreen />} />
        <Route path="/opportunities" element={<Opportunities />} />
        <Route path="/bristol" element={<Bristol />} />
        <Route path="/competitors/:id" element={<Competitor />} />
        <Route path="/start" element={<StartCompany />} />
        <Route path="/companies" element={<Companies />} />
        <Route path="/commodities" element={<Commodities />} />
        <Route path="/state" element={<State />} />
        <Route path="/stocks" element={<Stocks />} />
        <Route path="/stocks/list/:companyId" element={<Ipo />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/prestige" element={<Prestige />} />
        <Route path="/rewards" element={<Rewards />} />
        <Route path="/membership" element={<Membership />} />
        <Route path="/dev/treasury" element={<DevTreasury />} />
        <Route path="/wallet" element={<Wallet />} />
        <Route path="/dev/economy" element={<DevEconomy />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
