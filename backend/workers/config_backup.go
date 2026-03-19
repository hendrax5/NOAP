package workers

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
	"github.com/ziutek/telnet"
	"github.com/hendrax5/noap/database"
	"github.com/hendrax5/noap/models"
)

// backupRunning prevents duplicate overlapping backup runs when the SSH
// polling interval is shorter than the time taken to backup all devices.
var backupRunning sync.Mutex

// loadHostKeyCallback returns an ssh.HostKeyCallback.
//   - If SSH_KNOWN_HOSTS env var points to a file, it is loaded via
//     golang.org/x/crypto/ssh/knownhosts (strict host-key verification).
//   - If the env var is empty AND APP_ENV != "production", a permissive
//     callback is used with a loud warning (developer convenience only).
//   - In production without SSH_KNOWN_HOSTS the worker logs a fatal error.
func loadHostKeyCallback() ssh.HostKeyCallback {
	path := os.Getenv("SSH_KNOWN_HOSTS")
	if path != "" {
		cb, err := knownhosts.New(path)
		if err != nil {
			log.Fatalf("[ConfigBackup] Cannot load SSH_KNOWN_HOSTS %q: %v", path, err)
		}
		return cb
	}

	if os.Getenv("APP_ENV") == "production" {
		log.Fatal("[ConfigBackup] SSH_KNOWN_HOSTS must be set in production. " +
			"Set it to a known_hosts file or set APP_ENV != production to use insecure mode.")
	}

	log.Println("[ConfigBackup] WARNING: SSH host-key verification is DISABLED. " +
		"Set SSH_KNOWN_HOSTS in production.")
	// InsecureIgnoreHostKey is intentionally used here ONLY in non-production.
	//nolint:gosec
	return func(host string, remote net.Addr, key ssh.PublicKey) error {
		return nil // accept any key in dev
	}
}

// backupRetentionCount is the maximum number of backups kept per device.
// Older records beyond this limit are deleted after each successful save.
func backupRetentionCount() int {
	if v, err := strconv.Atoi(os.Getenv("BACKUP_RETENTION_COUNT")); err == nil && v > 0 {
		return v
	}
	return 30 // default
}

// pruneOldBackups deletes surplus backup records for a device, keeping the
// most recent keepN entries. Runs in-process; failures are logged but not fatal.
func pruneOldBackups(deviceID uint, keepN int) {
	// Fetch IDs of the oldest surplus records.
	var ids []uint
	database.DB.Model(&models.ConfigBackup{}).
		Select("id").
		Where("device_id = ?", deviceID).
		Order("created_at desc").
		Offset(keepN).
		Find(&ids)
	if len(ids) == 0 {
		return
	}
	if err := database.DB.Where("id IN ?", ids).Delete(&models.ConfigBackup{}).Error; err != nil {
		log.Printf("[ConfigBackup] WARN prune failed for device %d: %v", deviceID, err)
	} else {
		log.Printf("[ConfigBackup] PRUNE device %d — removed %d old backup(s)", deviceID, len(ids))
	}
}

// stripAnsi removes ANSI/VT100 escape sequences from s.
// Huawei VRP emits colour and cursor-movement codes even on vt100 terminals.
func stripAnsi(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	inEsc := false
	for i := 0; i < len(s); i++ {
		ch := s[i]
		switch {
		case inEsc:
			// ESC [ … terminated by a letter [A-Za-z], or ESC alone before
			// a non-'[' character.
			if (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') {
				inEsc = false
			}
		case ch == 0x1B: // ESC
			inEsc = true
		case ch == 0x08: // BS — backspace (--More-- prompt erasure)
			// skip
		case ch == 0x0D: // CR — skip bare carriage returns
			// skip
		default:
			b.WriteByte(ch)
		}
	}
	return b.String()
}

// isVRPPrompt returns true when line looks like a Huawei VRP or H3C Comware
// CLI prompt. Stricter than before: rejects config-body lines that happen
// to be wrapped in angle/square brackets (e.g. "<Group>", "[section/foo]").
//
//	<hostname>        normal user/system view
//	[hostname]        configuration view  (H3C)
//	[~hostname]       configuration view variant
func isVRPPrompt(line string) bool {
	t := strings.TrimSpace(line)
	if t == "" || len(t) < 2 {
		return false
	}
	// angle-bracket form: <hostname>
	if strings.HasPrefix(t, "<") && strings.HasSuffix(t, ">") {
		inner := t[1 : len(t)-1]
		// Real VRP hostnames have no spaces or slashes inside.
		return len(inner) > 0 && !strings.Contains(inner, " ") && !strings.Contains(inner, "/")
	}
	// square-bracket form: [hostname] or [~hostname]
	if strings.HasPrefix(t, "[") && strings.HasSuffix(t, "]") {
		inner := t[1 : len(t)-1]
		return len(inner) > 0 && !strings.Contains(inner, " ")
	}
	return false
}

