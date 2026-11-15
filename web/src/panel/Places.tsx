import { useT } from '../i18n'
import { useStore } from '../store'
import { useAnalysis, type SlotKey } from './analysis'
import { PlaceBox } from './PlaceBox'
import { PlaceTimeline } from './PlaceTimeline'
import { TimeBar } from './TimeBar'

/** Oś czasu jednego miejsca w pasku wspólnym (z literą A/B przy wierszach). */
function SlotTimeline({ slot }: { slot: SlotKey }) {
  const data = useAnalysis((s) => s[slot].data)
  if (!data) return <div className="shared-tl-empty" />
  return <PlaceTimeline data={data} tag={slot.toUpperCase()} />
}

/**
 * Sekcja pod mapą: jeden box (A) albo dwa po 50% szerokości (A i B).
 * W porównaniu suwak czasu i osie czasu nie powielają się w boxach: jeden wspólny pasek
 * stoi pod nimi w zwykłym układzie strony.
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
