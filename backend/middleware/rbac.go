package middleware

import (
	"slices"

	"github.com/gofiber/fiber/v2"
)

// Role constants
const (
	RoleSuperAdmin = "super_admin"
	RoleAdmin      = "admin"
	RoleOperator   = "operator"
	RoleViewer     = "viewer"
)

// RequireRole returns a middleware that allows only the specified roles.
// Must be used AFTER Protected() middleware (needs role in Locals).
//
// Usage:
//
//	protected.Delete("/devices/:id", middleware.RequireRole(RoleAdmin, RoleSuperAdmin), handlers.DeleteDevice)
func RequireRole(allowedRoles ...string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		role := Role(c)
		if role == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
		}
		if !slices.Contains(allowedRoles, role) {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"error":         "Insufficient permissions",
				"required_role": allowedRoles,
				"your_role":     role,
			})
		}
		return c.Next()
	}
}

// RequireAdmin is shorthand for RequireRole("admin", "super_admin").
func RequireAdmin() fiber.Handler {
	return RequireRole(RoleAdmin, RoleSuperAdmin)
}

// RequireOperator is shorthand for RequireRole("operator", "admin", "super_admin").
func RequireOperator() fiber.Handler {
	return RequireRole(RoleOperator, RoleAdmin, RoleSuperAdmin)
}

// RequireSuperAdmin is shorthand for RequireRole("super_admin").
func RequireSuperAdmin() fiber.Handler {
	return RequireRole(RoleSuperAdmin)
}