// sshShellExec implements a 3-phase interactive shell approach modelled after
// LibreNMS's Huawei OS collector:
//
//  1. Open PTY shell, wait for initial prompt (up to 15 s).
//  2. Send screen-length 0 (disable paging), wait for prompt again.
//  3. Send the real command, collect all output until the trailing prompt.
//
// ANSI escape codes are stripped before any line is inspected or returned.
func sshShellExec(dev models.Device, cmd string) (string, error) {
	addr := fmt.Sprintf("%s:%d", dev.IP, dev.AuthPort)
	cfg := &ssh.ClientConfig{
		User:            dev.SSHUser,
		Auth:            []ssh.AuthMethod{ssh.Password(dev.SSHPass)},
		HostKeyCallback: loadHostKeyCallback(),
		Timeout:         20 * time.Second,
	}
	client, err := ssh.Dial("tcp", addr, cfg)
	if err != nil {
		return "", fmt.Errorf("dial: %w", err)
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("session: %w", err)
	}
	defer session.Close()

	termModes := ssh.TerminalModes{
		ssh.ECHO:          0,
		ssh.TTY_OP_ISPEED: 115200,
		ssh.TTY_OP_OSPEED: 115200,
	}
	if err := session.RequestPty("vt100", 200, 512, termModes); err != nil {
		return "", fmt.Errorf("pty: %w", err)
	}

	stdin, err := session.StdinPipe()
	if err != nil {
		return "", fmt.Errorf("stdin pipe: %w", err)
	}

	var rawBuf bytes.Buffer
	session.Stdout = &rawBuf
	session.Stderr = &rawBuf

	if err := session.Shell(); err != nil {
		return "", fmt.Errorf("shell: %w", err)
	}

	// ── Helper: waitForPrompt blocks until the LAST non-empty line in rawBuf
	// matches a VRP prompt, or timeout fires. Only the trailing line is
	// checked — config body may contain lines that resemble prompts.
	waitForPrompt := func(timeout time.Duration) (string, error) {
		deadline := time.Now().Add(timeout)
		for time.Now().Before(deadline) {
			time.Sleep(250 * time.Millisecond)
			clean := stripAnsi(rawBuf.String())
			// Handle Huawei VRP "  ---- More ----" pager prompt.
			trimmed := strings.TrimRight(clean, " \t\n")
			if strings.HasSuffix(trimmed, "---- More ----") {
				fmt.Fprint(stdin, " ")
				continue
			}
			// Only check the last non-empty line for the prompt.
			lines := strings.Split(clean, "\n")
			for i := len(lines) - 1; i >= 0; i-- {
				if strings.TrimSpace(lines[i]) != "" {
					if isVRPPrompt(lines[i]) {
						return clean, nil
					}
					break // only check the last non-empty line
				}
			}
		}
		return stripAnsi(rawBuf.String()), fmt.Errorf("timeout waiting for prompt after %s", timeout)
	}

	// ── Phase 1: wait for the initial login/system-view prompt (15 s).
	if _, err := waitForPrompt(15 * time.Second); err != nil {
		return "", fmt.Errorf("phase1 (initial prompt): %w", err)
	}

	// ── Phase 2: disable paging.  LibreNMS sends this before the main command.
	//   Huawei VRP : screen-length 0 temporary
	//   H3C Comware: screen-length disable
	pagingCmd := "screen-length 0 temporary"
	if dev.Vendor == "H3C" {
		pagingCmd = "screen-length disable"
	}
	rawBuf.Reset()
	fmt.Fprintf(stdin, "%s\n", pagingCmd)
	if _, err := waitForPrompt(10 * time.Second); err != nil {
		// Non-fatal — some firmware versions ignore or reject the command;
		// we continue anyway.
		log.Printf("[ConfigBackup] WARN %s: paging disable prompt timeout: %v", dev.IP, err)
	}

	// ── Phase 3: send the actual config command and collect output.
	rawBuf.Reset()
	fmt.Fprintf(stdin, "%s\n", cmd)

	// Wait up to 60 s for the trailing prompt that marks end of output.
	out, _ := waitForPrompt(60 * time.Second)

	// Close the session so the remote side gets an EOF.
	session.Close()

	// Strip the first line (echo of our command) and the last line (prompt).
	lines := strings.Split(out, "\n")
	var cleaned []string
	for i, l := range lines {
		if i == 0 && strings.Contains(l, cmd) {
			continue // skip command echo
		}
		if i == len(lines)-1 && isVRPPrompt(l) {
			continue // skip trailing prompt
		}
		cleaned = append(cleaned, l)
	}

	return strings.Join(cleaned, "\n"), nil
}

