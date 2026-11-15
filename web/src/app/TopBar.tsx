import { useSyncExternalStore } from 'react'
import { useT } from '../i18n'

const LOGO = `${import.meta.env.BASE_URL}assets/logo.svg`

function subscribeHash(cb: () => void): () => void {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}
const isSouthPole = () => window.location.hash === '#/south-pole'

export function TopBar() {
  const t = useT()
  const onPole = useSyncExternalStore(subscribeHash, isSouthPole)

  return (
    <header className="topbar">
      <a className="brand" href="#/" title={t('nav.home')}>
        <img className="brand-logo" src={LOGO} alt="" width={30} height={28} />
        {t('app.name')}
      </a>
      <nav className="topnav" aria-label={t('nav.main')}>
        <a href="#/" aria-current={onPole ? undefined : 'page'}>{t('nav.moon')}</a>
        <a href="#/south-pole" aria-current={onPole ? 'page' : undefined}>{t('nav.southPole')}</a>
      </nav>
    </header>
  )
}
