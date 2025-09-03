# Web Dev Start Script

This repository includes a PowerShell script to spin up the gateway service and the web development server in the background. It supports starting and stopping the dev stack via a single command.

## Prerequisites

- Windows PowerShell (7+ recommended)
- bun is installed and available in PATH (required for the web dev server)
- The gateway executable is built and located at target/debug/gateway.exe
- The script expects the repository root to contain apps/, logs/, and target/ as shown in this project

## Quick start

- Start the dev stack (detached)
  - Command: 
    ```powershell
    .\scripts\start-web-dev.ps1
    ```
  - This launches gateway and web dev processes in the background and writes logs to:
    - logs/gateway-dev.out.log
    - logs/gateway-dev.err.log
    - logs/web-dev.out.log
    - logs/web-dev.err.log
  - PID files created:
    - logs/gateway-dev.pid
    - logs/web-dev.pid
  - The script prints: "Launching background dev stack… (use --stop to kill later)"

- Stop the dev stack
  - Command:
    ```powershell
    .\scripts\start-web-dev.ps1 --stop
    ```
  - This stops the running gateway and web dev processes and cleans up PID files.

## What happens when you run

- By default, start-web-dev.ps1 relaunches itself in detached mode so the processes keep running after the PowerShell session ends.
- The script starts:
  - gateway.exe in the background
  - bun run dev (web dev server) in the apps/web directory
- Logs and PID files are stored under the logs directory:
  - gateway: logs/gateway-dev.out.log, logs/gateway-dev.err.log, logs/gateway-dev.pid
  - web: logs/web-dev.out.log, logs/web-dev.err.log, logs/web-dev.pid

## Verification tips

- To verify, you can inspect the logs:
  - tail -f logs/web-dev.out.log
  - tail -f logs/gateway-dev.out.log
- Or check for running processes:
  - gateway.exe (Windows Task Manager or Get-Process gateway)
  - bun (bun.exe/bun on Windows)

## Notes

- If you need to stop all dev-related processes in one go, use the --stop option as shown above.
- If bun or the gateway binary isn’t found, ensure you have built the gateway and installed bun, and that you are running the script from the repository root.
