import { useT } from '../i18n'
import { useStore } from '../store'
import { PlaceBox } from './PlaceBox'

/** Sekcja pod mapą: jeden box (A) albo dwa po 50% szerokości (A i B). */
export function Places() {
  const t = useT()
  const a = useStore((s) => s.selectedIndex)
  const b = useStore((s) => s.compareIndex)
  if (a === null) return null
  const compare = b !== null
  return (
    <section className={`places${compare ? ' compare' : ''}`} aria-label={t('place.region')}>
      <PlaceBox slot="a" compare={compare} />
      {compare && <PlaceBox slot="b" compare />}
    </section>
  )
}
