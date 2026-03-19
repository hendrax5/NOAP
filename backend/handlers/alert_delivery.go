package handlers

import (
	"strconv"

	"github.com/gofiber/fiber/v2"
	"github.com/hendrax5/noap/database"
	"github.com/hendrax5/noap/middleware"
	"github.com/hendrax5/noap/models"
)

// GetAlertDeliveries returns the delivery audit log for the current tenant.
// Supports optional query parameters: ?channel=telegram&status=dlq&limit=50&offset=0
func GetAlertDeliveries(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	channel := c.Query("channel")
	status := c.Query("status")
	limitStr := c.Query("limit", "50")
	offsetStr := c.Query("offset", "0")

	limit, _ := strconv.Atoi(limitStr)
	offset, _ := strconv.Atoi(offsetStr)
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}

	q := database.DB.Where("tenant_id = ?", tenantID).Order("created_at DESC")
	if channel != "" {
		q = q.Where("channel = ?", channel)
	}
	if status != "" {
		q = q.Where("status = ?", status)
	}

	var total int64
	q.Model(&models.AlertDelivery{}).Count(&total)

	var deliveries []models.AlertDelivery
	q.Limit(limit).Offset(offset).Find(&deliveries)

	return c.JSON(fiber.Map{
		"total":      total,
		"limit":      limit,
		"offset":     offset,
		"deliveries": deliveries,
	})
}
