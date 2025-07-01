import { useState, useEffect } from 'react'
import { LanguageSwitcher } from './LanguageSwitcher'
import { DarkModeToggle } from './DarkModeToggle'
import logoImg from '../assets/images/logo-small.png'

interface TitleBarProps {
  appVersion?: string
}

export function TitleBar({ appVersion }: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    const checkMaximized = async () => {
      const maximized = await window.api.isWindowMaximized()
      setIsMaximized(maximized)
    }

    checkMaximized()

    // Check when window state changes
    const interval = setInterval(checkMaximized, 100)
    return () => clearInterval(interval)
  }, [])

  const handleMinimize = () => {
    window.api.minimizeWindow()
  }

  const handleMaximize = () => {
    window.api.maximizeWindow()
  }

  const handleClose = () => {
    window.api.closeWindow()
  }

  return (
    <div className="fixed top-0 left-0 right-0 h-10 bg-white dark:bg-charcoal-900 border-b-2 border-charcoal-200 dark:border-charcoal-800 flex items-center justify-between select-none z-50 shadow-md dark:shadow-none">
      <div
        className="flex-1 h-full flex items-center px-6"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2">
          <img src={logoImg} alt="Bocchi" className="w-5 h-5 object-contain" />
          <div className="flex items-baseline gap-2">
            <div className="text-sm font-bold text-charcoal-900 dark:text-charcoal-100 tracking-wide">
              Bocchi
            </div>
            {appVersion && (
              <div className="text-xs text-charcoal-500 dark:text-charcoal-500">v{appVersion}</div>
            )}
          </div>
        </div>
      </div>
      <div
        className="flex items-center gap-2 px-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <DarkModeToggle />
        <LanguageSwitcher />
      </div>
      <div className="flex" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          className="w-11 h-10 flex items-center justify-center hover:bg-charcoal-100 dark:hover:bg-charcoal-800 transition-all duration-200 group"
          onClick={handleMinimize}
          aria-label="Minimize"
        >
          <div className="w-3 h-[1.5px] bg-charcoal-400 dark:bg-charcoal-500 group-hover:bg-charcoal-600 dark:group-hover:bg-charcoal-300 transition-colors"></div>
        </button>
        <button
          className="w-11 h-10 flex items-center justify-center hover:bg-charcoal-100 dark:hover:bg-charcoal-800 transition-all duration-200 group"
          onClick={handleMaximize}
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
        >
          <div
            className={`${isMaximized ? 'w-2.5 h-2.5 border-[1.5px] border-charcoal-400 dark:border-charcoal-500 group-hover:border-charcoal-600 dark:group-hover:border-charcoal-300' : 'w-3 h-3 border-[1.5px] border-charcoal-400 dark:border-charcoal-500 group-hover:border-charcoal-600 dark:group-hover:border-charcoal-300'} transition-colors rounded-[1px]`}
          ></div>
        </button>
        <button
          className="w-11 h-10 flex items-center justify-center hover:bg-red-50 dark:hover:bg-red-900/20 transition-all duration-200 group"
          onClick={handleClose}
          aria-label="Close"
        >
          <svg
            className="w-3.5 h-3.5 text-charcoal-400 dark:text-charcoal-500 group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors"
            viewBox="0 0 12 12"
          >
            <path d="M1 1L11 11M1 11L11 1" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        </button>
      </div>
    </div>
  )
}
