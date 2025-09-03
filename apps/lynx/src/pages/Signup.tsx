import { useCallback, useState } from '@lynx-js/react'
import { checkUsername, signup } from '@stack/shared'

export function SignupPage({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [availability, setAvailability] = useState<'unknown'|'checking'|'ok'|'taken'|'later'>('unknown')

  const onUserBlur = useCallback(() => {
    'background only'
    const u = username.trim()
    if (!u || u.length < 2) { setAvailability('unknown'); return }
    setAvailability('checking')
    checkUsername(u).then((r) => {
      if (!r.ok) { setAvailability('later'); return }
      setAvailability(r.data?.available ? 'ok' : 'taken')
    }).catch(() => setAvailability('later'))
  }, [username])

  const submit = useCallback(() => {
    'background only'
    if (busy) return
    setBusy(true)
    setErr(null)
    signup({ username, email, password }).then((res) => {
      if (res.ok) onSuccess()
      else setErr(res.error || 'Signup failed')
    }).catch((e) => setErr(String(e))).finally(() => setBusy(false))
  }, [busy, username, email, password, onSuccess])

  return (
    <view className='Page'>
      <text className='Title'>Sign Up</text>
      {err && <text className='Error'>{err}</text>}
      <view className='FormField'>
        <text>Username</text>
        <input value={username} placeholder='Your name' bindinput={(e: any) => setUsername(e.detail?.value ?? e.target?.value ?? '')} bindblur={onUserBlur} />
        {availability === 'checking' && <text className='Hint'>Checking availability…</text>}
        {availability === 'ok' && <text className='Hint'>Available</text>}
        {availability === 'taken' && <text className='Error'>Username taken</text>}
        {availability === 'later' && <text className='Hint'>Try again later</text>}
      </view>
      <view className='FormField'>
        <text>Email</text>
        <input value={email} placeholder='you@example.com' bindinput={(e: any) => setEmail(e.detail?.value ?? e.target?.value ?? '')} />
      </view>
      <view className='FormField'>
        <text>Password</text>
        <input value={password} placeholder='Create a password' password bindinput={(e: any) => setPassword(e.detail?.value ?? e.target?.value ?? '')} />
      </view>
      <view className='Button' aria-busy={busy ? 'true' : undefined} bindtap={submit}><text>{busy ? 'Creating…' : 'Create account'}</text></view>
    </view>
  )
}

