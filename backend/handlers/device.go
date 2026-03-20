package handlers

import (
	"fmt"
	"io"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gosnmp/gosnmp"
	"github.com/hendrax5/noap/database"
	"github.com/hendrax5/noap/middleware"
	"github.com/hendrax5/noap/models"
	"github.com/hendrax5/noap/services"
)

func GetDevices(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	var devices []models.Device
	database.DB.Where("tenant_id = ?", tenantID).Find(&devices)
	return c.JSON(devices)
}

func CreateDevice(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	var dev models.Device
	if err := c.BodyParser(&dev); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}
	dev.TenantID = tenantID
	if err := database.DB.Create(&dev).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create device"})
	}
	return c.Status(fiber.StatusCreated).JSON(dev)
}

func UpdateDevice(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	id := c.Params("id")

	var dev models.Device
	if err := database.DB.Where("id = ? AND tenant_id = ?", id, tenantID).First(&dev).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Device not found"})
	}

	if err := c.BodyParser(&dev); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}

	database.DB.Save(&dev)
	return c.JSON(dev)
}

func DeleteDevice(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	id := c.Params("id")

	var dev models.Device
	if err := database.DB.Where("id = ? AND tenant_id = ?", id, tenantID).First(&dev).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Device not found"})
	}

	database.DB.Delete(&dev)
	return c.SendStatus(fiber.StatusNoContent)
}

func DiscoverInterfaces(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	id := c.Params("id")

	var dev models.Device
	if err := database.DB.Where("id = ? AND tenant_id = ?", id, tenantID).First(&dev).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Device not found"})
	}

	params := &gosnmp.GoSNMP{
		Target:    dev.IP,
		Port:      161,
		Community: dev.SNMPComm,
		Version:   gosnmp.Version2c,
		Timeout:   time.Duration(3) * time.Second,
		Retries:   1,
		Logger:    gosnmp.NewLogger(log.New(io.Discard, "", 0)),
	}

	if err := params.Connect(); err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": fmt.Sprintf("SNMP connect failed: %v", err)})
	}
	defer params.Conn.Close()

	discoveredCount := services.RunInterfaceDiscovery(params, dev)
	return c.JSON(fiber.Map{"message": fmt.Sprintf("Discovered %d interfaces", discoveredCount)})
}

func GetInterfaces(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	id := c.Params("id")

	var dev models.Device
	if err := database.DB.Where("id = ? AND tenant_id = ?", id, tenantID).First(&dev).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Device not found"})
	}

	var interfaces []models.DeviceInterface
	database.DB.Where("device_id = ?", dev.ID).Order("if_index asc").Find(&interfaces)
	return c.JSON(interfaces)
}

func ToggleInterfaceMonitoring(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	deviceID := c.Params("id")
	ifIndex := c.Params("if_index")

	var dev models.Device
	if err := database.DB.Where("id = ? AND tenant_id = ?", deviceID, tenantID).First(&dev).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Device not found"})
	}

	var intf models.DeviceInterface
	if err := database.DB.Where("device_id = ? AND if_index = ?", dev.ID, ifIndex).First(&intf).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Interface not found"})
	}

	type ToggleRequest struct {
		IsMonitored bool `json:"is_monitored"`
	}
	var req ToggleRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}

	intf.IsMonitored = req.IsMonitored
	database.DB.Save(&intf)
	return c.JSON(intf)
}

func CreateInterface(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	deviceID := c.Params("id")

	var dev models.Device
	if err := database.DB.Where("id = ? AND tenant_id = ?", deviceID, tenantID).First(&dev).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Device not found"})
	}

	type CreateRequest struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		IfIndex     int    `json:"if_index"`
		Status      string `json:"status"`
		IsMonitored bool   `json:"is_monitored"`
	}
	var req CreateRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}

	if req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Port name is required"})
	}

	if req.IfIndex == 0 {
		var maxIdx int
		database.DB.Model(&models.DeviceInterface{}).Where("device_id = ?", dev.ID).Select("COALESCE(MAX(if_index), 0)").Scan(&maxIdx)
		req.IfIndex = maxIdx + 1
	}

	var existing models.DeviceInterface
	if err := database.DB.Where("device_id = ? AND if_index = ?", dev.ID, req.IfIndex).First(&existing).Error; err == nil {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": fmt.Sprintf("Interface with if_index %d already exists", req.IfIndex)})
	}

	status := req.Status
	if status == "" {
		status = "up"
	}

	intf := models.DeviceInterface{
		DeviceID:    dev.ID,
		IfIndex:     req.IfIndex,
		Name:        req.Name,
		Description: req.Description,
		Status:      status,
		IsMonitored: req.IsMonitored,
	}

	database.DB.Create(&intf)
	return c.Status(fiber.StatusCreated).JSON(intf)
}

