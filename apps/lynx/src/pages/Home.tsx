import { useCallback, useEffect, useState } from '@lynx-js/react'
import { ping, sharedVersion } from '@stack/shared'

export function HomePage() {
  const [health, setHealth] = useState<string>('unknown')
  const [last, setLast] = useState<string>('')

  const refresh = useCallback(() => {
    'background only'
    ping().then((res) => {
      setHealth(res.ok ? 'ok' : `error: ${res.error ?? 'unknown'}`)
      setLast(new Date().toLocaleTimeString())
    }).catch((e) => {
      setHealth(`error: ${String(e)}`)
      setLast(new Date().toLocaleTimeString())
    })
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <view className='Page Page--home'>
      <text className='Title'>Welcome to Qwik</text>
      <text className='Subtitle'>Delightful motion • OLED-first • Performance by default</text>
      <view className='Card'>
        <text className='CardTitle'>Delightful motion</text>
        <text className='Body'>Subtle, tasteful animations that respect reduced motion.</text>
      </view>
      <view className='Card'>
        <text className='CardTitle'>OLED-first design</text>
        <text className='Body'>Pure black backgrounds, high contrast text, soft accents.</text>
      </view>
      <view className='Card'>
        <text className='CardTitle'>Performance by default</text>
        <text className='Body'>Qwik islands, lazy imports, and worker offloading.</text>
      </view>
      <view className='Card'>
        <text className='CardTitle'>Gateway health</text>
        <text>shared v{sharedVersion}</text>
        <text>Status: {health}</text>
        {last && <text>Checked: {last}</text>}
        <view className='Button' bindtap={refresh}><text>Refresh</text></view>
      </view>
    </view>
  )
}