// vendorConfig describes how to interact with a specific vendor's SSH CLI.
type vendorConfig struct {
	// setupCmds are sent after the initial prompt, before the main command.
	// Typical use: disable paging ("terminal length 0").
	setupCmds []string
	// mainCmd is the command that retrieves the configuration.
	mainCmd string
	// isPrompt returns true when a line looks like the device's CLI prompt.
	isPrompt func(string) bool
	// setupTimeout is how long to wait for the prompt after each setup command.
	setupTimeout time.Duration
	// outputTimeout is how long to wait for the trailing prompt after mainCmd.
	outputTimeout time.Duration
}

// iosLikePrompt detects Cisco IOS / Ruijie RGOS prompts:
//
//	Router>    Router#    Switch(config)#
//
// Stricter than a bare suffix check: requires ≥2 chars with no spaces in
// the hostname portion, so banners/MOTD text don't trigger false positives.
func iosLikePrompt(line string) bool {
	t := strings.TrimSpace(line)
	if t == "" || len(t) < 2 {
		return false
	}
	last := t[len(t)-1]
	if last != '>' && last != '#' {
		return false
	}
	// The part before the trailing ">" / "#" is the hostname (possibly with
	// a mode suffix like "(config)"). Real prompts have no spaces.
	core := t[:len(t)-1]
	return !strings.Contains(core, " ")
}

// mikroTikPrompt detects MikroTik RouterOS prompts:
//
//	[admin@MikroTik] >        [admin@Router] /ip>
func mikroTikPrompt(line string) bool {
	t := strings.TrimSpace(line)
	// MikroTik prompt always ends with "> " or ">", and contains "] "
	return strings.Contains(t, "@") && strings.Contains(t, "]") &&
		(strings.HasSuffix(t, "> ") || strings.HasSuffix(t, ">"))
}

// vyosLikePrompt detects VyOS / DanOS prompts:
//
//	vyos@vyos:~$      admin@danos:~$
func vyosLikePrompt(line string) bool {
	t := strings.TrimSpace(line)
	return strings.Contains(t, "@") && strings.HasSuffix(t, "$")
}

// normalizeVendor maps free-form vendor strings stored in the database to
// the canonical names used in all switch statements throughout this file.
// For example "MikroTik RouterOS v7" → "MikroTik", "DANOS" → "DanOS".
func normalizeVendor(v string) string {
	lower := strings.ToLower(v)
	switch {
	case strings.HasPrefix(lower, "mikrotik"):
		return "MikroTik"
	case lower == "danos" || strings.HasPrefix(lower, "danos"):
		return "DanOS"
	case strings.HasPrefix(lower, "vyos"):
		return "VyOS"
	case strings.HasPrefix(lower, "ruijie"):
		return "Ruijie"
	case strings.HasPrefix(lower, "huawei"):
		return "Huawei"
	case strings.HasPrefix(lower, "h3c"):
		return "H3C"
	case strings.HasPrefix(lower, "juniper"):
		return "Juniper"
	case strings.HasPrefix(lower, "cisco"):
		return "Cisco"
	case strings.HasPrefix(lower, "zte"):
		return "ZTE"
	}
	return v // unknown vendor — pass through as-is
}

// vendorSSHConfig returns a vendorConfig for the given vendor string.
// Returns nil if the vendor should use the standard session.Run() path.
func vendorSSHConfig(vendor string) *vendorConfig {
	switch normalizeVendor(vendor) {
	case "Ruijie":
		return &vendorConfig{
			// Oxidized RGOS sends both terminal length 0 AND terminal width 0.
			setupCmds:     []string{"terminal length 0", "terminal width 0"},
			mainCmd:       "show running-config",
			isPrompt:      iosLikePrompt,
			setupTimeout:  10 * time.Second,
			outputTimeout: 60 * time.Second,
		}
	// MikroTik is NOT here — it uses session.Run() (exec-channel), not shell.
	case "DanOS":
		return &vendorConfig{
			setupCmds:     []string{"set terminal length 0"},
			mainCmd:       "show configuration commands | no-more",
			isPrompt:      vyosLikePrompt,
			setupTimeout:  10 * time.Second,
			outputTimeout: 90 * time.Second,
		}
	case "VyOS":
		return &vendorConfig{
			setupCmds:     []string{"set terminal length 0"},
			mainCmd:       "show configuration commands | no-more",
			isPrompt:      vyosLikePrompt,
			setupTimeout:  10 * time.Second,
			outputTimeout: 90 * time.Second,
		}
	}
	return nil
}

