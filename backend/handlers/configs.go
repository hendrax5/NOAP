package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/hendrax5/noap/database"
	"github.com/hendrax5/noap/middleware"
	"github.com/hendrax5/noap/models"
	"github.com/hendrax5/noap/workers"
)

func GetDeviceConfigs(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	deviceID, err := c.ParamsInt("deviceId")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid device ID"})
	}

	// Verify device belongs to tenant
	var dev models.Device
	if err := database.DB.Where("id = ? AND tenant_id = ?", deviceID, tenantID).First(&dev).Error; err != nil {
		return c.Status(403).JSON(fiber.Map{"error": "Unauthorized or device not found"})
	}

	var backups []models.ConfigBackup
	database.DB.Where("device_id = ?", deviceID).Order("created_at desc").Limit(10).Find(&backups)

	return c.JSON(backups)
}

func GetConfigDiff(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	deviceID, _ := c.ParamsInt("deviceId")
	baseBackupID, err := c.ParamsInt("baseId")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid base backup ID"})
	}

	var latest models.ConfigBackup
	database.DB.Where("device_id = ? AND tenant_id = ?", deviceID, tenantID).Order("created_at desc").First(&latest)

	var base models.ConfigBackup
	if err := database.DB.Where("id = ? AND tenant_id = ?", baseBackupID, tenantID).First(&base).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Historic base config not found"})
	}

	return c.JSON(fiber.Map{
		"base_id":     base.ID,
		"base_text":   base.ConfigText,
		"latest_id":   latest.ID,
		"latest_text": latest.ConfigText,
	})
}

// RollbackConfig is a mock endpoint intended to push the base back to the device via SSH
func RollbackConfig(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	deviceID, _ := c.ParamsInt("deviceId")
	targetBackupID, _ := c.ParamsInt("targetId")

	var target models.ConfigBackup
	if err := database.DB.Where("id = ? AND tenant_id = ?", targetBackupID, tenantID).First(&target).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Historic config not found"})
	}

	// In production -> Initiate SSH session, apply config line by line.
	// For now, duplicate it as the newest entry in DB
	newBackup := models.ConfigBackup{
		TenantID:   tenantID,
		DeviceID:   uint(deviceID),
		ConfigText: target.ConfigText,
		Hash:       target.Hash,
	}
	database.DB.Create(&newBackup)

	return c.JSON(fiber.Map{"status": "success", "message": "Config rolled back successfully", "target_id": newBackup.ID})
}

// TriggerBackup starts an asynchronous on-demand config backup for a single
// device and returns 202 immediately. The frontend should poll
// GET /configs/:deviceId/backup/status to track completion.
// Route: POST /api/v1/configs/:deviceId/backup  (operator+)
func TriggerBackup(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	deviceID, err := c.ParamsInt("deviceId")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid device ID"})
	}

	var dev models.Device
	if err := database.DB.Where("id = ? AND tenant_id = ?", deviceID, tenantID).First(&dev).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Device not found or unauthorized"})
	}

	job, startErr := workers.StartBackupJob(dev)
	if startErr != nil {
		// Already running — return current job status instead of error.
		return c.Status(409).JSON(fiber.Map{
			"status":  job.Status,
			"message": "Backup already in progress for this device",
		})
	}

	return c.Status(202).JSON(fiber.Map{
		"status":  "running",
		"message": "Backup started — poll GET /configs/:deviceId/backup/status for result",
	})
}

// GetBackupStatus returns the current or most recent backup job status for a device.
// Route: GET /api/v1/configs/:deviceId/backup/status  (operator+)
func GetBackupStatus(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	deviceID, err := c.ParamsInt("deviceId")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid device ID"})
	}

	// Verify this device belongs to the caller's tenant.
	var dev models.Device
	if err := database.DB.Where("id = ? AND tenant_id = ?", deviceID, tenantID).First(&dev).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Device not found or unauthorized"})
	}

	job := workers.GetBackupJob(uint(deviceID))
	if job == nil {
		return c.JSON(fiber.Map{"status": "idle", "message": "No backup job found for this device"})
	}

	return c.JSON(job)
}
