import { useEffect } from 'react'
import { Sidebar } from '../app/Sidebar'
import { MapView } from '../map/MapView'
import { HorizonDock } from '../panel/HorizonDock'
import { useStore } from '../store'

export default function SouthPole() {
  const status = useStore((s) => s.status)
  const error = useStore((s) => s.error)
  const load = useStore((s) => s.load)

  // Dane bieguna ładujemy dopiero tutaj; przy powrocie z globusa nie pobieramy ich drugi raz.
  useEffect(() => {
    if (useStore.getState().status !== 'ready') void load()
  }, [load])

  return (
    <div id="app-root" className="view-fade">
      {status === 'loading' && <div className="state">Wczytywanie danych…</div>}
      {status === 'error' && (
        <div className="state error">
          <strong>Nie udało się wczytać danych.</strong>
          <p>{error}</p>
        </div>
      )}
      {status === 'ready' && (
        <>
          <div className="main-col">
            <MapView />
            <HorizonDock />
          </div>
          <Sidebar />
        </>
      )}
    </div>
  )
}