// sshInteractiveExec is a generic interactive-shell executor. Unlike
// session.Run(), it opens a PTY shell, which is required for vendors whose SSH
// server does not support exec-channel (e.g. Ruijie RGOS, DanOS, VyOS).
//
// Flow:
//  1. Open PTY shell → wait for initial prompt.
//  2. Send each setupCmd in turn → wait for prompt after each.
//  3. Send mainCmd → collect all output until trailing prompt.
//
// ANSI escape codes are stripped from output before inspection or return.
func sshInteractiveExec(dev models.Device, vc *vendorConfig) (string, error) {
	addr := fmt.Sprintf("%s:%d", dev.IP, dev.AuthPort)
	cfg := &ssh.ClientConfig{
		User:            dev.SSHUser,
		Auth:            []ssh.AuthMethod{ssh.Password(dev.SSHPass)},
		HostKeyCallback: loadHostKeyCallback(),
		Timeout:         20 * time.Second,
	}
	client, err := ssh.Dial("tcp", addr, cfg)
	if err != nil {
		return "", fmt.Errorf("dial: %w", err)
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("session: %w", err)
	}
	defer session.Close()

	termModes := ssh.TerminalModes{
		ssh.ECHO:          0,
		ssh.TTY_OP_ISPEED: 115200,
		ssh.TTY_OP_OSPEED: 115200,
	}
	if err := session.RequestPty("vt100", 200, 512, termModes); err != nil {
		return "", fmt.Errorf("pty: %w", err)
	}

	stdin, err := session.StdinPipe()
	if err != nil {
		return "", fmt.Errorf("stdin pipe: %w", err)
	}

	var rawBuf bytes.Buffer
	session.Stdout = &rawBuf
	session.Stderr = &rawBuf

	if err := session.Shell(); err != nil {
		return "", fmt.Errorf("shell: %w", err)
	}

	// waitForPrompt polls rawBuf until vc.isPrompt matches a line that is NOT
	// the echoed command, or times out. skipContaining, when non-empty, causes
	// lines containing that substring to be ignored (avoids triggering on the
	// echoed mainCmd line, e.g. "[user@host] > export compact").
	waitForPrompt := func(timeout time.Duration, skipContaining string) (string, error) {
		deadline := time.Now().Add(timeout)
		lastLen := 0
		for time.Now().Before(deadline) {
			time.Sleep(200 * time.Millisecond)
			clean := stripAnsi(rawBuf.String())
			// Check for Unix pager: output ends with ":" on its own line.
			// Send space to advance the page.
			if curLen := len(clean); curLen > lastLen {
				lastLen = curLen
				trimmed := strings.TrimRight(clean, " \t\n")
				if strings.HasSuffix(trimmed, ":") && !strings.HasSuffix(trimmed, "$") {
					// Looks like a pager prompt — send space to advance.
					fmt.Fprint(stdin, " ")
					continue
				}
			}
			for _, line := range strings.Split(clean, "\n") {
				if skipContaining != "" && strings.Contains(line, skipContaining) {
					continue
				}
				if vc.isPrompt(line) {
					return clean, nil
				}
			}
		}
		return stripAnsi(rawBuf.String()), fmt.Errorf("timeout waiting for prompt after %s", timeout)
	}

	// Phase 1: wait for initial login prompt.
	if _, err := waitForPrompt(15*time.Second, ""); err != nil {
		return "", fmt.Errorf("initial prompt: %w", err)
	}

	// Phase 2: send setup commands (e.g. terminal length 0).
	for _, sc := range vc.setupCmds {
		rawBuf.Reset()
		fmt.Fprintf(stdin, "%s\n", sc)
		if _, err := waitForPrompt(vc.setupTimeout, ""); err != nil {
			log.Printf("[ConfigBackup] WARN %s: setup cmd %q prompt timeout: %v", dev.IP, sc, err)
		}
	}

	// Phase 3: collect the actual configuration.
	rawBuf.Reset()
	fmt.Fprintf(stdin, "%s\n", vc.mainCmd)

	// waitForPrompt skips lines containing mainCmd so the echoed command line
	// (e.g. "[user@host] > export compact") does NOT trigger an early return.
	out, _ := waitForPrompt(vc.outputTimeout, vc.mainCmd)
	session.Close()

	// Strip the echoed command line(s) and the trailing prompt line.
	lines := strings.Split(out, "\n")
	var cleaned []string
	for i, l := range lines {
		// Skip any line that looks like the echoed command.
		if strings.Contains(l, vc.mainCmd) {
			continue
		}
		// Skip trailing prompt line.
		if i == len(lines)-1 && vc.isPrompt(l) {
			continue
		}
		// Skip pager artifacts like ":" or "-- More --" or "(END)".
		tt := strings.TrimSpace(l)
		if tt == ":" || strings.Contains(tt, "-- More --") || tt == "(END)" {
			continue
		}
		cleaned = append(cleaned, l)
	}
	return strings.Join(cleaned, "\n"), nil
}

