package models

import "gorm.io/gorm"

type Tenant struct {
	gorm.Model
	Name             string `json:"name" gorm:"unique;not null"`

	// ── Telegram channel ──
	TelegramBotToken string `json:"telegram_bot_token"`
	TelegramChatID   string `json:"telegram_chat_id"`

	// ── Email (SMTP) channel ──
	SmtpHost     string `json:"smtp_host"`
	SmtpPort     int    `json:"smtp_port"`
	SmtpUser     string `json:"smtp_user"`
	SmtpPass     string `json:"smtp_pass"`
	SmtpFrom     string `json:"smtp_from"`
	AlertEmailTo string `json:"alert_email_to"` // comma-separated recipients

	// ── Webhook channel ──
	WebhookURL    string `json:"webhook_url"`
	WebhookSecret string `json:"webhook_secret"` // HMAC-SHA256 signing key
}
