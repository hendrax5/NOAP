# 🔧 Ruijie Backup — Troubleshoot Later

**Status**: Still failing after Fix 1 (`iosLikePrompt` stricter matching)  
**Date**: 2026-03-19  
**Devices**: Ruijie switches (via `sshInteractiveExec` path)

## What We Already Fixed
- `iosLikePrompt()` — requires ≥2 chars, no spaces in hostname (was matching banners)
- Huawei issue is **resolved** (same session)

## What to Investigate Next

### 1. Capture raw SSH output
Add temporary debug logging inside `sshInteractiveExec` to dump:
- Raw bytes received after each command
- What `waitForPrompt` sees as the "last line"
- Whether the initial prompt is even detected (Phase 1)

### 2. Check Ruijie prompt format
SSH into a Ruijie device manually and note:
- Exact prompt string (e.g. `Ruijie>`, `Ruijie#`, `RGOS>`)
- Does it send a banner/MOTD before the prompt?
- Does `terminal length 0` work or is it `screen-length 0`?

### 3. Potential issues
- **PTY size**: `sshInteractiveExec` requests a `vt100` terminal — Ruijie might need `xterm`
- **Paging command**: Currently sends `terminal length 0` — some Ruijie models use `more off` or `screen-length disable`
- **Enable mode**: Some Ruijie switches require `enable` before `show running-config`
- **Command variant**: Might need `show running-config` vs `display current-configuration`
- **Timing**: `waitForPrompt` sleep is 200ms — might be too fast for slower Ruijie boxes

### 4. Relevant code path
```
fetchDeviceConfig() → vendor "Ruijie" → sshInteractiveExec()
  vendorSSHConfig("Ruijie") returns:
    - PagingDisable: "terminal length 0"
    - ShowCommand:   "show running-config"
    - PromptFunc:    iosLikePrompt
```
File: `backend/workers/config_backup.go`

### 5. Quick test commands
```bash
# Manual SSH to verify prompt format
ssh user@<ruijie-ip>

# Check what prompt looks like
# Check if 'terminal length 0' is accepted
# Check if 'show running-config' works
```
