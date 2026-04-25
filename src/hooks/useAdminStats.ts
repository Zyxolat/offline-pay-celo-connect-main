import { useCallback, useEffect, useState } from 'react';
import { adminAPI } from '@/services/adminClient';

export const useAdminStats = (enabled = true) => {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    if (!enabled) {
      setStats(null);
      setError(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const response = await adminAPI.getStats();
      setStats(response.data.data);
      setError(null);
    } catch (err: any) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        setError('Admin access required');
      } else {
        setError(err.response?.data?.error || 'Failed to load admin stats');
      }
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setStats(null);
      setError(null);
      setLoading(false);
      return;
    }

    void loadStats();

    const intervalId = window.setInterval(() => {
      void loadStats();
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [enabled, loadStats]);

  return { stats, loading, error, refresh: loadStats };
};
