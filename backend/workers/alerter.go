package workers

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/smtp"
	"strings"
	"sync"
	"time"

	"github.com/hendrax5/noap/database"
	"github.com/hendrax5/noap/models"
)

// ────────────────────────────────────────────────────────────────────────────
// AlertChannel / AlertWorker
// ────────────────────────────────────────────────────────────────────────────

// AlertChannel is the shared inbound queue typed as models.AlertJob.
// Buffer of 512 prevents blocking in high-volume syslog/trap bursts.
var AlertChannel = make(chan models.AlertJob, 512)

// StartAlertWorker starts the background consumer that drains AlertChannel.
// Call once from main().
func StartAlertWorker() {
	log.Println("[AlertWorker] started – draining alert channel")
	go func() {
		for job := range AlertChannel {
			dispatchToAllChannels(job)
		}
	}()
}

// ────────────────────────────────────────────────────────────────────────────
// Cooldown deduplication
// ────────────────────────────────────────────────────────────────────────────

var alertCooldowns sync.Map

func cooldownFor(metricType string) time.Duration {
	switch metricType {
	case "icmp":
		return 5 * time.Minute
	case "cpu":
		return 10 * time.Minute
	case "mem":
		return 10 * time.Minute
	case "link_down":
		return 5 * time.Minute
	case "optical":
		return 15 * time.Minute
	case "optical_degrade":
		return 15 * time.Minute
	default:
		return 10 * time.Minute
	}
}

func clearAlertState(key string) {
	alertCooldowns.Delete(key)
}

func thresholdOr(devVal, globalDefault float32) float32 {
	if devVal > 0 {
		return devVal
	}
	return globalDefault
}

// ────────────────────────────────────────────────────────────────────────────
// checkAlerts — threshold evaluation → push enriched AlertJob
// ────────────────────────────────────────────────────────────────────────────

