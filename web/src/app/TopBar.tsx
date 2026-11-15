// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

import { useSyncExternalStore } from 'react'
import { useT } from '../i18n'
import { startTour } from '../tour/steps'
import '../tour/tour.css'

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
      <button type="button" className="tour-help" data-tour="help" title={t('tour.helpTitle')} onClick={startTour}>
        <span className="tour-help-mark" aria-hidden="true">?</span>
        <span className="tour-help-text">{t('tour.help')}</span>
      </button>
    </header>
  )
}
