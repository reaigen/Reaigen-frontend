# Frontend Production Research Notes

This note records the practical conclusions taken from the Next.js, rendering,
performance, hydration, and browser-security references reviewed for the
Reaigen frontend.

## Applied in this pass

- Keep the public app surface non-indexable. This is a creator/account app with
  authenticated pages and tokenized shared tours, not a marketing site. The root
  metadata now emits `noindex`, and `/robots.txt` disallows crawling.
- Prefer server/static route shells where practical. The login route is now a
  server page that lazy-loads the interactive auth panel.
- Keep heavy interactive rendering isolated. The Babylon splat viewer remains a
  client-only dynamic import because server rendering the 3D canvas would not
  improve the first usable viewer state.
- Treat Core Web Vitals as something to measure, not assume. A small optional
  `useReportWebVitals` reporter now logs metrics in development and posts to
  `NEXT_PUBLIC_WEB_VITALS_ENDPOINT` when configured.
- Add browser defense-in-depth. `next.config.ts` now sets a fuller CSP and
  supporting headers: content sniffing prevention, frame restrictions,
  referrer policy, permissions policy, COOP/CORP, DNS prefetch control, and
  HSTS in production.
- Sanitize managed HTML content before rendering. Legal/content documents are
  now passed through a strict allowlist before `dangerouslySetInnerHTML`.
- Keep API responses private and uncached. Existing API proxy no-store behavior
  remains in place and is covered by the global browser-security headers.

## Not applied yet

- Nonce-based CSP. Next.js supports this pattern, but it requires request-time
  nonce generation and dynamic rendering tradeoffs. The current policy is a
  stronger static CSP that remains compatible with this self-hosted app.
- Full Server Component conversion of dashboard/settings. The current auth and
  data flow is client-context based. Converting these routes safely requires a
  separate data-boundary refactor, not a cosmetic move.
- Framework/compiler replacement. Papers on signals, disappearing frameworks,
  and compiler-augmented VDOMs are useful directionally, but do not justify
  swapping the production stack.

## Source conclusions

- Next.js generally improves initial rendering and SEO compared with plain
  client-rendered React when SSR/SSG/server components are actually used:
  https://arxiv.org/abs/2502.15707
- SSG is often fastest for stable pages; SSR can be stable but adds server work;
  CSR tends to cost initial load time:
  https://ejournal.ikado.ac.id/index.php/teknika/article/view/769
- Hydration is a real bottleneck; dynamic imports and delayed/isolated
  interactivity are practical React/Next techniques:
  https://arxiv.org/abs/2504.03884
- Web performance should be judged by user-centered metrics, especially LCP,
  INP, CLS, and TTFB:
  https://developers.google.com/search/docs/appearance/core-web-vitals
- Streaming SSR can improve TTFB and blocking time, but loading UI quality still
  affects perceived UX:
  https://kth.diva-portal.org/smash/get/diva2%3A1903931/FULLTEXT01.pdf
- XSS remains a major web threat, and CSP alone is not enough. Sanitizing
  untrusted or managed HTML remains necessary:
  https://arxiv.org/abs/2205.08425
- CSP must be treated carefully because origin and iframe interactions can
  undermine naive policies:
  https://arxiv.org/abs/1611.02875
- The official Next.js production, data-security, CSP, and Server Component
  guides align with this approach:
  https://nextjs.org/docs/app/guides/production-checklist
  https://nextjs.org/docs/app/guides/data-security
  https://nextjs.org/docs/app/guides/content-security-policy
  https://nextjs.org/docs/14/app/building-your-application/rendering/server-components