func StartConfigBackupWorker() {
	// Tick every 1 minute and check each device's individual schedule.
	// BACKUP_INTERVAL_MINUTES env var is ignored for scheduling now
	// (per-device BackupIntervalMin in the DB controls each device).
	log.Println("[ConfigBackup] Starting poller — per-device scheduling (1-min tick)")
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	// Initial run.
	runConfigBackup()

	for range ticker.C {
		// Guard: skip if previous run is still in progress.
		if !backupRunning.TryLock() {
			log.Println("[ConfigBackup] Previous run still in progress — skipping tick")
			continue
		}
		go func() {
			defer backupRunning.Unlock()
			runConfigBackup()
		}()
	}
}

func runConfigBackup() {
	var devices []models.Device
	if err := database.DB.Find(&devices).Error; err != nil {
		log.Printf("[ConfigBackup] Failed to query devices: %v", err)
		return
	}

	log.Printf("[ConfigBackup] Starting backup run — %d device(s) found", len(devices))

	for _, dev := range devices {
		// Per-device schedule gate: skip disabled devices.
		if !dev.BackupEnabled {
			continue
		}

		// Check if enough time has elapsed since the last backup.
		interval := dev.BackupIntervalMin
		if interval <= 0 {
			interval = 1440 // safety fallback
		}
		if dev.LastBackupAt != nil {
			nextDue := dev.LastBackupAt.Add(time.Duration(interval) * time.Minute)
			if time.Now().Before(nextDue) {
				continue // not yet due
			}
		}

		log.Printf("[ConfigBackup] Processing device %s (%s)...", dev.Name, dev.IP)

		if dev.SSHUser == "" || dev.SSHPass == "" {
			log.Printf("[ConfigBackup] SKIP %s: credentials not configured (set ssh_user + ssh_pass)", dev.IP)
			continue
		}

		addr := fmt.Sprintf("%s:%d", dev.IP, dev.AuthPort)
		var configText string

		if strings.EqualFold(dev.AuthProtocol, "telnet") {
			out, telErr := telnetFetchConfig(dev, addr)
			if telErr != nil {
				log.Printf("[ConfigBackup] FAIL Telnet %s: %v", dev.IP, telErr)
				database.DB.Model(&dev).Update("last_cli_status", "down")
				go DispatchTelegramAlert(dev.TenantID, fmt.Sprintf("🔴 BACKUP FAILED: %s (%s) — Telnet: %v", dev.Name, dev.IP, telErr))
				database.DB.Create(&models.BackupEvent{TenantID: dev.TenantID, DeviceID: dev.ID, Status: "failed", Message: fmt.Sprintf("Telnet: %v", telErr)})
				continue
			}
			configText = out
		} else {
			// SSH path — check if this vendor needs an interactive shell.
			// Vendors like MikroTik, DanOS, Ruijie, Huawei, H3C either:
			//   (a) don't support exec-channel at all, or
			//   (b) need paging disabled interactively before the show command.
			// For those, vendorSSHConfig returns a non-nil config and we use
			// sshInteractiveExec. Huawei/H3C keep using sshShellExec with
			// VRP-specific prompt detection.

			switch normalizeVendor(dev.Vendor) {
			case "Huawei", "H3C":
				// Oxidized uses: screen-length 0 temporary + display current-configuration all
				out, shellErr := sshShellExec(dev, "display current-configuration all")
				if shellErr != nil {
					log.Printf("[ConfigBackup] FAIL shell %s: %v", dev.IP, shellErr)
					database.DB.Model(&dev).Update("last_cli_status", "down")
					go DispatchTelegramAlert(dev.TenantID, fmt.Sprintf("🔴 BACKUP FAILED: %s (%s) — SSH shell: %v", dev.Name, dev.IP, shellErr))
					database.DB.Create(&models.BackupEvent{TenantID: dev.TenantID, DeviceID: dev.ID, Status: "failed", Message: fmt.Sprintf("SSH shell: %v", shellErr)})
					continue
				}
				configText = out

			case "DanOS", "VyOS", "Ruijie":
				vc := vendorSSHConfig(normalizeVendor(dev.Vendor))
				if vc == nil {
					log.Printf("[ConfigBackup] BUG: no vendorConfig for %s", dev.Vendor)
					continue
				}
				out, shellErr := sshInteractiveExec(dev, vc)
				if shellErr != nil {
					log.Printf("[ConfigBackup] FAIL interactive-shell %s (%s): %v", dev.IP, dev.Vendor, shellErr)
					database.DB.Model(&dev).Update("last_cli_status", "down")
					go DispatchTelegramAlert(dev.TenantID, fmt.Sprintf("🔴 BACKUP FAILED: %s (%s) — interactive-shell: %v", dev.Name, dev.IP, shellErr))
					database.DB.Create(&models.BackupEvent{TenantID: dev.TenantID, DeviceID: dev.ID, Status: "failed", Message: fmt.Sprintf("interactive-shell: %v", shellErr)})
					continue
				}
				configText = out

			default:
				// MikroTik, Cisco, Juniper, generic — exec-channel works fine.
				// Oxidized: Juniper cfg :ssh do exec true end
				// Oxidized: MikroTik cfg :ssh do exec true end
				config := &ssh.ClientConfig{
					User: dev.SSHUser,
					Auth: []ssh.AuthMethod{
						ssh.Password(dev.SSHPass),
					},
					HostKeyCallback: loadHostKeyCallback(),
					Timeout:         time.Second * 15,
				}

				client, err := ssh.Dial("tcp", addr, config)
				if err != nil {
					log.Printf("[ConfigBackup] FAIL SSH dial %s: %v", dev.IP, err)
					database.DB.Model(&dev).Update("last_cli_status", "down")
					go DispatchTelegramAlert(dev.TenantID, fmt.Sprintf("🔴 BACKUP FAILED: %s (%s) — SSH dial: %v", dev.Name, dev.IP, err))
					database.DB.Create(&models.BackupEvent{TenantID: dev.TenantID, DeviceID: dev.ID, Status: "failed", Message: fmt.Sprintf("SSH dial: %v", err)})
					continue
				}

				session, err := client.NewSession()
				if err != nil {
					client.Close()
					log.Printf("[ConfigBackup] FAIL SSH session %s: %v", dev.IP, err)
					database.DB.Model(&dev).Update("last_cli_status", "down")
					go DispatchTelegramAlert(dev.TenantID, fmt.Sprintf("🔴 BACKUP FAILED: %s (%s) — SSH session: %v", dev.Name, dev.IP, err))
					database.DB.Create(&models.BackupEvent{TenantID: dev.TenantID, DeviceID: dev.ID, Status: "failed", Message: fmt.Sprintf("SSH session: %v", err)})
					continue
				}

				// No PTY for exec-channel (Oxidized: exec true).
				// Exec channel sends the command directly, no shell.
				cmd := "show running-config"
				switch normalizeVendor(dev.Vendor) {
				case "Juniper":
					cmd = "show configuration | display set | no-more"
				case "MikroTik":
					cmd = "/export compact"
				}

				var b bytes.Buffer
				session.Stdout = &b
				err = session.Run(cmd)
				session.Close()
				client.Close()

				if err != nil {
					log.Printf("[ConfigBackup] FAIL command on %s (%q): %v", dev.IP, cmd, err)
					database.DB.Model(&dev).Update("last_cli_status", "down")
					go DispatchTelegramAlert(dev.TenantID, fmt.Sprintf("🔴 BACKUP FAILED: %s (%s) — command %q: %v", dev.Name, dev.IP, cmd, err))
					database.DB.Create(&models.BackupEvent{TenantID: dev.TenantID, DeviceID: dev.ID, Status: "failed", Message: fmt.Sprintf("command %q: %v", cmd, err)})
					continue
				}
				configText = b.String()
			}
		}

		// Guard: empty output means something went wrong — don't write a blank record.
		if len(configText) < 10 {
			log.Printf("[ConfigBackup] SKIP %s: retrieved config is empty or too short (%d bytes) — check credentials, vendor type, and SSH access", dev.IP, len(configText))
			database.DB.Model(&dev).Update("last_cli_status", "down")
			go DispatchTelegramAlert(dev.TenantID, fmt.Sprintf("🔴 BACKUP FAILED: %s (%s) — config empty or too short (%d bytes)", dev.Name, dev.IP, len(configText)))
			database.DB.Create(&models.BackupEvent{TenantID: dev.TenantID, DeviceID: dev.ID, Status: "failed", Message: fmt.Sprintf("config empty (%d bytes)", len(configText))})
			continue
		}

		// Mark device as reachable
		now := time.Now()
		database.DB.Model(&dev).Updates(map[string]interface{}{
			"last_cli_status": "up",
			"last_seen":       now,
			"last_backup_at":  now,
		})
		database.DB.Create(&models.BackupEvent{TenantID: dev.TenantID, DeviceID: dev.ID, Status: "success", Message: "OK"})

		hash := hashConfig(configText)

		// Check if the latest config for this device matches the new hash
		var lastBackup models.ConfigBackup
		database.DB.Where("device_id = ?", dev.ID).Order("created_at desc").First(&lastBackup)

		if lastBackup.ID == 0 || lastBackup.Hash != hash {
			// Configuration changed (or first backup)
			newBackup := models.ConfigBackup{
				TenantID:   dev.TenantID,
				DeviceID:   dev.ID,
				ConfigText: configText,
				Hash:       hash,
			}
			if err := database.DB.Create(&newBackup).Error; err != nil {
				log.Printf("[ConfigBackup] FAIL DB write for %s: %v", dev.IP, err)
				continue
			}
			log.Printf("[ConfigBackup] OK   %s — new backup saved (%d bytes, hash %s)", dev.IP, len(configText), hash[:8])

			if lastBackup.ID != 0 {
				// Alert on change
				go DispatchTelegramAlert(dev.TenantID, fmt.Sprintf("⚠️ CONFIGURATION CHANGED: Device %s running-config was modified. Verify changes in Automation Dashboard.", dev.Name))
			}

			// Compliance scan — runs after every new backup regardless of change status.
			violations := RunComplianceCheck(configText)
			for _, v := range violations {
				msg := fmt.Sprintf("🔐 COMPLIANCE [%s] on %s: %s", v.Severity, dev.Name, v.Message)
				log.Println("[ConfigBackup]", msg)
				if v.Severity == "CRITICAL" {
					go DispatchTelegramAlert(dev.TenantID, msg)
				}
			}

			// Prune old backups, keeping last N.
			pruneOldBackups(dev.ID, backupRetentionCount())
		} else {
			// Config unchanged — still run compliance on the existing text.
			violations := RunComplianceCheck(configText)
			for _, v := range violations {
				if v.Severity == "CRITICAL" {
					msg := fmt.Sprintf("🔐 COMPLIANCE [%s] on %s: %s", v.Severity, dev.Name, v.Message)
					go DispatchTelegramAlert(dev.TenantID, msg)
				}
			}
			log.Printf("[ConfigBackup] OK   %s — config unchanged, no new backup written", dev.IP)
		}
	}
	log.Println("[ConfigBackup] Backup run complete")
}


