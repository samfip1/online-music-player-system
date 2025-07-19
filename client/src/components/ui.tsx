import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Link } from 'react-router'

// ---- Icons (inline, 24px grid, stroke-based) ----

const paths = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4.35-4.35',
  plus: 'M12 5v14M5 12h14',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  up: 'm6 14 6-6 6 6',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
  skip: 'M6 5v14l10-7L6 5Zm12 0v14',
  play: 'M7 4.5v15l12.5-7.5L7 4.5Z',
  pause: 'M8 5v14M16 5v14',
  share: 'M12 3v12M7.5 7.5 12 3l4.5 4.5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6',
  link: 'M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L12 5.6M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10',
  x: 'M6 6l12 12M18 6 6 18',
  music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  crown: 'm3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8Z',
  volume: 'M11 5 6 9H3v6h3l5 4V5Zm4.5 3.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  home: 'M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8Z',
  host: 'M12 3a4 4 0 0 1 4 4v4a4 4 0 0 1-8 0V7a4 4 0 0 1 4-4Zm-7 8a7 7 0 0 0 14 0M12 18v3',
  alert: 'M12 8v5m0 3.5v.01M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  clock: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  users: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm10 9v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.1a3.5 3.5 0 0 1 0 6.8',
  sparkle: 'M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6',
  down: 'm6 10 6 6 6-6',
  shield: 'M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2h-2z',
  sliders: 'M4 6h9m4 0h3M4 12h3m4 0h9M4 18h11m4 0h1M15 4v4M9 10v4M17 16v4',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  ban: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM5.6 5.6l12.8 12.8',
} as const

export type IconName = keyof typeof paths

export function Icon({ name, className = 'size-5', strokeWidth = 2 }: { name: IconName; className?: string; strokeWidth?: number }) {
  const filled = name === 'play'
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={paths[name]} />
    </svg>
  )
}

// ---- Brand ----

export function LogoMark({ className = 'size-8' }: { className?: string }) {
  return <img src="/favicon.svg" alt="" className={`${className} rounded-[28%] shadow-lg shadow-fuchsia-500/20`} />
}

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2.5 rounded-lg">
      <LogoMark />
      <span className="font-display text-lg font-bold tracking-tight">SonicVote</span>
    </Link>
  )
}

// ---- Buttons ----

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}

const variants = {
  primary: 'bg-brand text-white shadow-lg shadow-fuchsia-600/25 hover:brightness-110 active:brightness-95',
  secondary: 'bg-white/[0.07] text-zinc-100 ring-1 ring-inset ring-white/10 hover:bg-white/[0.12]',
  ghost: 'text-zinc-300 hover:bg-white/[0.07] hover:text-white',
  danger: 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-400/25 hover:bg-rose-500/25',
}
const sizes = { sm: 'h-8 px-3 text-sm gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-12 px-6 text-base gap-2.5' }

export function buttonClass(variant: ButtonProps['variant'] = 'primary', size: ButtonProps['size'] = 'md') {
  return `inline-flex shrink-0 items-center justify-center rounded-full font-semibold transition disabled:pointer-events-none disabled:opacity-45 ${variants[variant]} ${sizes[size]}`
}

export function Button({ variant, size, loading, className = '', children, disabled, ...rest }: ButtonProps) {
  return (
    <button className={`${buttonClass(variant, size)} ${className}`} disabled={disabled || loading} {...rest}>
      {loading ? <Spinner className="size-4" /> : null}
      {children}
    </button>
  )
}

export function IconButton({ icon, label, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={`grid size-9 shrink-0 place-items-center rounded-full text-zinc-400 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-40 ${className}`}
      {...rest}
    >
      <Icon name={icon} className="size-[18px]" />
    </button>
  )
}

// ---- Bits ----