func DeleteInterface(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	deviceID := c.Params("id")
	ifIndex := c.Params("if_index")

	var dev models.Device
	if err := database.DB.Where("id = ? AND tenant_id = ?", deviceID, tenantID).First(&dev).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Device not found"})
	}

	var intf models.DeviceInterface
	if err := database.DB.Where("device_id = ? AND if_index = ?", dev.ID, ifIndex).First(&intf).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Interface not found"})
	}

	database.DB.Delete(&intf)
	return c.SendStatus(fiber.StatusNoContent)
}

// UpdateDeviceThresholds updates only the alerting threshold fields for a device.
// Send zero for any field to revert it to the global default.
// PUT /api/v1/devices/:id/thresholds
func UpdateDeviceThresholds(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	id := c.Params("id")

	var dev models.Device
	if err := database.DB.Where("id = ? AND tenant_id = ?", id, tenantID).First(&dev).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Device not found"})
	}

	var body struct {
		CPUThreshold           *float32 `json:"cpu_threshold"`
		MemThreshold           *float32 `json:"mem_threshold"`
		LatencyThresholdMs     *float32 `json:"latency_threshold_ms"`
		PacketLossThresholdPct *float32 `json:"packet_loss_threshold_pct"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	updates := map[string]interface{}{}
	if body.CPUThreshold != nil {
		updates["cpu_threshold"] = *body.CPUThreshold
	}
	if body.MemThreshold != nil {
		updates["mem_threshold"] = *body.MemThreshold
	}
	if body.LatencyThresholdMs != nil {
		updates["latency_threshold_ms"] = *body.LatencyThresholdMs
	}
	if body.PacketLossThresholdPct != nil {
		updates["packet_loss_threshold_pct"] = *body.PacketLossThresholdPct
	}

	if len(updates) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "No threshold fields provided"})
	}

	if err := database.DB.Model(&dev).Updates(updates).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to update thresholds"})
	}

	// Return the updated device so the UI can refresh immediately
	database.DB.First(&dev, dev.ID)
	return c.JSON(dev)
}

// UpdateDeviceSchedule updates the backup schedule fields for a device.
// PUT /api/v1/devices/:id/schedule
func UpdateDeviceSchedule(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	id := c.Params("id")

	var dev models.Device
	if err := database.DB.Where("id = ? AND tenant_id = ?", id, tenantID).First(&dev).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Device not found"})
	}

	var body struct {
		BackupEnabled     *bool `json:"backup_enabled"`
		BackupIntervalMin *int  `json:"backup_interval_min"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	// Allowed intervals in minutes (match frontend dropdown options).
	allowedIntervals := map[int]bool{60: true, 240: true, 720: true, 1440: true, 4320: true, 10080: true}

	updates := map[string]interface{}{}
	if body.BackupEnabled != nil {
		updates["backup_enabled"] = *body.BackupEnabled
	}
	if body.BackupIntervalMin != nil {
		if !allowedIntervals[*body.BackupIntervalMin] {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid backup_interval_min. Allowed: 60, 240, 720, 1440, 4320, 10080",
			})
		}
		updates["backup_interval_min"] = *body.BackupIntervalMin
	}

	if len(updates) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "No schedule fields provided"})
	}

	if err := database.DB.Model(&dev).Updates(updates).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to update schedule"})
	}

	database.DB.First(&dev, dev.ID)
	return c.JSON(dev)
}
