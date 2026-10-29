import init from './0001_init';
import companyManagement from './0002_company_management';
import exchange from './0003_exchange';
import livingBristol from './0004_living_bristol';
import stockExchange from './0005_stock_exchange';
import stateEconomy from './0006_state_economy';
import prestigeWallet from './0007_prestige_wallet';
import accounts from './0008_accounts';
import auditFixes from './0009_audit_fixes';

export interface Migration { id: string; sql: string }
/** Append-only. Never edit an applied migration; add a new one. */
export const MIGRATIONS: Migration[] = [{ id: '0001_init', sql: init }, { id: '0002_company_management', sql: companyManagement }, { id: '0003_exchange', sql: exchange }, { id: '0004_living_bristol', sql: livingBristol }, { id: '0005_stock_exchange', sql: stockExchange }, { id: '0006_state_economy', sql: stateEconomy }, { id: '0007_prestige_wallet', sql: prestigeWallet }, { id: '0008_accounts', sql: accounts }, { id: '0009_audit_fixes', sql: auditFixes }];
