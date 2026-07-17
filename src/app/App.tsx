import { useEffect } from 'react'
import { GameShell } from './GameShell'

export default function App() {
  useEffect(() => {
    if (import.meta.env.DEV) {
      // Dev/test-only automation hooks (window.GAME_TEST_API); the dynamic
      // import keeps the module out of production bundles entirely.
      void import('../game/test/gameTestApi').then(({ installTestApi }) => installTestApi())
    }
  }, [])
  return <GameShell />
}
