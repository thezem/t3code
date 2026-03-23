# T3 Code - Tauri Desktop

Lightweight desktop wrapper for T3 Code using Tauri instead of Electron.

## Features

- ✅ Lightweight (~50MB bundle vs Electron's 300MB+)
- ✅ No VSBuild Tools required
- ✅ Automatic server process management
- ✅ Native window with WebSocket communication to Node.js backend
- ✅ Cross-platform (Windows, macOS, Linux)

## Development

Install dependencies:
```bash
cd apps/tauri-desktop
bun install
```

Run in dev mode:
```bash
# From repo root:
bun run dev:tauri

# Or from tauri-desktop directory:
bun run dev
```

This will:
1. Start the server on `localhost:9999`
2. Open Tauri dev window pointing to `http://localhost:9999`
3. Watch for code changes

## Building

Build for production:
```bash
# From tauri-desktop directory:
bun run build

# Or from repo root:
bun run build:tauri
```

Output will be in `src-tauri/target/release/bundle/`

## How It Works

### Architecture

```
Tauri Window (Native)
  ↓ WebSocket
Node.js Server (localhost:9999, spawned by Tauri)
  ↓
File System / Git / Agents
```

### Server Management

The Rust backend (`src-tauri/src/main.rs`) handles:
- Spawning the Node.js server as a child process
- Waiting for the server to be ready (TCP connection check)
- Passing environment variables (`T3CODE_PORT=9999`, `T3CODE_MODE=desktop`)
- Killing the server when the app closes

### Development Flow

When you run `bun run dev`:
- Tauri starts the Rust dev server
- main.rs spawns `bun run t3 start` as a child process
- Waits for port 9999 to be open
- Opens a dev window pointing to `http://localhost:9999`
- Web app auto-connects to WebSocket on same host/port

## Troubleshooting

### Server doesn't start
- Check that port 9999 is available: `netstat -an | grep 9999`
- Verify `bun run t3 start` works standalone: `T3CODE_PORT=9999 bun run -w t3 start`

### Window is blank
- Check Tauri console for errors
- Ensure the server is running on port 9999
- Try refreshing the window (Cmd/Ctrl+R)

### Build fails
- Ensure you have Rust installed: `rustup update`
- Clear cache: `rm -rf src-tauri/target`
- Check Cargo.toml dependencies are available

## Next Steps

1. Add proper icons to `src-tauri/icons/`
2. Configure distribution/signing for production releases
3. Set up CI/CD for automated builds
4. Consider adding updater support via `tauri-plugin-updater`

