package middleware

import (
	"fmt"
	"os"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
)

// jwtSecret returns the JWT secret from env, panics at startup if missing.
func jwtSecret() []byte {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		panic("FATAL: JWT_SECRET environment variable is not set")
	}
	return []byte(secret)
}

// Protected validates Bearer JWT and populates Locals: user_id, tenant_id, role.
func Protected() fiber.Handler {
	secret := jwtSecret() // resolved once at startup — panics if missing

	return func(c *fiber.Ctx) error {
		authHeader := c.Get("Authorization")
		if len(authHeader) < 8 || authHeader[:7] != "Bearer " {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
		}

		tokenString := authHeader[7:]

		token, err := jwt.Parse(tokenString,
			func(t *jwt.Token) (interface{}, error) {
				// S7: reject any algorithm other than HS256 (algorithm confusion fix)
				if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
					return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
				}
				return secret, nil
			},
			jwt.WithValidMethods([]string{"HS256"}),
		)

		if err != nil || !token.Valid {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid token"})
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid token claims"})
		}

		// S8: safe extraction — no panic on unexpected type
		c.Locals("user_id", safeUint(claims["user_id"]))
		c.Locals("tenant_id", safeUint(claims["tenant_id"]))
		c.Locals("role", safeString(claims["role"]))

		return c.Next()
	}
}

// TenantID safely extracts the tenant_id uint from Locals.
// Returns 0 if not set (caller should treat 0 as unauthorized).
func TenantID(c *fiber.Ctx) uint {
	if v, ok := c.Locals("tenant_id").(uint); ok {
		return v
	}
	return 0
}

// UserID safely extracts the user_id uint from Locals.
func UserID(c *fiber.Ctx) uint {
	if v, ok := c.Locals("user_id").(uint); ok {
		return v
	}
	return 0
}

// Role safely extracts the role string from Locals.
func Role(c *fiber.Ctx) string {
	if v, ok := c.Locals("role").(string); ok {
		return v
	}
	return ""
}

// safeUint converts JWT numeric claim (float64) to uint without panic.
func safeUint(v interface{}) uint {
	switch x := v.(type) {
	case float64:
		return uint(x)
	case uint:
		return x
	}
	return 0
}

// safeString converts JWT string claim safely.
func safeString(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
