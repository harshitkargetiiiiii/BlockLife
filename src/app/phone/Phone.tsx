import { useGameStore } from '../../game/store/useGameStore'
import { formatClock } from '../../game/simulation/timeSystem'
import { PHONE_APPS } from './phoneTypes'
import { getBatteryLevel } from './phoneUtils'
import { PhoneHome } from './PhoneHome'
import { PhoneMap } from './PhoneMap'
import { PhoneQuests } from './PhoneQuests'
import { PhoneMessages } from './PhoneMessages'
import { PhoneContacts } from './PhoneContacts'
import { PhoneJobs } from './PhoneJobs'
import { PhoneMissions } from './PhoneMissions'
import { PhoneBag } from './PhoneBag'
import { PhoneSettings } from './PhoneSettings'

function PhoneStatusBar() {
  const stats = useGameStore((s) => s.stats)
  const battery = getBatteryLevel(stats)
  return (
    <div className="phone-status-bar">
      <span data-testid="phone-status-clock">
        Day {stats.day} · {formatClock(stats.hour)}
      </span>
      <span className="phone-status-right">
        <span data-testid="phone-status-money">${Math.round(stats.money)}</span>
        <span className="phone-battery" title={`Battery ${battery}% (mirrors energy)`}>
          <span className="phone-battery-fill" style={{ width: `${battery}%` }} />
        </span>
      </span>
    </div>
  )
}

function PhoneAppContent() {
  const app = useGameStore((s) => s.ui.activePhoneApp)
  switch (app) {
    case 'home':
      return <PhoneHome />
    case 'map':
      return <PhoneMap />
    case 'quests':
      return <PhoneQuests />
    case 'missions':
      return <PhoneMissions />
    case 'messages':
      return <PhoneMessages />
    case 'contacts':
      return <PhoneContacts />
    case 'jobs':
      return <PhoneJobs />
    case 'bag':
      return <PhoneBag />
    case 'settings':
      return <PhoneSettings />
  }
}

/**
 * The in-game smartphone: Tab toggles it, Escape closes it. Gameplay input
 * is swallowed while it's open (the world keeps animating behind it).
 */
export function Phone() {
  const isOpen = useGameStore((s) => s.ui.panel === 'phone')
  const activeApp = useGameStore((s) => s.ui.activePhoneApp)
  const setPhoneApp = useGameStore((s) => s.setPhoneApp)
  const togglePhone = useGameStore((s) => s.togglePhone)

  if (!isOpen) return null

  return (
    <div className="phone-wrap">
      <div className="phone" data-testid="phone">
        <div className="phone-notch" />
        <PhoneStatusBar />
        <div className="phone-screen" data-testid={`phone-app-${activeApp}`}>
          <PhoneAppContent />
        </div>
        <nav className="phone-nav">
          {PHONE_APPS.map((app) => (
            <button
              key={app.id}
              className={`phone-nav-btn ${activeApp === app.id ? 'phone-nav-active' : ''}`}
              data-testid={`phone-nav-${app.id}`}
              title={app.label}
              onClick={() => setPhoneApp(app.id)}
            >
              <span className="phone-nav-icon">{app.icon}</span>
              <span className="phone-nav-label">{app.label}</span>
            </button>
          ))}
        </nav>
        <button className="phone-close" data-testid="phone-close" onClick={togglePhone}>
          ✕
        </button>
      </div>
    </div>
  )
}
