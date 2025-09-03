import { useCallback } from '@lynx-js/react'

export type Route = 'home' | 'about' | 'contact' | 'login' | 'signup' | 'profile'

export function Header({ route, onNavigate, authed }: { route: Route; onNavigate: (r: Route) => void; authed?: boolean }) {
  const goHome = useCallback(() => { 'background only'; onNavigate('home') }, [onNavigate])
  const goAbout = useCallback(() => { 'background only'; onNavigate('about') }, [onNavigate])
  const goContact = useCallback(() => { 'background only'; onNavigate('contact') }, [onNavigate])
  const goLogin = useCallback(() => { 'background only'; onNavigate('login') }, [onNavigate])
  const goSignup = useCallback(() => { 'background only'; onNavigate('signup') }, [onNavigate])
  const goProfile = useCallback(() => { 'background only'; onNavigate('profile') }, [onNavigate])

  return (
    <view className='Header'>
      <view className='Nav'>
        <view className={`NavItem ${route === 'home' ? 'NavItem--active' : ''}`} bindtap={goHome}>
          <text>Home</text>
        </view>
        <view className={`NavItem ${route === 'about' ? 'NavItem--active' : ''}`} bindtap={goAbout}>
          <text>About</text>
        </view>
        <view className={`NavItem ${route === 'contact' ? 'NavItem--active' : ''}`} bindtap={goContact}>
          <text>Contact</text>
        </view>
        <view className='NavItemSpacer' style={{ flex: 1 }} />
        {authed ? (
          <view className={`NavItem ${route === 'profile' ? 'NavItem--active' : ''}`} bindtap={goProfile}><text>Profile</text></view>
        ) : (
          <>
            <view className={`NavItem ${route === 'login' ? 'NavItem--active' : ''}`} bindtap={goLogin}><text>Login</text></view>
            <view className={`NavItem ${route === 'signup' ? 'NavItem--active' : ''}`} bindtap={goSignup}><text>Sign up</text></view>
          </>
        )}
      </view>
    </view>
  )
}