export function Spinner({ className = 'size-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} animate-spin`} fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function Equalizer({ className = 'h-4', bars = 4, playing = true }: { className?: string; bars?: number; playing?: boolean }) {
  return (
    <span className={`inline-flex items-end gap-[3px] ${className}`} aria-hidden>
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className={`h-full w-[3px] origin-bottom rounded-full bg-current ${playing ? 'animate-eq' : 'scale-y-[0.3]'}`}
          style={{ animationDelay: `${[-0.2, -0.65, -0.4, -0.9, -0.1][i % 5]}s`, animationDuration: `${0.8 + (i % 3) * 0.25}s` }}
        />
      ))}
    </span>
  )
}

export function ProBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-gradient-to-r from-amber-300 to-orange-400 px-1.5 py-px text-[10px] font-extrabold tracking-wider text-amber-950 ${className}`}
      title="Pro member"
    >
      PRO
    </span>
  )
}

const avatarColors = ['from-violet-500 to-fuchsia-500', 'from-sky-500 to-indigo-500', 'from-emerald-500 to-teal-500', 'from-orange-400 to-rose-500', 'from-pink-500 to-purple-500']

export function Avatar({ name, url, className = 'size-8' }: { name: string; url?: string | null; className?: string }) {
  if (url) return <img src={url} alt="" className={`${className} shrink-0 rounded-full object-cover ring-1 ring-white/10`} />
  const color = avatarColors[[...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % avatarColors.length]
  return (
    <span className={`${className} grid shrink-0 place-items-center rounded-full bg-gradient-to-br ${color} text-[0.8em] font-bold uppercase text-white`} aria-hidden>
      {name.trim()[0] ?? '?'}
    </span>
  )
}

export function AlbumArt({ url, className = 'size-12', rounded = 'rounded-lg' }: { url: string | null; className?: string; rounded?: string }) {
  if (url) return <img src={url} alt="" loading="lazy" className={`${className} ${rounded} shrink-0 bg-white/5 object-cover`} />
  return (
    <span className={`${className} ${rounded} grid shrink-0 place-items-center bg-white/[0.06] text-zinc-500`}>
      <Icon name="music" className="size-1/2" />
    </span>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`glass rounded-3xl ${className}`}>{children}</section>
}

export function FullScreenMessage({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="max-w-md animate-rise text-center">
        <span className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-white/[0.06] text-fuchsia-300 ring-1 ring-white/10">
          <Icon name={icon} className="size-7" />
        </span>
        <h1 className="font-display text-2xl font-bold">{title}</h1>
        <div className="mt-3 text-zinc-400">{children}</div>
      </div>
    </div>
  )
}

export function PageLoader() {
  return (
    <div className="grid min-h-dvh place-items-center text-fuchsia-300">
      <Equalizer className="h-8" bars={5} />
    </div>
  )
}

/** Soft colour glows behind every page. */
export function Backdrop({ imageUrl }: { imageUrl?: string | null }) {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      {imageUrl ? (
        <img src={imageUrl} alt="" className="absolute -top-1/4 left-1/2 w-[140%] max-w-none -translate-x-1/2 opacity-25 blur-[100px] saturate-150 transition-opacity duration-1000" />
      ) : null}
      <div className="absolute -top-40 -left-32 size-[34rem] rounded-full bg-violet-700/25 blur-[120px]" />
      <div className="absolute top-1/3 -right-40 size-[30rem] rounded-full bg-fuchsia-600/15 blur-[120px]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_0%,var(--color-ink)_75%)]" />
    </div>
  )
}

/** Modal built on the native <dialog>: focus trapping, Escape to close and the backdrop come from the browser. */
export function Dialog({ open, onClose, title, children, className = 'max-w-md' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()} // click on the backdrop
      className={`m-auto w-[calc(100%-2rem)] ${className} rounded-3xl bg-zinc-900/95 p-0 text-zinc-100 shadow-2xl shadow-black/60 ring-1 ring-white/10 backdrop:bg-black/70 backdrop:backdrop-blur-sm`}
    >
      {open ? (
        <div className="animate-rise p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-display text-xl font-bold">{title}</h2>
            <IconButton icon="x" label="Close" onClick={onClose} />
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  )
}
