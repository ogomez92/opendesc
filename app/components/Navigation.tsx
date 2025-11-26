import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Settings, Volume2, FileText, Captions, Link2 } from 'lucide-react';

export function Navigation() {
  const { t } = useTranslation();

  return (
    <header className="border-b bg-background">
      <div className="container mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Volume2 className="h-6 w-6" aria-hidden="true" />
            <span className="text-xl font-bold">{t('app.title')}</span>
          </div>

          <nav role="navigation" aria-label="Main navigation">
            <ul className="flex items-center gap-6">
              <li>
                <NavLink
                  to="/"
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-2 rounded-md transition-colors ${
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-accent'
                    }`
                  }
                  aria-current={({ isActive }) => (isActive ? 'page' : undefined)}
                >
                  <Volume2 className="h-4 w-4" aria-hidden="true" />
                  {t('nav.readConvert')}
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/convert-subtitles"
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-2 rounded-md transition-colors ${
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-accent'
                    }`
                  }
                  aria-current={({ isActive }) => (isActive ? 'page' : undefined)}
                >
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  {t('nav.convertSubtitles')}
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/align"
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-2 rounded-md transition-colors ${
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-accent'
                    }`
                  }
                  aria-current={({ isActive }) => (isActive ? 'page' : undefined)}
                >
                  <Link2 className="h-4 w-4" aria-hidden="true" />
                  {t('nav.align')}
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/subtitle-creation"
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-2 rounded-md transition-colors ${
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-accent'
                    }`
                  }
                  aria-current={({ isActive }) => (isActive ? 'page' : undefined)}
                >
                  <Captions className="h-4 w-4" aria-hidden="true" />
                  {t('nav.subtitleCreation')}
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/settings"
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-2 rounded-md transition-colors ${
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-accent'
                    }`
                  }
                  aria-current={({ isActive }) => (isActive ? 'page' : undefined)}
                >
                  <Settings className="h-4 w-4" aria-hidden="true" />
                  {t('nav.settings')}
                </NavLink>
              </li>
            </ul>
          </nav>
        </div>
      </div>
    </header>
  );
}
