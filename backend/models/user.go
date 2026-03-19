package models

import "gorm.io/gorm"

type User struct {
	gorm.Model
	TenantID uint   `json:"tenant_id" gorm:"not null"`
	Email    string `json:"email" gorm:"unique;not null"`
	Password string `json:"-" gorm:"not null"`
	Role     string `json:"role" gorm:"default:'admin'"`
	Tenant   Tenant `json:"tenant" gorm:"foreignKey:TenantID"`
}
