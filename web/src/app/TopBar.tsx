import { LANGS, useT } from '../i18n'
import { useStore } from '../store'

export function TopBar() {
  const t = useT()
  const lang = useStore((s) => s.lang)
  const setLang = useStore((s) => s.setLang)

  return (
    <header className="topbar">
      <a className="topbar-name" href="#/" title={t('nav.home')}>
        {t('app.name')}
      </a>
      <div className="topbar-lang" role="group" aria-label={t('lang.switch')}>
        {LANGS.map((l) => (
          <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>
    </header>
  )
}
