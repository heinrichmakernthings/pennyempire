import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { DataProvider } from './data/store';
import { createFixtureDataSource, fixtureModeFromSearch } from './data/fixtures';
import './design/tokens.css';
import './design/global.css';

// The only data source today is the illustrative fixture adapter. A server adapter replaces it behind GameDataSource.
const source = createFixtureDataSource(fixtureModeFromSearch(window.location.search));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DataProvider source={source}>
      <BrowserRouter><App /></BrowserRouter>
    </DataProvider>
  </StrictMode>,
);
