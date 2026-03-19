package workers

import (
	"regexp"
	"strings"
)

// Severity levels for compliance violations.
const (
	SeverityCritical = "CRITICAL"
	SeverityWarn     = "WARN"
)

// ComplianceRule describes a single compliance check against a device config.
type ComplianceRule struct {
	// Pattern is a regular expression matched (case-insensitive) against the full
	// config text. A match means the rule is VIOLATED.
	Pattern  *regexp.Regexp
	Severity string
	Message  string
}

// Violation is a single compliance hit returned by RunComplianceCheck.
type Violation struct {
	Severity string
	Message  string
}

// DefaultComplianceRules is the built-in ruleset applied to all device backups.
// Patterns are intentionally broad to catch both IOS-XE and VRP syntax variants.
var DefaultComplianceRules = []ComplianceRule{
	// ── Insecure protocols ─────────────────────────────────────────────────
	{
		Pattern:  regexp.MustCompile(`(?i)^\s*(telnet\s+enable|telnet\s+server\s+enable)`),
		Severity: SeverityCritical,
		Message:  "Telnet server is enabled — replace with SSH",
	},
	{
		Pattern:  regexp.MustCompile(`(?i)^\s*transport\s+input\s+(all|telnet)\b`),
		Severity: SeverityCritical,
		Message:  "VTY line accepts Telnet — restrict to SSH only",
	},
	{
		Pattern:  regexp.MustCompile(`(?i)^\s*no\s+service\s+password-encryption`),
		Severity: SeverityCritical,
		Message:  "Password encryption is disabled — passwords stored in plaintext",
	},
	{
		Pattern:  regexp.MustCompile(`(?i)^\s*http\s+server\s+enable`),
		Severity: SeverityWarn,
		Message:  "HTTP (unsecured) management server is enabled — use HTTPS",
	},
	// ── Weak / default SNMP communities ──────────────────────────────────
	{
		Pattern:  regexp.MustCompile(`(?i)\bsnmp-server\s+community\s+public\b`),
		Severity: SeverityCritical,
		Message:  "Default SNMP community 'public' detected — change immediately",
	},
	{
		Pattern:  regexp.MustCompile(`(?i)\bsnmp-server\s+community\s+private\b`),
		Severity: SeverityCritical,
		Message:  "Default SNMP community 'private' detected — change immediately",
	},
	{
		Pattern:  regexp.MustCompile(`(?i)\bsnmp-agent\s+community\s+(public|private)\b`),
		Severity: SeverityCritical,
		Message:  "Default SNMP community (public/private) detected on Huawei device",
	},
	{
		Pattern:  regexp.MustCompile(`(?i)\bsnmp-server\s+community\s+\S+\s+RW\b`),
		Severity: SeverityWarn,
		Message:  "SNMP read-write community detected — prefer SNMP v3 with authPriv",
	},
	// ── Authentication & access ───────────────────────────────────────────
	{
		Pattern:  regexp.MustCompile(`(?i)^\s*no\s+(ip\s+)?ssh`),
		Severity: SeverityCritical,
		Message:  "SSH is disabled — no secure remote access",
	},
	{
		Pattern:  regexp.MustCompile(`(?i)^\s*enable\s+password\s+\S`),
		Severity: SeverityCritical,
		Message:  "Enable password set without MD5/SHA hashing — use 'enable secret'",
	},
	{
		Pattern:  regexp.MustCompile(`(?i)^\s*username\s+\S+\s+password\s+(0\s+)?[^\s]`),
		Severity: SeverityWarn,
		Message:  "Plaintext username password detected — use 'secret' keyword",
	},
	// ── NTP ────────────────────────────────────────────────────────────────
	{
		Pattern:  regexp.MustCompile(`(?i)^\s*no\s+ntp`),
		Severity: SeverityWarn,
		Message:  "NTP is disabled — time sync required for accurate logging and certificates",
	},
	// ── Logging ────────────────────────────────────────────────────────────
	{
		Pattern:  regexp.MustCompile(`(?i)^\s*no\s+logging`),
		Severity: SeverityWarn,
		Message:  "Logging is disabled — event visibility impaired",
	},
}

// RunComplianceCheck scans configText against DefaultComplianceRules and
// returns all violations found. Each line of the config is checked individually
// and the full text is also matched as a block for multi-line patterns.
func RunComplianceCheck(configText string) []Violation {
	var violations []Violation
	lines := strings.Split(configText, "\n")

	for _, rule := range DefaultComplianceRules {
		violated := false
		// Line-by-line match (most rules are single-line).
		for _, line := range lines {
			if rule.Pattern.MatchString(line) {
				violated = true
				break
			}
		}
		if violated {
			violations = append(violations, Violation{
				Severity: rule.Severity,
				Message:  rule.Message,
			})
		}
	}
	return violations
}
