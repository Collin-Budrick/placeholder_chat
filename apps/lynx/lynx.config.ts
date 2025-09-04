import { defineConfig } from '@lynx-js/rspeedy'

import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin'
import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin'
import { pluginTypeCheck } from '@rsbuild/plugin-type-check'

export default defineConfig({
  plugins: [
    pluginQRCode({
      schema(url) {
        // Allow forcing QR target via env so teammates can scan the correct LAN/VPN IP.
        // Priority:
        // 1) LYNX_QR_URL (full URL)
        // 2) Use provided url but override host/port via LYNX_QR_HOST/LYNX_QR_PORT
        // 3) Fallback to the incoming url
        try {
          const forced = process.env.LYNX_QR_URL;
          const fullscreen = 'fullscreen=true';
          if (forced) {
            const u = new URL(forced);
            if (!u.searchParams.has('fullscreen')) {
              u.searchParams.append('fullscreen', 'true');
            }
            return u.toString();
          }
          const base = new URL(url);
          const host = process.env.LYNX_QR_HOST;
          const port = process.env.LYNX_QR_PORT;
          if (host) base.hostname = host;
          if (port) base.port = port;
          if (!base.searchParams.has('fullscreen')) {
            base.searchParams.append('fullscreen', 'true');
          }
          return base.toString();
        } catch (_) {
          return `${url}?fullscreen=true`;
        }
      },
    }),
    pluginReactLynx(),
    // Allow disabling checker in container/dev via env
    ...(process.env.LYNX_TYPECHECK === '0' ? [] : [pluginTypeCheck()]),
  ],
})
