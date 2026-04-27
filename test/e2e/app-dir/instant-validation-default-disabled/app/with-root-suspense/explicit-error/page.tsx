// Same shape as bare/page.tsx — runtime data accessed outside a Suspense
// boundary — but with an explicit `unstable_instant = { level: 'error' }`.
// Even though the default validation level is 'disabled', the explicit
// per-segment opt-in still fires validation in both dev and build, and the
// violation should fail the build.
import { connection } from 'next/server'

export const unstable_instant = { level: 'error' as const }

export default async function Page() {
  await connection()
  return (
    <main>
      <p>
        explicit-error page (unstable_instant level: error), runtime data at the
        top.
      </p>
    </main>
  )
}
