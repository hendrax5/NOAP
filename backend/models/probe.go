package models

import "gorm.io/gorm"

type Probe struct {
	gorm.Model
	TenantID uint   `json:"tenant_id" gorm:"not null"`
	Name     string `json:"name" gorm:"not null"`
	Type     string `json:"type" gorm:"not null"` // HTTP, TCP, DNS
	Target   string `json:"target" gorm:"not null"`
	Interval int    `json:"interval" gorm:"default:60"` // in seconds
	Tenant   Tenant `json:"-" gorm:"foreignKey:TenantID"`
}
