import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { Icon, type IconName } from './ui'

type Toast = { id: number; message: string; kind: 'success' | 'error' | 'info' }

const ToastContext = createContext<(message: string, kind?: Toast['kind']) => void>(() => {})

const styles: Record<Toast['kind'], { icon: IconName; className: string }> = {
  success: { icon: 'check', className: 'text-emerald-300' },
  error: { icon: 'alert', className: 'text-rose-300' },
  info: { icon: 'sparkle', className: 'text-fuchsia-300' },
}

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const show = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    const id = nextId++
    setToasts((list) => [...list.slice(-2), { id, message, kind }])
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3800)
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex max-w-sm animate-toast items-center gap-3 rounded-2xl bg-zinc-900/90 px-4 py-3 text-sm font-medium shadow-2xl shadow-black/50 ring-1 ring-white/10 backdrop-blur-xl"
          >
            <Icon name={styles[t.kind].icon} className={`size-4 shrink-0 ${styles[t.kind].className}`} />
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
