import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './app/AppShell';
import { CityScreen } from './city/CityScreen';
import { NotFound } from './screens/NotFound';

// City is the landing screen and stays in the main bundle; management/market screens are split.
const Companies = lazy(() => import('./screens/CompaniesScreen').then((m) => ({ default: m.CompaniesScreen })));
const Commodities = lazy(() => import('./screens/CommodityScreen').then((m) => ({ default: m.CommodityScreen })));
const Stocks = lazy(() => import('./screens/StocksScreen').then((m) => ({ default: m.StocksScreen })));
const Portfolio = lazy(() => import('./screens/PortfolioScreen').then((m) => ({ default: m.PortfolioScreen })));
const Prestige = lazy(() => import('./screens/PrestigeScreen').then((m) => ({ default: m.PrestigeScreen })));
const DevEconomy = lazy(() => import('./screens/DevEconomyScreen').then((m) => ({ default: m.DevEconomyScreen })));
const Opportunities = lazy(() => import('./screens/OpportunitiesScreen').then((m) => ({ default: m.OpportunitiesScreen })));
const StartCompany = lazy(() => import('./screens/StartCompanyScreen').then((m) => ({ default: m.StartCompanyScreen })));
const Wallet = lazy(() => import('./screens/WalletScreen').then((m) => ({ default: m.WalletScreen })));

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/city" replace />} />
        <Route path="/city" element={<CityScreen />} />
        <Route path="/opportunities" element={<Opportunities />} />
        <Route path="/start" element={<StartCompany />} />
        <Route path="/companies" element={<Companies />} />
        <Route path="/commodities" element={<Commodities />} />
        <Route path="/stocks" element={<Stocks />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/prestige" element={<Prestige />} />
        <Route path="/wallet" element={<Wallet />} />
        <Route path="/dev/economy" element={<DevEconomy />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
