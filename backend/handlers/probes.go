package handlers

import (
	"context"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/hendrax5/noap/database"
	"github.com/hendrax5/noap/middleware"
	"github.com/hendrax5/noap/models"
)

func GetProbes(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	var probes []models.Probe
	database.DB.Where("tenant_id = ?", tenantID).Find(&probes)
	return c.JSON(probes)
}

func CreateProbe(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	var p models.Probe
	if err := c.BodyParser(&p); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}
	p.TenantID = tenantID
	if err := database.DB.Create(&p).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create probe"})
	}
	return c.Status(fiber.StatusCreated).JSON(p)
}

func GetSLAMetrics(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	probeID := c.QueryInt("probe_id")

	if database.CH == nil {
		var mockResults []map[string]interface{}
		now := time.Now().Unix() * 1000
		for i := 60; i >= 0; i-- {
			ts := int64(now) - int64(i*60000)
			rsp := float32(40 + (ts % 20))
			uptime := 100.0
			if i == 5 && probeID%2 != 0 {
				uptime = 0.0
				rsp = 5000.0
			}
			mockResults = append(mockResults, map[string]interface{}{"ts": ts, "response_ms": rsp, "uptime": uptime})
		}
		return c.JSON(mockResults)
	}

	query := `SELECT toUnixTimestamp(timestamp) * 1000 as ts, response_ms, status FROM metrics_sla WHERE tenant_id = ? AND probe_id = ? ORDER BY timestamp DESC LIMIT 60`
	rows, err := database.CH.Query(context.Background(), query, uint32(tenantID), uint32(probeID))
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	defer rows.Close()

	var results []map[string]interface{}
	for rows.Next() {
		var ts uint64
		var rsp float32
		var stat string
		if err := rows.Scan(&ts, &rsp, &stat); err == nil {
			uptime := 100.0
			if stat == "DOWN" {
				uptime = 0.0
			}
			results = append(results, map[string]interface{}{"ts": ts, "response_ms": rsp, "uptime": uptime})
		}
	}
	for i, j := 0, len(results)-1; i < j; i, j = i+1, j-1 {
		results[i], results[j] = results[j], results[i]
	}
	return c.JSON(results)
}
