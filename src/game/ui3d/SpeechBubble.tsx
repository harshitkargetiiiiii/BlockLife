import { Html } from '@react-three/drei'

const IS_VITEST = Boolean(
  (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.VITEST,
)

/** A small comic-style speech bubble floating above an NPC's head. */
export function SpeechBubble({ text, offset = 2.6 }: { text: string; offset?: number }) {
  if (IS_VITEST) {
    return <group name={`speech-bubble:${text}`} />
  }
  return (
    <Html position={[0, offset, 0]} center zIndexRange={[50, 0]} style={{ pointerEvents: 'none' }}>
      <div className="speech-bubble">{text}</div>
    </Html>
  )
}
