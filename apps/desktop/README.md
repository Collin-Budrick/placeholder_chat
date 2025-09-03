Stack Desktop (Tauri)

Quick notes to point the desktop app at a website:

- Configure URL: Edit `apps/desktop/tauri.conf.json` and set `app.windows[0].url` to your site, e.g. `https://example.com`.
- Run in dev: `bun run desktop:dev` (or `npm run desktop:dev`), which runs `cargo run -p desktop_app`.
- Build release: `bun run desktop:build` (or `npm run desktop:build`).

IPC and permissions:
- Loading a remote site disables Tauri API access from the page by default for safety.
- If you plan to call Tauri commands from your website, let’s add the proper permissions and allow-list your domain.

Branding:
- Replace `apps/desktop/icons/icon.ico` with your own Windows icon to customize the EXE metadata and taskbar icon.