func hashConfig(text string) string {
	h := sha256.New()
	h.Write([]byte(text))
	return hex.EncodeToString(h.Sum(nil))
}

// BackupResult is the return value of BackupDeviceNow.
type BackupResult struct {
	Changed  bool
	BackupID uint
	Err      error
}

// BackupDeviceNow performs an immediate, synchronous config backup for a
// single device. It is called by the HTTP TriggerBackup handler and runs the
// exact same logic as runConfigBackup but for a single device, returning a
// structured result instead of logging-only.
func BackupDeviceNow(dev models.Device) BackupResult {
	configText, err := fetchDeviceConfig(dev)
	if err != nil {
		return BackupResult{Err: err}
	}
	if len(configText) < 10 {
		return BackupResult{Err: fmt.Errorf("retrieved config too short (%d bytes)", len(configText))}
	}

	hash := hashConfig(configText)

	var lastBackup models.ConfigBackup
	database.DB.Where("device_id = ?", dev.ID).Order("created_at desc").First(&lastBackup)

	if lastBackup.ID != 0 && lastBackup.Hash == hash {
		// Unchanged — run compliance, return unchanged result.
		violations := RunComplianceCheck(configText)
		for _, v := range violations {
			if v.Severity == SeverityCritical {
				go DispatchTelegramAlert(dev.TenantID, fmt.Sprintf("🔐 COMPLIANCE [%s] on %s: %s", v.Severity, dev.Name, v.Message))
			}
		}
		return BackupResult{Changed: false, BackupID: lastBackup.ID}
	}

	newBackup := models.ConfigBackup{
		TenantID:   dev.TenantID,
		DeviceID:   dev.ID,
		ConfigText: configText,
		Hash:       hash,
	}
	if err := database.DB.Create(&newBackup).Error; err != nil {
		return BackupResult{Err: fmt.Errorf("DB write: %w", err)}
	}

	if lastBackup.ID != 0 {
		go DispatchTelegramAlert(dev.TenantID, fmt.Sprintf("⚠️ CONFIGURATION CHANGED: Device %s running-config was modified (on-demand backup).", dev.Name))
	}

	violations := RunComplianceCheck(configText)
	for _, v := range violations {
		msg := fmt.Sprintf("🔐 COMPLIANCE [%s] on %s: %s", v.Severity, dev.Name, v.Message)
		if v.Severity == SeverityCritical {
			go DispatchTelegramAlert(dev.TenantID, msg)
		}
	}

	pruneOldBackups(dev.ID, backupRetentionCount())

	return BackupResult{Changed: true, BackupID: newBackup.ID}
}

