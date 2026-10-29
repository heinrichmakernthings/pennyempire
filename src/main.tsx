import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { DataProvider } from './data/store';
import { chooseDataSource } from './data/serverSource';
import { useUi } from './state/ui';
import './design/tokens.css';
import './design/global.css';
import './design/management.css';
import './design/economy.css';

const root = createRoot(document.getElementById('root')!);
// The server-authoritative engine is used when /api/health answers; otherwise we say so and fall back to labelled fixtures.
void chooseDataSource(window.location.search).then(({ source, fallbackReason }) => {
  if (fallbackReason) useUi.getState().notify({ tone: 'warning', title: 'Illustrative data only', message: fallbackReason });
  root.render(
    <StrictMode>
      <DataProvider source={source}>
        <BrowserRouter><App /></BrowserRouter>
      </DataProvider>
    </StrictMode>,
  );
});
