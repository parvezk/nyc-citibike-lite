import { Suspense } from 'react';
import LiteLoader from '@/components/LiteLoader';

// /?day=<YYYY-MM-DD|busiest>&rides=<all|sample>  (add &record=1 for the frame-stepping recorder)
export default function Page({ searchParams }: PageProps<'/'>) {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-[#050608]" />}>
      {searchParams.then(p => {
        const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
        const rides = one(p.rides);
        return (
          <LiteLoader
            day={one(p.day)}
            record={one(p.record) === '1'}
            rides={rides === 'all' || rides === 'sample' ? rides : undefined}
          />
        );
      })}
    </Suspense>
  );
}
