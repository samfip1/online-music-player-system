import { Link, useSearchParams } from 'react-router'
import { spotifyLoginUrl } from '../lib/api'
import { useMe } from '../lib/hooks'
import { TopBar } from '../components/TopBar'
import { Backdrop, buttonClass, Equalizer, Icon, ProBadge, type IconName } from '../components/ui'

const errors: Record<string, string> = {
  not_registered:
    "This Spotify account isn't on the app's tester list yet. The app is in Spotify's development mode, so the owner has to add your Spotify email in the Spotify dashboard first.",
  login_failed: "Spotify login didn't finish. Please try again.",
}

export function Landing() {
  const me = useMe()
  const [params] = useSearchParams()
  const error = params.get('error')
  const canHost = me.data && !me.data.isGuest

  return (
    <>
      <Backdrop />
      <TopBar me={me.data}>
        {canHost ? (
          <Link to="/home" className={buttonClass('secondary', 'sm')}>
            Your spaces
          </Link>
        ) : null}
      </TopBar>

      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        {error ? (
          <div role="alert" className="mt-6 flex animate-rise items-start gap-3 rounded-2xl bg-rose-500/10 p-4 text-sm text-rose-200 ring-1 ring-rose-400/20">
            <Icon name="alert" className="mt-0.5 size-5 shrink-0" />
            <p>{errors[error] ?? errors.login_failed}</p>
          </div>
        ) : null}

        <section className="grid grid-cols-1 items-center gap-14 py-14 sm:py-20 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:py-28 [&>*]:min-w-0">
          <div className="animate-rise">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-3 py-1 text-xs font-medium text-zinc-300 ring-1 ring-white/10">
              <Equalizer className="h-3 text-fuchsia-400" bars={3} /> Live, collaborative queues
            </p>
            <h1 className="font-display text-5xl leading-[1.02] font-extrabold tracking-tight text-balance sm:text-6xl lg:text-7xl">
              The crowd picks <span className="text-gradient">the next song.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-pretty text-zinc-400">
              Host a room from your Spotify, share the link, and let everyone search, add and vote. The most-voted track plays next, and every
              change shows up live for everyone.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              {canHost ? (
                <Link to="/home" className={buttonClass('primary', 'lg')}>
                  Open your spaces <Icon name="arrowRight" className="size-5" />
                </Link>
              ) : (
                <a href={spotifyLoginUrl('/home')} className={buttonClass('primary', 'lg')}>
                  <SpotifyGlyph /> Host with Spotify
                </a>
              )}
              <span className="text-sm text-zinc-500">Joining a friend? Just open their link.</span>
            </div>
          </div>

          <DemoQueue />
        </section>

        <section className="grid gap-4 pb-20 sm:grid-cols-3">
          <Step icon="host" title="Host" text="Log in with Spotify Premium and create a space. Your browser becomes the speaker." />
          <Step icon="share" title="Share" text="Send the link. Friends join with just a nickname, no Spotify account needed." />
          <Step icon="up" title="Vote" text="Everyone gets 5 votes, then a short cooldown. The top song always plays next." />
        </section>
      </main>

      <footer className="border-t border-line py-8 text-center text-xs text-zinc-500">
        Playback needs Spotify Premium for the host. Listeners only need the link.
      </footer>
    </>
  )
}

function Step({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <div className="glass rounded-3xl p-6">
      <span className="grid size-11 place-items-center rounded-2xl bg-brand text-white shadow-lg shadow-fuchsia-600/25">
        <Icon name={icon} className="size-5" />
      </span>
      <h3 className="mt-5 font-display text-xl font-bold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-400">{text}</p>
    </div>
  )
}

const demoSongs = [
  { title: 'Midnight City', artist: 'M83', votes: 7, voted: true, color: 'from-sky-500 to-indigo-600', by: 'Ria', pro: true },
  { title: 'Get Lucky', artist: 'Daft Punk, Pharrell Williams', votes: 5, voted: false, color: 'from-amber-400 to-rose-500', by: 'Kabir' },
  { title: 'Electric Feel', artist: 'MGMT', votes: 2, voted: false, color: 'from-emerald-400 to-teal-600', by: 'Sam' },
]

/** A static illustration of the app for the landing page. */
function DemoQueue() {
  return (
    <div className="relative animate-rise [animation-delay:120ms]" aria-hidden>
      <div className="absolute -inset-y-6 inset-x-0 -z-10 rounded-[2.5rem] bg-brand opacity-20 blur-3xl sm:-inset-6" />
      <div className="glass rounded-[2rem] p-5 shadow-2xl shadow-black/50 sm:p-6">
        <div className="flex items-center gap-4 rounded-2xl bg-white/[0.04] p-3">
          <div className="grid size-16 place-items-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-violet-700 text-white shadow-lg">
            <Equalizer className="h-6" bars={4} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold tracking-widest text-fuchsia-300 uppercase">Now playing</p>
            <p className="truncate font-display text-lg font-bold">Blinding Lights</p>
            <p className="truncate text-sm text-zinc-400">The Weeknd</p>
          </div>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-2/5 rounded-full bg-brand" />
        </div>

        <p className="mt-6 mb-2 px-1 text-xs font-semibold tracking-widest text-zinc-500 uppercase">Up next</p>
        <ul className="space-y-1.5">
          {demoSongs.map((s, i) => (
            <li key={s.title} className={`flex items-center gap-3 rounded-2xl p-2.5 ${i === 0 ? 'bg-white/[0.05] ring-1 ring-white/10' : ''}`}>
              <span className="w-4 text-center text-sm font-semibold text-zinc-500 tabular-nums">{i + 1}</span>
              <span className={`size-11 shrink-0 rounded-lg bg-gradient-to-br ${s.color}`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{s.title}</p>
                <p className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <span className="min-w-0 truncate">
                    {s.artist} · {s.by}
                  </span>
                  {s.pro ? <ProBadge /> : null}
                </p>
              </div>
              <span
                className={`flex h-9 items-center gap-1 rounded-full px-3 text-sm font-bold tabular-nums ${
                  s.voted ? 'bg-brand text-white shadow-lg shadow-fuchsia-600/30' : 'bg-white/[0.07] text-zinc-300 ring-1 ring-white/10'
                }`}
              >
                <Icon name="up" className="size-4" strokeWidth={2.5} /> {s.votes}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex items-center justify-between rounded-2xl bg-white/[0.04] px-4 py-3 text-sm">
          <span className="text-zinc-400">Your votes</span>
          <span className="flex items-center gap-1.5">
            {[0, 1, 2, 3, 4].map((n) => (
              <span key={n} className={`h-2 w-5 rounded-full ${n < 3 ? 'bg-brand' : 'bg-white/10'}`} />
            ))}
            <span className="ml-2 font-semibold tabular-nums">3/5</span>
          </span>
        </div>
      </div>
    </div>
  )
}

function SpotifyGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.6 14.4a.62.62 0 0 1-.86.2c-2.35-1.43-5.3-1.76-8.79-.96a.62.62 0 1 1-.28-1.22c3.81-.87 7.08-.5 9.72 1.12.3.18.39.57.2.86Zm1.22-2.72a.78.78 0 0 1-1.07.26c-2.69-1.65-6.79-2.13-9.97-1.17a.78.78 0 1 1-.45-1.5c3.63-1.1 8.15-.57 11.23 1.33.37.22.48.7.26 1.08Zm.1-2.83C14.7 8.94 9.38 8.76 6.3 9.7a.94.94 0 1 1-.54-1.8c3.53-1.07 9.4-.86 13.1 1.34a.94.94 0 0 1-.95 1.61Z" />
    </svg>
  )
}