func checkAlerts(dev models.Device, metricType string, val1, val2 float32) {
	var alertMsg string
	var severity string
	shouldAlert := false

	cpuThreshold := thresholdOr(dev.CPUThreshold, 80)
	memThreshold := thresholdOr(dev.MemThreshold, 85)
	latencyMs := thresholdOr(dev.LatencyThresholdMs, 150)
	pktLossPct := thresholdOr(dev.PacketLossThresholdPct, 20)

	alertKey := fmt.Sprintf("%d:%d:%s:%.0f", dev.TenantID, dev.ID, metricType, val2)

	switch metricType {
	case "icmp":
		if val2 > pktLossPct {
			alertMsg = fmt.Sprintf("🔴 <b>CRITICAL – Packet Loss</b>\nDevice: <b>%s</b> (%s)\nPacket Loss: <b>%.1f%%</b>", dev.Name, dev.IP, val2)
			severity = "critical"
			shouldAlert = true
		} else if val1 > latencyMs {
			alertMsg = fmt.Sprintf("🟠 <b>WARNING – High Latency</b>\nDevice: <b>%s</b> (%s)\nLatency: <b>%.1f ms</b>", dev.Name, dev.IP, val1)
			severity = "warning"
			shouldAlert = true
		} else {
			clearAlertState(alertKey)
		}

	case "cpu":
		if val1 > cpuThreshold {
			alertMsg = fmt.Sprintf("🔴 <b>HIGH CPU</b>\nDevice: <b>%s</b> (%s)\nCPU Utilization: <b>%.1f%%</b>", dev.Name, dev.IP, val1)
			severity = "critical"
			shouldAlert = true
		} else {
			clearAlertState(alertKey)
		}

	case "mem":
		if val1 > memThreshold {
			alertMsg = fmt.Sprintf("🟠 <b>HIGH MEMORY</b>\nDevice: <b>%s</b> (%s)\nMemory Utilization: <b>%.1f%%</b>", dev.Name, dev.IP, val1)
			severity = "warning"
			shouldAlert = true
		} else {
			clearAlertState(alertKey)
		}

	case "link_down":
		alertMsg = fmt.Sprintf("🔴 <b>LINK DOWN</b>\nDevice: <b>%s</b> (%s)\nInterface IfIndex: <b>%.0f</b> is DOWN", dev.Name, dev.IP, val2)
		severity = "critical"
		shouldAlert = true

	case "optical":
		alertMsg = fmt.Sprintf("🔴 <b>CRITICAL – Low Optical Power</b>\nDevice: <b>%s</b> (%s)\nPort IfIndex <b>%.0f</b>: Rx Power = <b>%.2f dBm</b>\n⚠️ Impending link failure!", dev.Name, dev.IP, val2, val1)
		severity = "critical"
		shouldAlert = true

	case "optical_degrade":
		alertMsg = fmt.Sprintf("🟠 <b>WARNING – Optical Degradation</b>\nDevice: <b>%s</b> (%s)\nPort IfIndex <b>%.0f</b>: Rx Power dropped ≥ 1 dBm → now <b>%.2f dBm</b>\nInspect fiber immediately.", dev.Name, dev.IP, val2, val1)
		severity = "warning"
		shouldAlert = true
	}

	if !shouldAlert {
		return
	}

	// ── Cooldown check ──
	cooldown := cooldownFor(metricType)
	now := time.Now()
	if lastSent, ok := alertCooldowns.Load(alertKey); ok {
		elapsed := now.Sub(lastSent.(time.Time))
		if elapsed < cooldown {
			log.Printf("[Alerter] suppressed: %s alert for device %s (cooldown %v remaining)",
				metricType, dev.Name, cooldown-elapsed)
			return
		}
	}

	alertCooldowns.Store(alertKey, now)

	log.Println("[Alerter] ALERT TRIGGERED:", alertMsg)

	// Push enriched job to the channel; worker handles fan-out + retry
	AlertChannel <- models.AlertJob{
		TenantID:   dev.TenantID,
		DeviceName: dev.Name,
		DeviceIP:   dev.IP,
		Severity:   severity,
		MetricType: metricType,
		Message:    alertMsg,
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Retry helpers
// ────────────────────────────────────────────────────────────────────────────

const maxRetries = 3

// dispatchWithRetry calls fn up to maxRetries times with exponential backoff.
// Returns the last error if all attempts fail.
func dispatchWithRetry(fn func() error) (int, error) {
	var err error
	for attempt := 1; attempt <= maxRetries; attempt++ {
		err = fn()
		if err == nil {
			return attempt, nil
		}
		if attempt < maxRetries {
			backoff := time.Duration(1<<uint(attempt)) * time.Second // 2s, 4s
			log.Printf("[Alerter] retry %d/%d failed, backing off %v: %v", attempt, maxRetries, backoff, err)
			time.Sleep(backoff)
		}
	}
	return maxRetries, err
}

// logDelivery persists an AlertDelivery row to the database.
func logDelivery(tenantID uint, channel, severity, deviceName, message, status string, attempts int, errMsg string) {
	record := models.AlertDelivery{
		TenantID:   tenantID,
		Channel:    channel,
		Severity:   severity,
		DeviceName: deviceName,
		Message:    message,
		Status:     status,
		Attempts:   attempts,
		Error:      errMsg,
		SentAt:     time.Now(),
	}
	if err := database.DB.Create(&record).Error; err != nil {
		log.Printf("[Alerter] failed to log delivery: %v", err)
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Fan-out dispatcher
// ────────────────────────────────────────────────────────────────────────────

func dispatchToAllChannels(job models.AlertJob) {
	var tenant models.Tenant
	if err := database.DB.First(&tenant, job.TenantID).Error; err != nil {
		log.Println("[Alerter] Could not find tenant config for alerting:", err)
		return
	}

	// ── Telegram ──
	if tenant.TelegramBotToken != "" && tenant.TelegramChatID != "" {
		attempts, err := dispatchWithRetry(func() error {
			return sendTelegram(tenant.TelegramBotToken, tenant.TelegramChatID, job.Message)
		})
		if err != nil {
			log.Printf("[Alerter] ❌ Telegram DLQ for tenant %d after %d attempts: %v", job.TenantID, attempts, err)
			logDelivery(job.TenantID, "telegram", job.Severity, job.DeviceName, job.Message, "dlq", attempts, err.Error())
		} else {
			log.Printf("[Alerter] ✅ Telegram alert sent to chat %s for tenant %d", tenant.TelegramChatID, job.TenantID)
			logDelivery(job.TenantID, "telegram", job.Severity, job.DeviceName, job.Message, "sent", attempts, "")
		}
	}

	// ── Email ──
	if tenant.SmtpHost != "" && tenant.AlertEmailTo != "" {
		attempts, err := dispatchWithRetry(func() error {
			return sendEmail(tenant, job)
		})
		if err != nil {
			log.Printf("[Alerter] ❌ Email DLQ for tenant %d after %d attempts: %v", job.TenantID, attempts, err)
			logDelivery(job.TenantID, "email", job.Severity, job.DeviceName, job.Message, "dlq", attempts, err.Error())
		} else {
			log.Printf("[Alerter] ✅ Email alert sent to %s for tenant %d", tenant.AlertEmailTo, job.TenantID)
			logDelivery(job.TenantID, "email", job.Severity, job.DeviceName, job.Message, "sent", attempts, "")
		}
	}

	// ── Webhook ──
	if tenant.WebhookURL != "" {
		attempts, err := dispatchWithRetry(func() error {
			return sendWebhook(tenant, job)
		})
		if err != nil {
			log.Printf("[Alerter] ❌ Webhook DLQ for tenant %d after %d attempts: %v", job.TenantID, attempts, err)
			logDelivery(job.TenantID, "webhook", job.Severity, job.DeviceName, job.Message, "dlq", attempts, err.Error())
		} else {
			log.Printf("[Alerter] ✅ Webhook alert sent to %s for tenant %d", tenant.WebhookURL, job.TenantID)
			logDelivery(job.TenantID, "webhook", job.Severity, job.DeviceName, job.Message, "sent", attempts, "")
		}
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Channel implementations
// ────────────────────────────────────────────────────────────────────────────

// ── Telegram ──

type telegramPayload struct {
	ChatID    string `json:"chat_id"`
	Text      string `json:"text"`
	ParseMode string `json:"parse_mode"`
}

func sendTelegram(botToken, chatID, message string) error {
	payload := telegramPayload{
		ChatID:    chatID,
		Text:      message,
		ParseMode: "HTML",
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", botToken)
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(url, "application/json", bytes.NewBuffer(body))
	if err != nil {
		return fmt.Errorf("http post: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("telegram API returned %d", resp.StatusCode)
	}
	return nil
}

// ── Email (SMTP) ──

func sendEmail(tenant models.Tenant, job models.AlertJob) error {
	recipients := strings.Split(tenant.AlertEmailTo, ",")
	for i := range recipients {
		recipients[i] = strings.TrimSpace(recipients[i])
	}

	subject := fmt.Sprintf("[NOAP %s] %s – %s", strings.ToUpper(job.Severity), job.MetricType, job.DeviceName)

	// Plain-text email body (strip HTML tags from the Telegram-formatted message)
	plainMsg := strings.NewReplacer("<b>", "", "</b>", "").Replace(job.Message)

	msg := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s\r\n",
		tenant.SmtpFrom,
		strings.Join(recipients, ", "),
		subject,
		plainMsg,
	)

	addr := fmt.Sprintf("%s:%d", tenant.SmtpHost, tenant.SmtpPort)

	var auth smtp.Auth
	if tenant.SmtpUser != "" {
		auth = smtp.PlainAuth("", tenant.SmtpUser, tenant.SmtpPass, tenant.SmtpHost)
	}

	err := smtp.SendMail(addr, auth, tenant.SmtpFrom, recipients, []byte(msg))
	if err != nil {
		return fmt.Errorf("smtp send: %w", err)
	}
	return nil
}

// ── Webhook ──

type webhookPayload struct {
	TenantID   uint   `json:"tenant_id"`
	Severity   string `json:"severity"`
	MetricType string `json:"metric_type"`
	DeviceName string `json:"device_name"`
	DeviceIP   string `json:"device_ip"`
	Message    string `json:"message"`
	Timestamp  string `json:"timestamp"`
}

func sendWebhook(tenant models.Tenant, job models.AlertJob) error {
	payload := webhookPayload{
		TenantID:   job.TenantID,
		Severity:   job.Severity,
		MetricType: job.MetricType,
		DeviceName: job.DeviceName,
		DeviceIP:   job.DeviceIP,
		Message:    job.Message,
		Timestamp:  time.Now().UTC().Format(time.RFC3339),
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	req, err := http.NewRequest("POST", tenant.WebhookURL, bytes.NewBuffer(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "NOAP-Alerter/1.0")

	// HMAC-SHA256 signature if secret is configured
	if tenant.WebhookSecret != "" {
		mac := hmac.New(sha256.New, []byte(tenant.WebhookSecret))
		mac.Write(body)
		sig := hex.EncodeToString(mac.Sum(nil))
		req.Header.Set("X-Signature", sig)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("http post: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("webhook returned %d", resp.StatusCode)
	}
	return nil
}

// ────────────────────────────────────────────────────────────────────────────
// Legacy compat — DispatchTelegramAlert keeps existing callers working.
// ────────────────────────────────────────────────────────────────────────────

func DispatchTelegramAlert(tenantID uint, message string) {
	AlertChannel <- models.AlertJob{
		TenantID: tenantID,
		Severity: "info",
		Message:  message,
	}
}
