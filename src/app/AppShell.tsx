import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { OnboardingCard } from './Onboarding';
import { AwayCard } from './AwayCard';
import { AdSlot } from './AdSlot';
import { FinancialHUD } from './FinancialHUD';
import { NotificationRegion } from './NotificationRegion';
import { PrimaryNavigation } from './PrimaryNavigation';
import { Skeleton } from '@/ui/States';

export function AppShell() {
  const { pathname } = useLocation();
  return (
    <div className="pe-shell">
      <a href="#main" className="pe-skip">Skip to content</a>
      <FinancialHUD />
      <PrimaryNavigation />
      <main id="main" className="pe-main" tabIndex={-1}>
        <AwayCard />
        {(pathname === '/city' || pathname === '/companies' || pathname === '/start') && <div className="pe-onboard-wrap"><OnboardingCard /></div>}
        <Suspense fallback={<Skeleton lines={5} label="Loading screen" />}><Outlet /></Suspense>
        <div className="pe-main-ad"><AdSlot placement="mobile" /></div>
      </main>
      <AdSlot />
      <NotificationRegion />
    </div>
  );
}
