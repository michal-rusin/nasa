import { useT } from '../i18n'
import { useStore } from '../store'
import { useAnalysis, type SlotKey } from './analysis'
import { PlaceBox } from './PlaceBox'
import { PlaceTimeline } from './PlaceTimeline'
import { TimeBar } from './TimeBar'

/** One location timeline in the shared bar (A/B label on rows). */
function SlotTimeline({ slot }: { slot: SlotKey }) {
  const data = useAnalysis((s) => s[slot].data)
  if (!data) return <div className="shared-tl-empty" />
  return <PlaceTimeline data={data} tag={slot.toUpperCase()} />
}

/**
 * Section below the map: one card (A) or two at 50% width each (A and B).
 * In comparison mode, time controls and timelines are not duplicated in cards: one shared bar
 * sits below them in normal page flow.
 */
export function Places() {
  const t = useT()
  const a = useStore((s) => s.selectedIndex)
  const b = useStore((s) => s.compareIndex)
  if (a === null) return null
  const compare = b !== null
  return (
    <div className={`places-wrap${compare ? ' compare' : ''}`}>
      <section className={`places${compare ? ' compare' : ''}`} data-tour="places" aria-label={t('place.region')}>
        <PlaceBox slot="a" compare={compare} />
        {compare && <PlaceBox slot="b" compare />}
      </section>
      {compare && (
        <section className="shared-time" aria-label={t('panel.time')}>
          <TimeBar />
          <div className="shared-tl">
            <SlotTimeline slot="a" />
            <SlotTimeline slot="b" />
          </div>
        </section>
      )}
    </div>
  )
}
