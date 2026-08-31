import type { NPCDef } from '../game/npc/npcTypes'

/**
 * The six residents of the block. Routines are data-driven: `from`/`to` are
 * in-game hours; `idle` anchors an NPC near a point, `patrol` loops waypoints.
 */
export const NPC_DEFS: NPCDef[] = [
  {
    id: 'npc_ravi_01',
    name: 'Ravi',
    role: 'Your friend',
    bodyColor: '#4a7fd4',
    headColor: '#e8b98a',
    walkSpeed: 1.6,
    // Issue #23: rides the rich blocklife_person rig (real idle/walk/run) with a curated
    // unique identity from the population appearance registry.
    characterAssetId: 'blocklife_ravi_01',
    routine: [
      { from: 6, to: 12, mode: 'idle', points: [[-8.5, -5]] },
      { from: 12, to: 18, mode: 'idle', points: [[13.5, -6.5]] },
      // Evening spot sits off Bruno's patrol line in front of the gym.
      { from: 18, to: 6, mode: 'idle', points: [[9.5, -7.5]] },
    ],
    ambientLines: [
      'What a block, huh?',
      'I could really use a coffee...',
      'Morning runs are the best.',
    ],
  },
  {
    id: 'npc_maya_01',
    name: 'Maya',
    role: 'Food truck owner',
    bodyColor: '#e0576f',
    headColor: '#c98a5e',
    walkSpeed: 1.5,
    // Issue #23: rides the rich blocklife_person rig (real idle/walk/run) with a curated
    // unique identity from the population appearance registry.
    characterAssetId: 'blocklife_person',
    routine: [
      // Beside the serving window, clear of the truck's collider footprint.
      { from: 6, to: 22, mode: 'idle', points: [[4.4, -4.4]] },
      { from: 22, to: 6, mode: 'idle', points: [[-10.5, -6]] },
    ],
    ambientLines: [
      'Fresh coffee, hot meals!',
      'Best snacks on the block!',
      'The evening rush is coming.',
    ],
  },
  {
    id: 'npc_bruno_01',
    name: 'Coach Bruno',
    role: 'Gym trainer',
    bodyColor: '#d4763a',
    headColor: '#8a5a3c',
    walkSpeed: 1.3,
    // Issue #23: upgraded from a primitive to the rich blocklife_person rig + registry identity.
    characterAssetId: 'blocklife_person',
    routine: [{ from: 0, to: 24, mode: 'patrol', points: [[11.5, -9], [17.5, -9]] }],
    ambientLines: [
      'One more rep!',
      'Strong body, strong day.',
      'The gym never sleeps. I do, though.',
    ],
  },
  {
    id: 'npc_leo_01',
    name: 'Leo',
    role: 'Delivery guy',
    bodyColor: '#6cc24a',
    headColor: '#e8b98a',
    walkSpeed: 2.4,
    // Issue #23: upgraded from a primitive to the rich blocklife_person rig + registry identity.
    characterAssetId: 'blocklife_person',
    routine: [
      {
        from: 0,
        to: 24,
        mode: 'patrol',
        // Delivery loop: north crosswalk detour (Traffic v1), then along the
        // outer sidewalk and out to the Market Strip via the east connector
        // (City Expansion v1) before resuming the inner ring.
        points: [
          [-20.3, -19.9],
          [0, -22.2],
          [0, -29.8],
          [10, -30.5],
          [30, -30],
          [30, 2.2],
          [30, 9.8],
          [42.8, 10.8],
          [43, 16],
          [43, 22],
          [43, 16],
          [42.8, 10.8],
          [30, 9.8],
          [30, 2.2],
          [30, -30],
          [10, -30.5],
          [0, -29.8],
          [0, -22.2],
          [20.6, -19.9],
          [20.6, 20.3],
          [-20.3, 20.3],
        ],
      },
    ],
    ambientLines: [
      'Package for... someone!',
      'No time to chat, deliveries!',
      'This block keeps me fit.',
    ],
  },
  {
    id: 'npc_kim_01',
    name: 'Officer Kim',
    role: 'Neighborhood patrol',
    bodyColor: '#3f5f8f',
    headColor: '#c98a5e',
    walkSpeed: 1.8,
    // Issue #23: rigged with a curated population identity (like the whole named cast).
    characterAssetId: 'blocklife_person',
    routine: [
      {
        from: 0,
        to: 24,
        mode: 'patrol',
        // Outer-sidewalk beat, now with a Residential Street leg (up the
        // north connector's east sidewalk, past the houses, back) plus the
        // signalled west-crosswalk detour from Traffic v2.
        points: [
          [-30, -30],
          [16, -30.5],
          [16, -39.6],
          [26, -39.6],
          [16, -39.6],
          [16, -30.5],
          [30, -30],
          [30, 30],
          [-30, 30],
          [-29.8, 0],
          [-22.2, 0],
          [-21.8, 8],
          [-22.2, 0],
          [-29.8, 0],
        ],
      },
    ],
    ambientLines: [
      'All quiet on the block.',
      'Nice evening for a patrol.',
      'Stay safe out there.',
    ],
  },
  {
    id: 'npc_nisha_01',
    name: 'Nisha',
    role: 'Your neighbor',
    bodyColor: '#9a5fc0',
    headColor: '#8a5a3c',
    walkSpeed: 1.4,
    // Issue #23: upgraded from a primitive to the rich blocklife_person rig + registry identity.
    characterAssetId: 'blocklife_person',
    routine: [
      { from: 6, to: 12, mode: 'idle', points: [[-14, -8.5]] },
      {
        from: 12,
        to: 19,
        mode: 'patrol',
        // Afternoon stroll: park bench → west crosswalk → outer curb & back,
        // crossing only with the walk signal.
        points: [
          [-10.5, 10.5],
          [-22.2, 0],
          [-29.8, 0],
          [-22.2, 0],
        ],
      },
      { from: 19, to: 6, mode: 'idle', points: [[-12.5, -7]] },
    ],
    ambientLines: [
      'The park is lovely today.',
      'Have you met Maya? Great coffee.',
      'I love this neighborhood.',
    ],
  },
]

export const NPC_BY_ID: Record<string, NPCDef> = Object.fromEntries(
  NPC_DEFS.map((n) => [n.id, n]),
)
