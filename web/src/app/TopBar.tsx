import { useSyncExternalStore } from 'react'
import { LANGS, useT } from '../i18n'
import { useStore } from '../store'

const LOGO = `${import.meta.env.BASE_URL}assets/logo.svg`

function subscribeHash(cb: () => void): () => void {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}
const isSouthPole = () => window.location.hash === '#/south-pole'

export function TopBar() {
  const t = useT()
  const lang = useStore((s) => s.lang)
  const setLang = useStore((s) => s.setLang)
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
      <div className="seg" role="group" aria-label={t('lang.switch')}>
        {LANGS.map((l) => (
          <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>
    </header>
  )
}
