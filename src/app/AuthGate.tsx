import { useEffect, type ReactNode } from 'react';
import { useAuth } from '@/data/authClient';
import { AuthScreen } from '@/screens/AuthScreen';
import { Skeleton } from '@/ui/States';

/**
 * Private alpha: when the server requires accounts, nothing of the game renders until the player signs in. `children` is a function
 * of the signed-in player id so every per-player cache is rebuilt from scratch when the account changes (no data bleeds between players).
 */
export function AuthGate({ server, children }: { server: boolean; children: (playerKey: string) => ReactNode }) {
  const { status, user, check } = useAuth();
  useEffect(() => { if (server) void check(); }, [server, check]);
  if (!server) return <>{children('fixture')}</>;
  if (status === 'unknown') return <main className="pe-auth" id="main"><Skeleton lines={3} label="Connecting to Bristol" /></main>;
  if (status === 'signed-out') return <AuthScreen />;
  return <>{children(user?.playerId ?? 'local')}</>;
}
