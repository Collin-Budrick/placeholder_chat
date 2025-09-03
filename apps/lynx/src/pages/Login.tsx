import { useCallback, useState } from '@lynx-js/react'
import { login } from '@stack/shared'

export function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = useCallback(() => {
    'background only'
    if (busy) return
    setBusy(true)
    setErr(null)
    login({ email, password }).then((res) => {
      if (res.ok) onSuccess()
      else setErr(res.error || 'Login failed')
    }).catch((e) => setErr(String(e))).finally(() => setBusy(false))
  }, [busy, email, password, onSuccess])

  return (
    <view className='Page'>
      <text className='Title'>Log in</text>
      {err && <text className='Error'>{err}</text>}
      <view className='FormField'>
        <text>Email</text>
        <input value={email} placeholder='you@example.com' bindinput={(e: any) => setEmail(e.detail?.value ?? e.target?.value ?? '')} />
      </view>
      <view className='FormField'>
        <text>Password</text>
        <input value={password} placeholder='••••••••' password bindinput={(e: any) => setPassword(e.detail?.value ?? e.target?.value ?? '')} />
      </view>
      <view className='Button' aria-busy={busy ? 'true' : undefined} bindtap={submit}><text>{busy ? 'Signing in…' : 'Login'}</text></view>
    </view>
  )
}

