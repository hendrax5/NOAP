package handlers

import (
	"context"
	"fmt"

	"github.com/gofiber/fiber/v2"
	"github.com/hendrax5/noap/database"
	"github.com/hendrax5/noap/middleware"
)

// GetSyslogEvents returns paginated syslog events from ClickHouse for the current tenant.
// Query params: limit (int, max 500), severity (string), device_id (int), search (string)
func GetSyslogEvents(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	limit := c.QueryInt("limit", 100)
	if limit > 500 {
		limit = 500
	}
	severity := c.Query("severity", "")
	deviceID := c.QueryInt("device_id", 0)
	search := c.Query("search", "")

	where := "WHERE tenant_id = ?"
	args := []interface{}{uint32(tenantID)}

	if severity != "" {
		where += " AND severity = ?"
		args = append(args, severity)
	}
	if deviceID > 0 {
		where += " AND device_id = ?"
		args = append(args, uint32(deviceID))
	}
	if search != "" {
		where += " AND message ILIKE ?"
		args = append(args, "%"+search+"%")
	}

	query := fmt.Sprintf(
		`SELECT toUnixTimestamp(timestamp)*1000 as ts, device_id, severity, facility, message, type
		 FROM events_syslog
		 %s
		 ORDER BY timestamp DESC
		 LIMIT ?`,
		where,
	)
	args = append(args, limit)

	rows, err := database.CH.Query(context.Background(), query, args...)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	defer rows.Close()

	type SyslogEvent struct {
		Ts       uint64 `json:"ts"`
		DeviceID uint32 `json:"device_id"`
		Severity string `json:"severity"`
		Facility string `json:"facility"`
		Message  string `json:"message"`
		Type     string `json:"type"`
	}

	var results []SyslogEvent
	for rows.Next() {
		var e SyslogEvent
		if err := rows.Scan(&e.Ts, &e.DeviceID, &e.Severity, &e.Facility, &e.Message, &e.Type); err == nil {
			results = append(results, e)
		}
	}

	if results == nil {
		results = []SyslogEvent{}
	}
	return c.JSON(results)
}

// GetTrapEvents returns paginated SNMP trap events from ClickHouse.
// Query params: limit (int, max 500), device_id (int)
func GetTrapEvents(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	limit := c.QueryInt("limit", 100)
	if limit > 500 {
		limit = 500
	}
	deviceID := c.QueryInt("device_id", 0)

	where := "WHERE tenant_id = ? AND type = 'trap'"
	args := []interface{}{uint32(tenantID)}

	if deviceID > 0 {
		where += " AND device_id = ?"
		args = append(args, uint32(deviceID))
	}

	query := fmt.Sprintf(
		`SELECT toUnixTimestamp(timestamp)*1000 as ts, device_id, severity, facility, message, type
		 FROM events_syslog
		 %s
		 ORDER BY timestamp DESC
		 LIMIT ?`,
		where,
	)
	args = append(args, limit)

	rows, err := database.CH.Query(context.Background(), query, args...)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	defer rows.Close()

	type TrapEvent struct {
		Ts       uint64 `json:"ts"`
		DeviceID uint32 `json:"device_id"`
		Severity string `json:"severity"`
		Facility string `json:"facility"`
		Message  string `json:"message"`
		Type     string `json:"type"`
	}

	var results []TrapEvent
	for rows.Next() {
		var e TrapEvent
		if err := rows.Scan(&e.Ts, &e.DeviceID, &e.Severity, &e.Facility, &e.Message, &e.Type); err == nil {
			results = append(results, e)
		}
	}

	if results == nil {
		results = []TrapEvent{}
	}
	return c.JSON(results)
}
