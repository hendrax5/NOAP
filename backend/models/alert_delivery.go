package models

import (
	"time"

	"gorm.io/gorm"
)

// AlertDelivery is the persistent audit log for every alert delivery attempt.
// One row per channel per alert. Failed deliveries after max retries are stored
// with Status = "dlq" (dead-letter queue).
type AlertDelivery struct {
	gorm.Model
	TenantID   uint      `json:"tenant_id"    gorm:"index"`
	Channel    string    `json:"channel"`      // "telegram" | "email" | "webhook"
	Severity   string    `json:"severity"`     // "critical" | "warning" | "info"
	DeviceName string    `json:"device_name"`
	Message    string    `json:"message"       gorm:"type:text"`
	Status     string    `json:"status"`       // "sent" | "failed" | "dlq"
	Attempts   int       `json:"attempts"`
	Error      string    `json:"error,omitempty" gorm:"type:text"`
	SentAt     time.Time `json:"sent_at"`
}