// fetchDeviceConfig connects to dev via SSH or Telnet and retrieves the current
// running configuration. Extracted so BackupDeviceNow can reuse it without
// duplicating the full SSH/Telnet dialing logic.
func fetchDeviceConfig(dev models.Device) (string, error) {
	addr := fmt.Sprintf("%s:%d", dev.IP, dev.AuthPort)

	// Route by AuthProtocol (case-insensitive) — not by whether SSHUser is set.
	if strings.EqualFold(dev.AuthProtocol, "telnet") {
		return telnetFetchConfig(dev, addr)
	}

	// SSH path
	if dev.SSHUser == "" {
		return "", fmt.Errorf("no credentials configured for device %s", dev.IP)
	}

	cfg := &ssh.ClientConfig{
		User:            dev.SSHUser,
		Auth:            []ssh.AuthMethod{ssh.Password(dev.SSHPass)},
		HostKeyCallback: loadHostKeyCallback(),
		Timeout:         15 * time.Second,
	}
	client, err := ssh.Dial("tcp", addr, cfg)
	if err != nil {
		return "", fmt.Errorf("SSH dial: %w", err)
	}
	defer client.Close()

	// Route vendors that need interactive shell through sshInteractiveExec.
	switch normalizeVendor(dev.Vendor) {
	case "Huawei", "H3C":
		client.Close() // sshShellExec opens its own client
		return sshShellExec(dev, "display current-configuration all")

	case "DanOS", "VyOS", "Ruijie":
		client.Close() // sshInteractiveExec opens its own client
		vc := vendorSSHConfig(normalizeVendor(dev.Vendor))
		if vc == nil {
			return "", fmt.Errorf("no interactive config for vendor %s", dev.Vendor)
		}
		return sshInteractiveExec(dev, vc)

	default:
		// MikroTik, Cisco, Juniper, ZTE, generic — exec-channel works fine.
		session, err := client.NewSession()
		if err != nil {
			return "", fmt.Errorf("session: %w", err)
		}
		defer session.Close()

		cmd := "show running-config"
		switch normalizeVendor(dev.Vendor) {
		case "Juniper":
			cmd = "show configuration | display set | no-more"
		case "MikroTik":
			cmd = "/export compact"
		}

		var b bytes.Buffer
		session.Stdout = &b
		if err := session.Run(cmd); err != nil {
			return "", fmt.Errorf("run %q: %w", cmd, err)
		}
		return b.String(), nil
	}
}

