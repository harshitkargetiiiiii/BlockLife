import {
  COFFEE_COST,
  MEAL_COST,
  MEAL_HUNGER_RESTORE,
  TRAIN_ENERGY_COST,
  WORK_ENERGY_COST,
  WORK_PAY,
} from '../../game/simulation/economySystem'

interface JobCard {
  icon: string
  title: string
  where: string
  details: string
}

// Informational only — the player still has to walk (or drive) there.
const JOBS: JobCard[] = [
  {
    icon: '🧰',
    title: 'Work a shift',
    where: 'Job Board, by Nook Offices',
    details: `+$${WORK_PAY} · Energy −${WORK_ENERGY_COST} · takes 4h`,
  },
  {
    icon: '💪',
    title: 'Training session',
    where: 'Block Gym',
    details: `Strength +1 · Energy −${TRAIN_ENERGY_COST} · takes 1h`,
  },
  {
    icon: '🍜',
    title: 'Hot meal',
    where: "Maya's Snack Truck",
    details: `$${MEAL_COST} · Hunger −${MEAL_HUNGER_RESTORE}`,
  },
  {
    icon: '☕',
    title: 'Coffee',
    where: "Maya's Snack Truck",
    details: `$${COFFEE_COST} · goes in your bag`,
  },
]

export function PhoneJobs() {
  return (
    <div className="phone-app">
      <div className="phone-section-title">Ways to hustle</div>
      <div data-testid="phone-jobs">
        {JOBS.map((job) => (
          <div key={job.title} className="phone-card phone-job">
            <span className="phone-job-icon">{job.icon}</span>
            <div>
              <div className="phone-job-title">{job.title}</div>
              <div className="phone-job-where">{job.where}</div>
              <div className="phone-job-details">{job.details}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="phone-muted">Show up in person — this phone can’t do the work for you.</div>
    </div>
  )
}
