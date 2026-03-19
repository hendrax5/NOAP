package handlers

import (
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/hendrax5/noap/database"
	"github.com/hendrax5/noap/middleware"
	"github.com/hendrax5/noap/models"
)

func GetTenants(c *fiber.Ctx) error {
	var tenants []models.Tenant
	database.DB.Find(&tenants)
	return c.JSON(tenants)
}

// UpdateTenantSettings accepts the full notification config payload.
func UpdateTenantSettings(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	var tenant models.Tenant
	if err := database.DB.First(&tenant, tenantID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Tenant not found"})
	}

	type SettingsReq struct {
		TelegramBotToken string `json:"telegram_bot_token"`
		TelegramChatID   string `json:"telegram_chat_id"`
		SmtpHost         string `json:"smtp_host"`
		SmtpPort         int    `json:"smtp_port"`
		SmtpUser         string `json:"smtp_user"`
		SmtpPass         string `json:"smtp_pass"`
		SmtpFrom         string `json:"smtp_from"`
		AlertEmailTo     string `json:"alert_email_to"`
		WebhookURL       string `json:"webhook_url"`
		WebhookSecret    string `json:"webhook_secret"`
	}
	var req SettingsReq
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}

	// ── Apply fields ──
	tenant.TelegramBotToken = req.TelegramBotToken
	tenant.TelegramChatID = req.TelegramChatID
	tenant.SmtpHost = req.SmtpHost
	tenant.SmtpPort = req.SmtpPort
	tenant.SmtpUser = req.SmtpUser
	// Only update password if not the masked placeholder
	if req.SmtpPass != "" && req.SmtpPass != "••••••••" {
		tenant.SmtpPass = req.SmtpPass
	}
	tenant.SmtpFrom = req.SmtpFrom
	tenant.AlertEmailTo = req.AlertEmailTo
	tenant.WebhookURL = req.WebhookURL
	if req.WebhookSecret != "" && req.WebhookSecret != "••••••••" {
		tenant.WebhookSecret = req.WebhookSecret
	}

	database.DB.Save(&tenant)

	return c.JSON(fiber.Map{"message": "Settings updated", "tenant": maskSecrets(tenant)})
}

// GetTenantSettings returns tenant config with secrets masked.
func GetTenantSettings(c *fiber.Ctx) error {
	tenantID := middleware.TenantID(c)
	if tenantID == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}
	var tenant models.Tenant
	if err := database.DB.First(&tenant, tenantID).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Tenant not found"})
	}
	return c.JSON(maskSecrets(tenant))
}

// maskSecrets replaces sensitive fields with placeholders.
func maskSecrets(t models.Tenant) models.Tenant {
	if t.TelegramBotToken != "" {
		t.TelegramBotToken = maskStr(t.TelegramBotToken, 6)
	}
	if t.SmtpPass != "" {
		t.SmtpPass = "••••••••"
	}
	if t.WebhookSecret != "" {
		t.WebhookSecret = "••••••••"
	}
	return t
}

// maskStr shows the last `show` chars and masks the rest.
func maskStr(s string, show int) string {
	if len(s) <= show {
		return strings.Repeat("•", len(s))
	}
	return strings.Repeat("•", len(s)-show) + s[len(s)-show:]
}