// telnetFetchConfig performs a vendor-aware Telnet login + config retrieval.
// Extracted so both runConfigBackup and fetchDeviceConfig share one path.
func telnetFetchConfig(dev models.Device, addr string) (string, error) {
	log.Printf("[ConfigBackup] Dialing Telnet to %s", addr)
	t, err := telnet.Dial("tcp", addr)
	if err != nil {
		return "", fmt.Errorf("telnet dial %s: %w", addr, err)
	}
	defer t.Close()

	// Standard login sequence (works for Cisco, ZTE, Huawei, etc.)
	t.SetUnixWriteMode(true)
	t.SkipUntil("ame:") // "Username:", "name:"
	t.Write([]byte(dev.SSHUser + "\n"))
	t.SkipUntil("ord:") // "Password:", "word:"
	t.Write([]byte(dev.SSHPass + "\n"))

	// Vendor-specific paging disable + show command.
	var pagingCmd, showCmd, promptEnd string
	switch normalizeVendor(dev.Vendor) {
	case "Huawei", "H3C":
		pagingCmd = "screen-length 0 temporary"
		showCmd = "display current-configuration all"
		promptEnd = "]"
	case "ZTE":
		pagingCmd = "terminal length 0"
		showCmd = "show running-config"
		promptEnd = "#" // ZTE ZXROS privileged prompt ends with '#'
	default: // Cisco and generic
		pagingCmd = "terminal length 0"
		showCmd = "show running-config"
		promptEnd = ">"
	}

	t.SkipUntil(promptEnd) // wait for post-login prompt
	t.Write([]byte(pagingCmd + "\n"))
	t.SkipUntil(promptEnd)
	t.Write([]byte(showCmd + "\n"))

	data, _ := t.ReadUntil(promptEnd)
	return string(data), nil
}
