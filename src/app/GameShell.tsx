import { useEffect, useState } from 'react'
import { CanvasRoot } from './CanvasRoot'
import { HUD } from './HUD'
import { DialoguePanel } from './DialoguePanel'
import { ActivityPanel } from './ActivityPanel'
import { WardrobePanel } from './WardrobePanel'
import { StoragePanel } from './StoragePanel'
import { ShopPanel } from './ShopPanel'
import { Phone } from './phone/Phone'
import { SocialActivityTracker } from './SocialActivityTracker'
import { useActionKeys } from './useActionKeys'
import { useKeyboardControls } from '../game/controls/useKeyboardControls'
import { registry } from '../game/world/runtimeRegistry'

/** Simple splash shown until physics is up and the first frames rendered. */
function LoadingOverlay() {
  const [ready, setReady] = useState(registry.gameReady)
  useEffect(() => {
    if (ready) return
    const interval = setInterval(() => {
      if (registry.gameReady) {
        setReady(true)
        clearInterval(interval)
      }
    }, 120)
    return () => clearInterval(interval)
  }, [ready])
  if (ready) return null
  return (
    <div className="loading-overlay" data-testid="loading-overlay">
      <div className="loading-title">BlockLife</div>
      <div className="loading-sub">waking up the block…</div>
    </div>
  )
}

export function GameShell() {
  useKeyboardControls()
  useActionKeys()
  return (
    <div className="game-root">
      <CanvasRoot />
      <HUD />
      <SocialActivityTracker />
      <DialoguePanel />
      <ActivityPanel />
      <WardrobePanel />
      <StoragePanel />
      <ShopPanel />
      <Phone />
      <LoadingOverlay />
    </div>
  )
}
