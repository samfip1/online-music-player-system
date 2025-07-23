import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api, type Me, type Plan, type PlanPrices } from '../lib/api'
import { useToast } from './toast'
import { Button, Icon } from './ui'

type RazorpayResponse = { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }
type RazorpayOptions = {
  key: string
  subscription_id: string
  name: string
  description: string
  image?: string
  prefill?: { name?: string; email?: string | null }
  theme?: { color: string }
  handler: (response: RazorpayResponse) => void
  modal?: { ondismiss?: () => void }
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => {
      open: () => void
      on: (event: 'payment.failed', cb: (r: { error: { description?: string } }) => void) => void
    }
  }
}

let checkoutScript: Promise<void> | null = null
function loadCheckout() {
  checkoutScript ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.onload = () => resolve()
    script.onerror = () => {
      checkoutScript = null
      reject(new Error('Could not load Razorpay'))
    }
    document.head.append(script)
  })
  return checkoutScript
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Both plans' monthly prices, read from Razorpay by the server. */
export function usePlanPrices(enabled: boolean) {
  return useQuery({ queryKey: ['plans'], queryFn: () => api<PlanPrices>('/billing/plans'), enabled, staleTime: 10 * 60_000 })
}

const planNames: Record<Plan, string> = { pro: 'Pro', pro_host: 'Pro Host' }

/** Opens Razorpay Checkout for a monthly plan. The server confirms the payment before the plan turns on. */
export function UpgradeButton({
  plan = 'pro',
  size = 'md',
  className = '',
  label,
}: {
  plan?: Plan
  size?: 'sm' | 'md' | 'lg'
  className?: string
  label?: string
}) {
  const toast = useToast()
  const queryClient = useQueryClient()

  const verify = async (response: RazorpayResponse) => {
    // The first charge can take a few seconds to settle; ask a few times, then leave it to the webhook.
    for (let attempt = 0; attempt < 4; attempt++) {
      const result = await api<{ active: boolean }>('/billing/verify', { method: 'POST', body: response }).catch(() => ({ active: false }))
      if (result.active) {
        await queryClient.invalidateQueries({ queryKey: ['me'] })
        await queryClient.invalidateQueries({ queryKey: ['insights'] })
        toast(plan === 'pro_host' ? "You're Pro Host now. Your insights are unlocked!" : "You're Pro now. Enjoy the shorter cooldown!", 'success')
        return
      }
      await wait(3000)
    }
    // Razorpay sometimes activates a minute or two later: /me now reports a pending payment,
    // and usePendingPaymentSync (in the top bar) keeps checking until it switches on.
    await queryClient.invalidateQueries({ queryKey: ['me'] })
    toast('Payment received. Your plan switches on as soon as Razorpay confirms it.', 'info')
  }

  const checkout = useMutation({
    mutationFn: async () => {
      const [order] = await Promise.all([
        api<{ keyId: string; subscriptionId: string; name: string; email: string | null }>('/billing/checkout', { method: 'POST', body: { plan } }),
        loadCheckout(),
      ])
      let paid = false
      const checkout = new window.Razorpay!({
        key: order.keyId,
        subscription_id: order.subscriptionId,
        name: `SonicVote ${planNames[plan]}`,
        description: plan === 'pro_host' ? 'Monthly · everything in Pro + host insights' : 'Monthly · 4-min cooldown, Pro badge, downvote protection',
        image: `${location.origin}/favicon.svg`,
        prefill: { name: order.name, email: order.email },
        theme: { color: '#a21caf' },
        handler: (response) => {
          paid = true
          void verify(response)
        },
        // Closed without a successful payment (or the subscription's mandate wasn't set up): say so instead of doing nothing.
        modal: { ondismiss: () => !paid && toast('Payment not completed. You have not been charged for Pro.', 'info') },
      })
      checkout.on('payment.failed', (r) => toast(`Payment failed: ${r.error.description ?? 'please try again'}`, 'error'))
      checkout.open()
    },
    onError: (err) => toast(err.message, 'error'),
  })

  return (
    <Button size={size} className={className} loading={checkout.isPending} onClick={() => checkout.mutate()}>
      <Icon name={plan === 'pro_host' ? 'chart' : 'crown'} className="size-4" />
      {label ?? `Go ${planNames[plan]}`}
    </Button>
  )
}

export function CancelProButton() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const cancel = useMutation({
    mutationFn: () => api('/billing/cancel', { method: 'POST' }),
    onSuccess: () => {
      toast('Renewal cancelled. Pro stays until the end of the month you paid for.', 'success')
      return queryClient.invalidateQueries({ queryKey: ['me'] })
    },
    onError: (err) => toast(err.message, 'error'),
  })
  return (
    <Button variant="ghost" size="sm" loading={cancel.isPending} onClick={() => cancel.mutate()}>
      Cancel renewal
    </Button>
  )
}

const SYNC_EVERY_MS = 10_000
const SYNC_FOR_MS = 3 * 60_000

/**
 * While a checkout is waiting for Razorpay, ask the server to check (it asks Razorpay directly).
 * A backup for the webhook: right away, then every 10s for up to 3 minutes, and again on each page load.
 */
export function usePendingPaymentSync(me: Me | undefined) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const pending = Boolean(me?.pendingPayment)

  useEffect(() => {
    if (!pending) return
    const startedAt = Date.now()
    let stopped = false
    const check = async () => {
      const result = await api<{ pending: boolean; active: boolean; proPlan: Plan | null }>('/billing/sync', { method: 'POST' }).catch(() => null)
      if (stopped || !result) return
      if (!result.pending) {
        stopped = true
        clearInterval(timer)
        await queryClient.invalidateQueries({ queryKey: ['me'] })
        await queryClient.invalidateQueries({ queryKey: ['insights'] })
        if (result.active) toast(result.proPlan === 'pro_host' ? "You're Pro Host now. Your insights are unlocked!" : "You're Pro now!", 'success')
      } else if (Date.now() - startedAt > SYNC_FOR_MS) {
        clearInterval(timer)
      }
    }
    const timer = setInterval(() => void check(), SYNC_EVERY_MS)
    void check()
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [pending, queryClient, toast])
}
