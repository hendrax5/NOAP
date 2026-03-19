package models

// AlertJob is a pending alert notification dispatched to all configured channels.
// Defined in models so both services and workers can reference it without
// creating an import cycle (workers/snmp.go imports services).
type AlertJob struct {
	TenantID   uint
	DeviceName string
	DeviceIP   string
	Severity   string // "critical", "warning", "info"
	MetricType string // "icmp", "cpu", "mem", "link_down", "optical", ...
	Message    string
}
