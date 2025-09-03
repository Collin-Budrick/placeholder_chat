import { useEffect, useState } from '@lynx-js/react'
import './App.css'
import { Header, type Route } from './components/Header'
import { HomePage } from './pages/Home'
import { AboutPage } from './pages/About'
import { ContactPage } from './pages/Contact'
import { LoginPage } from './pages/Login'
import { SignupPage } from './pages/Signup'
import { sharedVersion, ping } from '@stack/shared'

export function App() {
  const [route, setRoute] = useState<Route>('home')
  const [authed, setAuthed] = useState(false)

  useEffect(() => {
    console.info('Lynx app boot')
    ping().then((res) => {
      console.info('[shared] version', sharedVersion, 'health', res)
    }).catch(() => {})
  }, [])

  return (
    <view className='Root'>
      <Header route={route} onNavigate={setRoute} authed={authed} />
      <view className='Main'>
        {route === 'home' && <HomePage />}
        {route === 'about' && <AboutPage />}
        {route === 'contact' && <ContactPage />}
        {route === 'login' && <LoginPage onSuccess={() => { setAuthed(true); setRoute('profile') }} />}
        {route === 'signup' && <SignupPage onSuccess={() => { setAuthed(true); setRoute('profile') }} />}
        {route === 'profile' && (
          <view className='Page'>
            <text className='Title'>Profile</text>
            <text className='Body'>Welcome! This is your account area.</text>
            <view className='Button' bindtap={() => { 'background only'; setAuthed(false); setRoute('home') }}><text>Sign out</text></view>
          </view>
        )}
      </view>
    </view>
  )
}
