package main

import (
	"log"
	"os"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/hendrax5/noap/database"
	"github.com/hendrax5/noap/handlers"
	"github.com/hendrax5/noap/middleware"
	"github.com/hendrax5/noap/models"
	"github.com/hendrax5/noap/services"
	"github.com/hendrax5/noap/workers"
)

func main() {
	// S1: fail fast if JWT_SECRET is missing — never allow plain-text fallback
	if os.Getenv("JWT_SECRET") == "" {
		log.Fatal("FATAL: JWT_SECRET environment variable must be set")
	}

	if os.Getenv("DB_HOST") != "" {
		database.ConnectDB()
	}

	// Run DB migrations BEFORE starting workers so tables always exist
	// when the initial backup/poll run fires.
	database.DB.AutoMigrate(
		&models.Tenant{},
		&models.User{},
		&models.Device{},
		&models.Probe{},
		&models.Link{},
		&models.ConfigBackup{},
		&models.DeviceInterface{},
		&models.AlertDelivery{},
	)

	if os.Getenv("CH_HOST") != "" {
		database.ConnectClickHouse()
		go workers.StartICMPPoller()
		go workers.StartSNMPPoller()
	}

	// Phase 2 workers
	go workers.StartSLAProbes()
	go services.StartSyslogListener()
	go services.StartSNMPTrapListener()

	// Phase 3 workers — Alerting + BGP + MPLS
	services.AlertDispatch = workers.AlertChannel
	workers.StartAlertWorker()
	go workers.StartBGPPoller()
	go workers.StartMPLSPoller()

	// Phase 4 flow receivers — GoFlow2 multi-protocol (NetFlow v5/v9, IPFIX, sFlow)
	services.InitGeoIP() // load MaxMind MMDB databases (no-op if not configured)
	go services.StartGoFlow2Receiver()

	// Phase 5 Topology discovery
	go workers.StartTopologyPoller()

	// Phase 6 Configuration Automation
	go workers.StartConfigBackupWorker()

	app := fiber.New(fiber.Config{
		// Do not expose Go version / Fiber internals in error responses
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{"error": err.Error()})
		},
	})

	app.Use(recover.New())
	app.Use(logger.New())

	// S3: CORS from env var — no wildcard in production
	allowedOrigins := os.Getenv("CORS_ORIGINS")
	if allowedOrigins == "" {
		allowedOrigins = "http://localhost:3000"
	}
	app.Use(cors.New(cors.Config{
		AllowOrigins: strings.TrimSpace(allowedOrigins),
		AllowHeaders: "Origin, Content-Type, Accept, Authorization, X-Bootstrap-Key",
		AllowMethods: "GET,POST,PUT,DELETE,OPTIONS",
	}))

	// Health — public, no auth
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok", "service": "NOAP Backend"})
	})

	api := app.Group("/api/v1")
	api.Get("/ping", func(c *fiber.Ctx) error { return c.SendString("pong") })

	// ── Auth routes (public, rate-limited) ──────────────────────────────────
	auth := api.Group("/auth", middleware.AuthRateLimit())
	auth.Post("/login", handlers.Login)
	auth.Post("/refresh", handlers.Refresh)
	auth.Post("/register", handlers.Register) // protected by X-Bootstrap-Key + once-only check

	// ── Protected routes (JWT required, API rate-limited) ───────────────────
	protected := api.Group("/", middleware.Protected(), middleware.APIRateLimit())

	// ── Tenant routes (admin+) ───────────────────────────────────────────────
	protected.Get("/tenants", middleware.RequireAdmin(), handlers.GetTenants)
	protected.Get("/tenant/settings", handlers.GetTenantSettings)
	protected.Put("/tenant/settings", middleware.RequireAdmin(), handlers.UpdateTenantSettings)
	protected.Get("/alert-deliveries", handlers.GetAlertDeliveries)

	// ── Device routes ────────────────────────────────────────────────────────
	protected.Get("/devices", handlers.GetDevices)                                                                               // viewer+
	protected.Post("/devices", middleware.RequireOperator(), middleware.ValidateCreateDevice, handlers.CreateDevice)            // operator+
	protected.Put("/devices/:id", middleware.RequireOperator(), handlers.UpdateDevice)                                           // operator+
	protected.Put("/devices/:id/thresholds", middleware.RequireOperator(), handlers.UpdateDeviceThresholds)                      // operator+
	protected.Put("/devices/:id/schedule", middleware.RequireOperator(), handlers.UpdateDeviceSchedule)                        // operator+
	protected.Delete("/devices/:id", middleware.RequireAdmin(), handlers.DeleteDevice)                                           // admin+
	protected.Post("/devices/:id/discover", middleware.RequireOperator(), handlers.DiscoverInterfaces)                           // operator+
	protected.Get("/devices/:id/interfaces", handlers.GetInterfaces)                                                             // viewer+
	protected.Put("/devices/:id/interfaces/:if_index", middleware.RequireOperator(), handlers.ToggleInterfaceMonitoring)         // operator+
	protected.Post("/devices/:id/interfaces", middleware.RequireOperator(), handlers.CreateInterface)                            // operator+
	protected.Delete("/devices/:id/interfaces/:if_index", middleware.RequireAdmin(), handlers.DeleteInterface)                   // admin+
	protected.Post("/devices/:id/test", middleware.RequireOperator(), handlers.TestDeviceConnectivity)                          // operator+
	protected.Get("/devices/:id/backup-events", handlers.GetBackupEvents)                                                      // viewer+

	// ── Probe routes ─────────────────────────────────────────────────────────
	protected.Get("/probes", handlers.GetProbes)                                    // viewer+
	protected.Post("/probes", middleware.RequireOperator(), middleware.ValidateCreateProbe, handlers.CreateProbe)              // operator+

	// ── Metrics routes (viewer+) ─────────────────────────────────────────────
	protected.Get("/metrics/dashboard", handlers.GetDashboardMetrics)
	protected.Get("/metrics/icmp", handlers.GetICMPMetrics)
	protected.Get("/metrics/system", handlers.GetSystemMetrics)
	protected.Get("/metrics/interfaces", handlers.GetInterfaceMetrics)
	protected.Get("/metrics/interfaces/sparklines", handlers.GetInterfaceTrafficSparklines)
	protected.Get("/metrics/optical/sparklines", handlers.GetOpticalTrafficSparklines)
	protected.Get("/metrics/sla", handlers.GetSLAMetrics)
	protected.Get("/metrics/bgp", handlers.GetBGPMetrics)
	protected.Get("/metrics/bgp/history", handlers.GetBGPHistory)                                  // peer prefix-count history
	protected.Get("/metrics/mpls", handlers.GetMPLSMetrics)
	protected.Get("/metrics/flows/top-talkers", handlers.GetTopTalkers)
	protected.Get("/metrics/flows/bandwidth", handlers.GetFlowBandwidth)
	protected.Get("/metrics/flows/timeseries", handlers.GetFlowTimeSeries) // P4
	protected.Get("/metrics/flows/apps", handlers.GetTopApplications)      // P4
	protected.Get("/metrics/flows/asns", handlers.GetTopASNs)              // P4
	protected.Get("/metrics/flows/geo", handlers.GetGeoFlows)              // P5 — geo map arcs
	protected.Get("/metrics/flows/sankey", handlers.GetSankeyFlows)        // P5 — sankey diagram
	protected.Get("/metrics/topology", handlers.GetTopologyMap)

	// ── Config / Automation routes ──────────────────────────────────────────
	protected.Get("/configs/:deviceId", handlers.GetDeviceConfigs)                                                         // viewer+
	protected.Get("/configs/:deviceId/diff/:baseId", handlers.GetConfigDiff)                                               // viewer+
	protected.Post("/configs/:deviceId/rollback/:targetId", middleware.RequireOperator(), handlers.RollbackConfig)          // operator+
	protected.Post("/configs/:deviceId/backup", middleware.RequireOperator(), handlers.TriggerBackup)                      // operator+ — on-demand backup (async)
	protected.Get("/configs/:deviceId/backup/status", middleware.RequireOperator(), handlers.GetBackupStatus)             // operator+ — poll backup job status

	// ── Events routes (viewer+) ─────────────────────────────────────────────
	protected.Get("/events/syslog", handlers.GetSyslogEvents)
	protected.Get("/events/traps", handlers.GetTrapEvents)

	// ── RCA routes (viewer+) ────────────────────────────────────────────────
	protected.Get("/rca/events", handlers.GetRCAEvents)

	port := os.Getenv("PORT")
	if port == "" {
		port = "4000"
	}
	log.Printf("Starting NOAP backend on :%s", port)
	log.Fatal(app.Listen(":" + port))
}
