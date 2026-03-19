package middleware

import (
	"fmt"
	"net"
	"strings"

	"github.com/gofiber/fiber/v2"
)

// ValidateCreateDevice validates POST /devices body fields.
// Returns 400 with field-level error messages on failure.
func ValidateCreateDevice(c *fiber.Ctx) error {
	type body struct {
		Name      string `json:"name"`
		IPAddress string `json:"ip"`
		Community string `json:"snmp_comm"`
	}
	var b body
	if err := c.BodyParser(&b); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid JSON body"})
	}

	var errs []string

	b.Name = strings.TrimSpace(b.Name)
	if b.Name == "" {
		errs = append(errs, "name is required")
	} else if len(b.Name) > 128 {
		errs = append(errs, "name must be ≤ 128 characters")
	} else if containsSQLSpecials(b.Name) {
		errs = append(errs, "name contains invalid characters")
	}

	if net.ParseIP(b.IPAddress) == nil {
		errs = append(errs, fmt.Sprintf("ip_address '%s' is not a valid IP address", b.IPAddress))
	}

	if len(b.Community) > 64 {
		errs = append(errs, "snmp_community must be ≤ 64 characters")
	}

	if len(errs) > 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":  "Validation failed",
			"fields": errs,
		})
	}
	return c.Next()
}

// ValidateCreateProbe validates POST /probes body fields.
func ValidateCreateProbe(c *fiber.Ctx) error {
	type body struct {
		Type     string `json:"type"`
		Target   string `json:"target"`
		Interval int    `json:"interval"`
	}
	var b body
	if err := c.BodyParser(&b); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid JSON body"})
	}

	var errs []string

	allowed := map[string]bool{"icmp": true, "http": true, "tcp": true, "dns": true}
	if !allowed[strings.ToLower(b.Type)] {
		errs = append(errs, "type must be one of: icmp, http, tcp, dns")
	}

	if strings.TrimSpace(b.Target) == "" {
		errs = append(errs, "target is required")
	} else if len(b.Target) > 253 {
		errs = append(errs, "target must be ≤ 253 characters")
	}

	if b.Interval < 5 || b.Interval > 3600 {
		errs = append(errs, "interval must be between 5 and 3600 seconds")
	}

	if len(errs) > 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":  "Validation failed",
			"fields": errs,
		})
	}
	return c.Next()
}

// containsSQLSpecials returns true if s contains characters commonly used in SQL injection.
func containsSQLSpecials(s string) bool {
	for _, r := range s {
		switch r {
		case '\'', '"', ';', '/', '*', '\\':
			return true
		}
	}
	return false
}
