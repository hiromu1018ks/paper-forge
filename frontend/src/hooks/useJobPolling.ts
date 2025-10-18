import { useQuery } from '@tanstack/react-query';

import { getJobStatus } from '@/api/jobs';
import type { JobInfo } from '@/types/api';

interface UseJobPollingOptions {
  jobId?: string | null;
  enabled?: boolean;
  intervalMs?: number;
}

export const useJobPolling = ({ jobId, enabled = false, intervalMs = 2000 }: UseJobPollingOptions) =>
  useQuery<JobInfo | undefined, Error>({
    queryKey: ['job-status', jobId],
    queryFn: async () => {
      if (!jobId) return undefined;
      return getJobStatus(jobId);
    },
    enabled: enabled && Boolean(jobId),
    refetchInterval: (query) => {
      if (!enabled || !jobId) return false;
      const info = query.state.data;
      if (!info) return intervalMs;
      return info.status === 'done' || info.status === 'error' ? false : intervalMs;
    },
    staleTime: 0,
  });
