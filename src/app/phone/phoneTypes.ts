import type { PhoneAppId } from '../../game/store/useGameStore'

export interface PhoneAppDef {
  id: PhoneAppId
  label: string
  icon: string
}

export const PHONE_APPS: PhoneAppDef[] = [
  { id: 'home', label: 'Home', icon: '🏠' },
  { id: 'map', label: 'Map', icon: '🗺️' },
  { id: 'bag', label: 'Bag', icon: '🎒' },
  { id: 'quests', label: 'Quests', icon: '⭐' },
  { id: 'missions', label: 'Jobs+', icon: '📋' },
  { id: 'messages', label: 'Chats', icon: '💬' },
  { id: 'contacts', label: 'People', icon: '👥' },
  { id: 'jobs', label: 'Jobs', icon: '💼' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
]

export const PHONE_BUILD_LABEL = 'BlockLife v0.1.0 · “Block Party”'
