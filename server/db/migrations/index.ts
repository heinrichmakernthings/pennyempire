import init from './0001_init';
import companyManagement from './0002_company_management';
import exchange from './0003_exchange';
import livingBristol from './0004_living_bristol';
import stockExchange from './0005_stock_exchange';

export interface Migration { id: string; sql: string }
/** Append-only. Never edit an applied migration; add a new one. */
export const MIGRATIONS: Migration[] = [{ id: '0001_init', sql: init }, { id: '0002_company_management', sql: companyManagement }, { id: '0003_exchange', sql: exchange }, { id: '0004_living_bristol', sql: livingBristol }, { id: '0005_stock_exchange', sql: stockExchange }];
