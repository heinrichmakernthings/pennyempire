import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { DataProvider } from './data/store';
import { chooseDataSource } from './data/serverSource';
import { ErrorState } from './ui/States';
import { AuthGate } from './app/AuthGate';
import './design/tokens.css';
import './design/global.css';
import './design/management.css';
import './design/economy.css';

const root = createRoot(document.getElementById('root')!);
// A failed connection never enters a pretend saved game. Illustrative previews require an explicit choice.
void chooseDataSource(window.location.search).then(({ source, fallbackReason }) => {
  if (fallbackReason) {
    root.render(<main className="pe-auth" id="main"><div className="pe-stack">
      <ErrorState title="Bristol is temporarily unavailable" message="The game server isn’t responding. Your saved progress has not been replaced. Reconnect to continue playing." onRetry={() => window.location.reload()} />
      <a className="pe-btn pe-btn--ghost" href="/city?source=fixture">Explore an illustrative preview</a>
      <p className="pe-hint">Preview data is fictional. Purchases and management changes in the preview cannot be saved.</p>
    </div></main>);
    return;
  }
  root.render(
    <StrictMode>
      <BrowserRouter>
        <AuthGate server={source.authority === 'server'}>
          {(playerKey) => <DataProvider key={playerKey} source={source}><App /></DataProvider>}
        </AuthGate>
      </BrowserRouter>
    </StrictMode>,
  );
});
