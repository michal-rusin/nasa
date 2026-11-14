import { METRIC_KEYS } from '../data/types'
import { METRIC_META } from '../rank/metrics'
import { useStore } from '../store'

export function WeightsPanel() {
  const weights = useStore((s) => s.weights)
  const setWeight = useStore((s) => s.setWeight)
  const radius = useStore((s) => s.nmsRadiusKm)
  const setNmsRadius = useStore((s) => s.setNmsRadius)
  return (
    <section>
      <h2>Wagi rankingu</h2>
      {METRIC_KEYS.map((k) => (
        <label key={k} className="row">
          <span>{METRIC_META[k].label}</span>
          <input type="range" min={0} max={5} step={1} value={weights[k]}
            onChange={(e) => setWeight(k, Number(e.target.value))} />
          <span>{weights[k]}</span>
        </label>
      ))}
      <label className="row">
        <span>Promień NMS [km]</span>
        <input type="number" min={0} step={0.5} value={radius}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (Number.isFinite(v)) setNmsRadius(v)
          }} />
      </label>
    </section>
  )
}
