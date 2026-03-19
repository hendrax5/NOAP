package models

import "gorm.io/gorm"

// BackupEvent records the outcome of each automated or on-demand config backup
// attempt so that operators can review recent successes and failures in the UI.
type BackupEvent struct {
	gorm.Model
	TenantID uint   `json:"tenant_id" gorm:"not null;index"`
	DeviceID uint   `json:"device_id" gorm:"not null;index"`
	Status   string `json:"status"`  // "success" or "failed"
	Message  string `json:"message"` // error detail or "OK"
}
