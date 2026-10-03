/**
 * /home — the post-sign-in landing target. SignalStack's real home is the
 * Board, so redirect there. (Kept because the auth flow lands users on /home.)
 */

import { Navigate } from 'react-router-dom'

export default function HomePage() {
  return <Navigate to="/board" replace />
}
