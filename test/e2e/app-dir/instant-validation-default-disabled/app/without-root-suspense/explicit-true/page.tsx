// Same violation as `bare/page.tsx`, but with `unstable_instant = true`.
// `true` is "opt in at the framework default level" — under default
// 'disabled', that falls back to 'warning'. Instant validation fires in
// dev (and takes priority over the static-shell error since instant is
// active); build does not validate.
import { connection } from 'next/server'

export const unstable_instant = true

export default async function Page() {
  await connection()
  return (
    <main>
      <p>explicit-true: opt in at the framework default level.</p>
    </main>
  )
}
