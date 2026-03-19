package handlers

import (
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/hendrax5/noap/database"
	"github.com/hendrax5/noap/models"
	"golang.org/x/crypto/bcrypt"
)

// ── helpers ──────────────────────────────────────────────────────────────────

func jwtSecret() []byte {
	s := os.Getenv("JWT_SECRET")
	if s == "" {
		panic("FATAL: JWT_SECRET environment variable is not set")
	}
	return []byte(s)
}

func makeToken(userID, tenantID uint, role string, dur time.Duration) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id":   userID,
		"tenant_id": tenantID,
		"role":      role,
		"exp":       time.Now().Add(dur).Unix(),
		"iat":       time.Now().Unix(),
	})
	return token.SignedString(jwtSecret())
}

// ── Login ────────────────────────────────────────────────────────────────────

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func Login(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil || req.Email == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	var user models.User
	if err := database.DB.Where("email = ?", req.Email).First(&user).Error; err != nil {
		// Consistent timing — don't reveal whether user exists
		bcrypt.CompareHashAndPassword([]byte("$2a$10$dummy"), []byte(req.Password)) //nolint
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid credentials"})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid credentials"})
	}

	// Access token: 8h
	accessToken, err := makeToken(user.ID, user.TenantID, user.Role, 8*time.Hour)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Could not generate token"})
	}

	// Refresh token: 7d (longer lived, for /auth/refresh only)
	refreshToken, err := makeToken(user.ID, user.TenantID, user.Role, 7*24*time.Hour)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Could not generate refresh token"})
	}

	return c.JSON(fiber.Map{
		"access_token":  accessToken,
		"refresh_token": refreshToken,
		"expires_in":    8 * 3600, // seconds
		"tenant_id":     user.TenantID,
		"role":          user.Role,
	})
}

// ── Refresh ───────────────────────────────────────────────────────────────────

type RefreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

// Refresh issues a new access token using a valid refresh token.
// POST /api/v1/auth/refresh — public endpoint (no auth middleware).
func Refresh(c *fiber.Ctx) error {
	var req RefreshRequest
	if err := c.BodyParser(&req); err != nil || req.RefreshToken == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "refresh_token required"})
	}

	token, err := jwt.Parse(req.RefreshToken,
		func(t *jwt.Token) (interface{}, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fiber.ErrUnauthorized
			}
			return jwtSecret(), nil
		},
		jwt.WithValidMethods([]string{"HS256"}),
	)
	if err != nil || !token.Valid {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid or expired refresh token"})
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid token claims"})
	}

	userID := uint(claims["user_id"].(float64))
	tenantID := uint(claims["tenant_id"].(float64))
	role := claims["role"].(string)

	newAccess, err := makeToken(userID, tenantID, role, 8*time.Hour)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Could not generate token"})
	}

	return c.JSON(fiber.Map{
		"access_token": newAccess,
		"expires_in":   8 * 3600,
	})
}

// ── Register (bootstrap-only) ─────────────────────────────────────────────────

// Register creates the first super-admin tenant.
// Protected by X-Bootstrap-Key header matching BOOTSTRAP_KEY env var.
// Once a super_admin exists, this endpoint returns 403 permanently.
func Register(c *fiber.Ctx) error {
	// S2: require bootstrap key
	bootstrapKey := os.Getenv("BOOTSTRAP_KEY")
	if bootstrapKey == "" {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Registration disabled"})
	}
	if c.Get("X-Bootstrap-Key") != bootstrapKey {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Invalid bootstrap key"})
	}

	// Prevent second bootstrap — if any super_admin exists, deny
	var count int64
	database.DB.Model(&models.User{}).Where("role = ?", "super_admin").Count(&count)
	if count > 0 {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Bootstrap already completed"})
	}

	type RegReq struct {
		TenantName string `json:"tenant_name"`
		Email      string `json:"email"`
		Password   string `json:"password"`
	}
	var req RegReq
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}
	if req.TenantName == "" || req.Email == "" || len(req.Password) < 12 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "tenant_name, email required; password min 12 chars"})
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal error"})
	}

	tenant := models.Tenant{Name: req.TenantName}
	if err := database.DB.Create(&tenant).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Could not create tenant"})
	}

	user := models.User{
		TenantID: tenant.ID,
		Email:    req.Email,
		Password: string(hash),
		Role:     "super_admin",
	}
	if err := database.DB.Create(&user).Error; err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "User already exists"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"message":   "Bootstrap complete. Store your bootstrap key securely.",
		"tenant_id": tenant.ID,
		"role":      "super_admin",
	})
}
