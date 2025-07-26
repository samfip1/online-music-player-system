import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { shareSpace } from '../../lib/share'
import { useToast } from '../toast'
import { Button, Dialog, Icon, LogoMark } from '../ui'

function useQrSvg(text: string) {
  const [svg, setSvg] = useState<string | null>(null)
  useEffect(() => {
    // Dark modules on white: the most reliable contrast for phone cameras.
    void QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0a0a12', light: '#ffffff' } }).then(setSvg)
  }, [text])
  return svg
}

export function InviteButton({ space }: { space: { id: string; name: string } }) {
  const [open, setOpen] = useState(false)
  const [bigScreen, setBigScreen] = useState(false)
  const toast = useToast()
  const url = `${location.origin}/space/${space.id}`
  const svg = useQrSvg(url)

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Icon name="qr" className="size-4" /> <span className="hidden sm:inline">Invite</span>
      </Button>

      <Dialog open={open && !bigScreen} onClose={() => setOpen(false)} title="Invite people">
        <p className="-mt-2 mb-4 text-sm text-zinc-400">Scan to join “{space.name}”. No app or account needed.</p>
        <div className="mx-auto w-full max-w-64 rounded-2xl bg-white p-3 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg ?? '' }} />
        <div className="mt-4 flex items-center gap-2 rounded-2xl bg-black/30 p-1.5 pl-4 ring-1 ring-white/10">
          <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">{url.replace(/^https?:\/\//, '')}</span>
          <Button size="sm" onClick={() => void shareSpace(space, toast)}>
            <Icon name="link" className="size-4" /> Copy
          </Button>
        </div>
        <Button variant="ghost" className="mt-3 w-full" onClick={() => setBigScreen(true)}>
          Show on big screen
        </Button>
      </Dialog>

      {bigScreen ? (
        <div
          role="dialog"
          aria-label="Invite QR code"
          className="fixed inset-0 z-50 grid animate-rise place-items-center bg-ink/95 p-6 backdrop-blur-xl"
          onClick={() => setBigScreen(false)}
          onKeyDown={(e) => e.key === 'Escape' && setBigScreen(false)}
          tabIndex={-1}
          ref={(el) => el?.focus()}
        >
          <div className="flex flex-col items-center text-center">
            <div className="flex items-center gap-3">
              <LogoMark className="size-10" />
              <span className="font-display text-2xl font-bold">SonicVote</span>
            </div>
            <h2 className="mt-6 font-display text-4xl font-extrabold tracking-tight text-balance sm:text-6xl">{space.name}</h2>
            <p className="mt-3 text-lg text-zinc-400">Scan to add songs and vote on what plays next</p>
            <div
              className="mt-8 w-[min(70vh,80vw)] rounded-3xl bg-white p-5 shadow-2xl shadow-fuchsia-500/20 [&>svg]:h-auto [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: svg ?? '' }}
            />
            <p className="mt-6 text-sm text-zinc-500">Tap anywhere to close</p>
          </div>
        </div>
      ) : null}
    </>
  )
}
