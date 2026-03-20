package models

import (
	"time"
	"gorm.io/gorm"
)

type Device struct {
	gorm.Model
	TenantID       uint      `json:"tenant_id" gorm:"not null"`
	Name           string    `json:"name" gorm:"not null"`
	IP             string    `json:"ip" gorm:"not null"`
	Vendor         string    `json:"vendor"`
	SNMPComm       string    `json:"snmp_comm"`
	SSHUser        string    `json:"ssh_user"`
	SSHPass        string    `json:"ssh_pass"`
	AuthProtocol   string    `json:"auth_protocol" gorm:"default:'SSH'"`
	AuthPort       int       `json:"auth_port" gorm:"default:22"`
	PollInterval   int       `json:"poll_interval" gorm:"default:300"`
	LastSNMPStatus string    `json:"last_snmp_status" gorm:"default:'unknown'"`
	LastCLIStatus  string    `json:"last_cli_status" gorm:"default:'unknown'"`
	Status         string    `json:"status" gorm:"default:'unknown'"`
	LastSeen       time.Time `json:"last_seen"`
	AutoDiscover   bool      `json:"auto_discover" gorm:"default:false"`
	Tenant         Tenant    `json:"-" gorm:"foreignKey:TenantID"`

	// Alert thresholds — 0 means "use global default".
	CPUThreshold          float32 `json:"cpu_threshold" gorm:"default:0"`
	MemThreshold          float32 `json:"mem_threshold" gorm:"default:0"`
	LatencyThresholdMs    float32 `json:"latency_threshold_ms" gorm:"default:0"`
	PacketLossThresholdPct float32 `json:"packet_loss_threshold_pct" gorm:"default:0"`
	BandwidthWarnMbps     float32 `json:"bandwidth_warn_mbps" gorm:"default:0"`

	// Backup schedule — per-device control over automated config backups.
	BackupEnabled     bool       `json:"backup_enabled" gorm:"default:true"`
	BackupIntervalMin int        `json:"backup_interval_min" gorm:"default:1440"`
	LastBackupAt      *time.Time `json:"last_backup_at"`
}

type DeviceInterface struct {
	gorm.Model
	DeviceID    uint   `json:"device_id" gorm:"not null"`
	IfIndex     int    `json:"if_index" gorm:"not null"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Status      string `json:"status"`
	IsMonitored bool   `json:"is_monitored" gorm:"default:false"`
	Device      Device `json:"-" gorm:"foreignKey:DeviceID"`
}

type Link struct {
	gorm.Model
	TenantID       uint   `json:"tenant_id" gorm:"not null"`
	SourceDeviceID uint   `json:"source_device_id" gorm:"not null"`
	TargetDeviceID uint   `json:"target_device_id" gorm:"not null"`
	SourcePort     string `json:"source_port"`
	TargetPort     string `json:"target_port"`
	Protocol       string `json:"protocol" gorm:"default:'LLDP'"`
}

type ConfigBackup struct {
	gorm.Model
	TenantID   uint   `json:"tenant_id" gorm:"not null;index"`
	DeviceID   uint   `json:"device_id" gorm:"not null;index"`
	ConfigText string `json:"config_text" gorm:"type:text"`
	Hash       string `json:"hash"`
}
