import { useEffect } from 'react'
import { Sidebar } from './app/Sidebar'
import { MapView } from './map/MapView'
import { useStore } from './store'

export default function App() {
  const status = useStore((s) => s.status)
  const error = useStore((s) => s.error)
  const load = useStore((s) => s.load)

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div id="app-root">
      {status === 'loading' && <div className="state">Wczytywanie danych…</div>}
      {status === 'error' && (
        <div className="state error">
          <strong>Nie udało się wczytać danych.</strong>
          <p>{error}</p>
        </div>
      )}
      {status === 'ready' && (
        <>
          <MapView />
          <Sidebar />
        </>
      )}
    </div>
  )
}
