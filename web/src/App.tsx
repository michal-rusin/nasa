import { lazy, Suspense, useSyncExternalStore } from 'react'
import { TopBar } from './app/TopBar'
import { useT } from './i18n'
import { Tour } from './tour/Tour'
import { useTour } from './tour/store'

// Osobne paczki: globus (three.js) i mapa (OpenLayers) nie obciążają się nawzajem.
const Home = lazy(() => import('./views/Home'))
const SouthPole = lazy(() => import('./views/SouthPole'))

type Route = 'home' | 'south-pole'

function subscribeHash(cb: () => void): () => void {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

function currentRoute(): Route {
  return window.location.hash === '#/south-pole' ? 'south-pole' : 'home'
}

export default function App() {
  const route = useSyncExternalStore(subscribeHash, currentRoute)
  const t = useT()
  // Start samouczka montuje widok od nowa (czysty stan lokalny: szuflady, przewinięcie, kamera).
  const epoch = useTour((s) => s.epoch)

  return (
    <div className="shell">
      <TopBar />
      <Suspense fallback={<div className="state">{t('home.loading')}</div>}>
        {route === 'south-pole' ? <SouthPole key={epoch} /> : <Home key={epoch} />}
      </Suspense>
      <Tour />
    </div>
  )
}
