'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

// A stand-in for another company's product with the Ticket0 widget pasted in, to try the embed end to end.
export default function EmbedDemoPage() {
  return <Suspense><DemoSite /></Suspense>;
}

function DemoSite() {
  const p = useSearchParams();
  const title = p.get('title') || 'Northwind Help';
  const color = p.get('color') || '#1f4fd1';
  const signedIn = p.get('anon') !== '1';

  useEffect(() => {
    // Exactly what the host product pastes, built at runtime from the URL's settings. Added once per page.
    if (document.querySelector('script[data-t0]')) return;
    const s = document.createElement('script');
    s.dataset.t0 = '1';
    s.src = '/widget.js';
    s.async = true;
    s.dataset.title = title;
    s.dataset.color = color;
    if (signedIn) { s.dataset.name = 'Jo Patel'; s.dataset.email = 'jo@example.com'; }
    document.body.appendChild(s);
  }, [title, color, signedIn]);

  return (
    <div className="fixed inset-0 overflow-auto bg-white text-[15px] text-[#222]">
      <nav className="flex items-center gap-6 border-b border-[#eee] px-8 py-4">
        <span className="text-lg font-bold" style={{ color }}>Northwind</span>
        <span className="text-[#666]">Shop</span><span className="text-[#666]">Orders</span><span className="text-[#666]">Account</span>
        <span className="ml-auto text-sm text-[#666]">{signedIn ? 'Signed in as Jo Patel' : 'Not signed in'}</span>
      </nav>
      <main className="mx-auto max-w-4xl px-8 py-12">
        <div className="mb-2 inline-block rounded bg-[#fff4d6] px-2 py-0.5 text-xs font-medium text-[#8a6100]">Demo host site · not part of Ticket0</div>
        <h1 className="mb-3 text-3xl font-bold">Your orders</h1>
        <p className="mb-8 max-w-xl text-[#555]">This page plays the part of another company&apos;s product. The chat bubble in the corner is the Ticket0 widget,
          added with one script tag. Messages land in the Ticket0 playground with a <b>widget</b> badge.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {[['#4700', 'Coffee mugs ×2, Kettle', '$75.00', 'Delivered 10 days ago'], ['#4701', 'Tea sampler', '$18.00', 'On the way']].map(([id, items, total, status]) => (
            <div key={id} className="rounded-xl border border-[#eee] p-5">
              <div className="mb-1 font-semibold">Order {id}</div>
              <div className="text-[#555]">{items}</div>
              <div className="mt-3 flex justify-between text-sm"><span className="text-[#888]">{status}</span><span className="font-medium">{total}</span></div>
            </div>
          ))}
        </div>
        <p className="mt-10 text-sm text-[#888]">Try: “The kettle from order 4700 arrived dented, can I get a refund?”</p>
      </main>
    </div>
  );
}
