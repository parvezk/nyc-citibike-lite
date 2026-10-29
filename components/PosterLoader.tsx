"use client";

import dynamic from 'next/dynamic';

const Poster = dynamic(() => import('./Poster'), { ssr: false });

export default function PosterLoader() {
  return <Poster />;
}
