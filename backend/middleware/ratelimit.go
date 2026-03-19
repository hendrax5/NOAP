package middleware

import (
	"fmt"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/limiter"
)

// AuthRateLimit applies a strict rate limit for auth endpoints:
// 10 requests per minute per IP. Protects against brute-force login.
func AuthRateLimit() fiber.Handler {
	return limiter.New(limiter.Config{
		Max:        10,
		Expiration: 1 * time.Minute,
		KeyGenerator: func(c *fiber.Ctx) string {
			return c.IP()
		},
		LimitReached: func(c *fiber.Ctx) error {
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
				"error":       "Too many requests. Please try again in 1 minute.",
				"retry_after": 60,
			})
		},
	})
}

// APIRateLimit applies a per-tenant rate limit for protected API endpoints.
// 600 requests per minute per tenant — high enough for a NOC dashboard that
// makes 10+ parallel calls per auto-refresh cycle across multiple open tabs,
// while still protecting against runaway clients or scraping.
func APIRateLimit() fiber.Handler {
	return limiter.New(limiter.Config{
		Max:        600,
		Expiration: 1 * time.Minute,
		KeyGenerator: func(c *fiber.Ctx) string {
			if tid := TenantID(c); tid != 0 {
				return fmt.Sprintf("tenant:%d", tid)
			}
			return c.IP()
		},
		LimitReached: func(c *fiber.Ctx) error {
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
				"error":       "Rate limit exceeded. Max 600 requests per minute.",
				"retry_after": 60,
			})
		},
	})
}
