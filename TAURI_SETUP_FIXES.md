# Tauri Desktop App Build Fixes

## Summary
Fixed the Tauri desktop app build that was failing due to icon parsing errors, incorrect server spawning logic, and path resolution issues.

## Issues & Fixes

### 1. **Invalid ICO File Format**
**Problem:** The `icon.ico` was not a valid Windows ICO file — it was actually a PNG file renamed with .ico extension. The Windows RC compiler (version 10.0.10011.16384) rejected it with error `RC2175: resource file is not in 3.00 format`.

**Solution:** Downloaded a valid ICO file from Google's favicon.ico service:
```bash
Invoke-WebRequest -Uri 'https://www.google.com/favicon.ico' -OutFile 'G:/t3code/apps/tauri-desktop/src-tauri/icons/icon.ico'
```
This provides a valid multi-image ICO file (2 images) that passes RC.EXE compilation.

**File:** `apps/tauri-desktop/src-tauri/icons/icon.ico`

---

### 2. **Unused Variable Warning**
**Problem:** `main.rs` line 91 declared `app` variable that was never used, generating a compiler warning.

**Solution:** Prefixed with underscore:
```rust
let _app = tauri::Builder::default()
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
```

**File:** `apps/tauri-desktop/src-tauri/src/main.rs` (line 91)

---

### 3. **Port Conflict (5733)**
**Problem:** Port 5733 was already in use by a previous Node.js process, blocking the Vite dev server.

**Solution:** Killed the hanging process:
```powershell
Get-NetTCPConnection -LocalPort 5733 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

---

### 4. **Incorrect Server Spawn Command**
**Problem:** `main.rs` was trying to spawn the server with `bun run -w t3 start`, which is not a valid command. The `-w` flag with `t3` as a package name doesn't work.

**Solution:** Changed to use the correct monorepo command `bun run dev:server`:
```rust
let mut cmd = Command::new("bun");
cmd.current_dir(&monorepo_root);
cmd.arg("run");
cmd.arg("dev:server");
```

**File:** `apps/tauri-desktop/src-tauri/src/main.rs` (spawn_server function)

---

### 5. **Incorrect Path Resolution to Monorepo Root**
**Problem:** Path calculation to monorepo root was off by one level. The code was calculating:
- `CARGO_MANIFEST_DIR` = `G:\t3code\apps\tauri-desktop\src-tauri`
- `.parent()` → `G:\t3code\apps\tauri-desktop`
- `.parent()` → `G:\t3code\apps` ❌ (should be `G:\t3code`)

This caused the server startup to fail with `Cannot find module 'G:\t3code\apps\scripts\dev-runner.ts'`

**Solution:** Added one more `.parent()` call to get three levels up:
```rust
let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
let monorepo_root = manifest_dir
    .parent()
    .and_then(|p| p.parent())
    .and_then(|p| p.parent())  // Added this level
    .map(|p| p.to_path_buf())
    .unwrap_or_else(|| PathBuf::from("."));
```

**File:** `apps/tauri-desktop/src-tauri/src/main.rs` (spawn_server function)

---

## Build Command

To build the production .exe:

```bash
bun run build:tauri
```

Or from the tauri-desktop directory:
```bash
cd apps/tauri-desktop && bun run build
```

This will:
1. ✅ Build the React web app (Vite)
2. ✅ Compile Rust with Tauri
3. ✅ Generate Windows installer/executable

The output will be in `apps/tauri-desktop/src-tauri/target/release/bundle/`

---

## Development

To run the dev environment:
```bash
bun run dev:tauri
```

This starts:
- 🔵 Vite dev server on port 5733
- 🦀 Rust Tauri compiler
- 📦 Node.js backend server on port 9998
- 🪟 Native Tauri window

---

## Changed Files Summary

| File | Change |
|------|--------|
| `apps/tauri-desktop/src-tauri/icons/icon.ico` | Replaced with valid ICO file |
| `apps/tauri-desktop/src-tauri/src/main.rs` | Fixed server spawn command, path resolution, unused variable |

