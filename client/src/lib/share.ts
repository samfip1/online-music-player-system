/** Uses the phone's share sheet when there is one, otherwise copies the invite link. */
export async function shareSpace(space: { id: string; name: string }, toast: (message: string, kind?: 'success' | 'error') => void) {
  const url = `${location.origin}/space/${space.id}`
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title: `Join “${space.name}” on SonicVote`, text: 'Add songs and vote on what plays next', url })
      return
    } catch {
      // Share sheet closed: fall back to copying.
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    toast('Invite link copied', 'success')
  } catch {
    toast(url, 'success')
  }
}
