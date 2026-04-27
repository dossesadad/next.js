import { Suspense, type ReactNode } from 'react'

// Default validation level is 'disabled' (set in next.config.ts).
// No implicit validation should fire on bare pages, in dev or build.
// Explicit `unstable_instant` configs still apply.
//
// Children are wrapped in Suspense so that pages with uncached data
// accessed at the top of the page don't fail static-shell validation
// (the Suspense fallback renders into the static shell). Instant
// validation can still flag "Suspense too high for instant navigation"
// as an instant-specific violation when it runs.

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html>
      <body>
        <Suspense fallback={<p>loading…</p>}>{children}</Suspense>
      </body>
    </html>
  )
}
