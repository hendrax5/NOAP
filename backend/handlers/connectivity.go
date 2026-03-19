package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/hendrax5/noap/database"
	"github.com/hendrax5/noap/middleware"
	"github.com/hendrax5/noap/models"
	"github.com/hendrax5/noap/workers"
)

// TestDeviceConnectivity performs on-demand SNMP, SSH, and Telnet probes
// against a single device and returns per-protocol results.
func TestDeviceConnectivity(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	id := c.Params("id")

	var dev models.Device
	if err := database.DB.Where("id = ? AND tenant_id = ?", id, tenantID).First(&dev).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Device not found"})
	}

	result := workers.TestDeviceConnectivity(dev)
	return c.JSON(result)
}

// GetBackupEvents returns recent backup events for a device (newest first).
func GetBackupEvents(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	id := c.Params("id")

	// Verify device exists and belongs to tenant
	var dev models.Device
	if err := database.DB.Where("id = ? AND tenant_id = ?", id, tenantID).First(&dev).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Device not found"})
	}

	var events []models.BackupEvent
	database.DB.
		Where("device_id = ? AND tenant_id = ?", dev.ID, tenantID).
		Order("created_at desc").
		Limit(50).
		Find(&events)

	return c.JSON(events)
}
