import init from './0001_init';

export interface Migration { id: string; sql: string }
/** Append-only. Never edit an applied migration; add a new one. */
export const MIGRATIONS: Migration[] = [{ id: '0001_init', sql: init }];
