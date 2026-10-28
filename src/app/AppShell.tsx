import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { AdSlot } from './AdSlot';
import { FinancialHUD } from './FinancialHUD';
import { NotificationRegion } from './NotificationRegion';
import { PrimaryNavigation } from './PrimaryNavigation';
import { Skeleton } from '@/ui/States';

export function AppShell() {
  return (
    <div className="pe-shell">
      <a href="#main" className="pe-skip">Skip to content</a>
      <FinancialHUD />
      <PrimaryNavigation />
      <main id="main" className="pe-main" tabIndex={-1}>
        <Suspense fallback={<Skeleton lines={5} label="Loading screen" />}><Outlet /></Suspense>
      </main>
      <AdSlot />
      <NotificationRegion />
    </div>
  );
}
