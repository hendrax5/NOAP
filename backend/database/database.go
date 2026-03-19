package database

import (
	"log"
	"os"
	"time"

	"github.com/hendrax5/noap/models"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

func ConnectDB() {
	dsn := "host=" + os.Getenv("DB_HOST") + 
		" user=" + os.Getenv("DB_USER") + 
		" password=" + os.Getenv("DB_PASSWORD") + 
		" dbname=" + os.Getenv("DB_NAME") + 
		" port=" + os.Getenv("DB_PORT") + 
		" sslmode=disable"
	
	var db *gorm.DB
	var err error

	// Retry loop for db connection (to wait for Postgres if starting simultaneously)
	for i := 0; i < 5; i++ {
		db, err = gorm.Open(postgres.Open(dsn), &gorm.Config{
			Logger: logger.Default.LogMode(logger.Info),
		})
		if err == nil {
			break
		}
		log.Println("Waiting for database...")
		time.Sleep(2 * time.Second)
	}

	if err != nil {
		log.Fatal("Failed to connect to database. \n", err)
	}

	log.Println("Database connected")
	
	err = db.AutoMigrate(&models.Tenant{}, &models.User{}, &models.Device{}, &models.Probe{}, &models.DeviceInterface{}, &models.BackupEvent{})
	if err != nil {
		log.Fatal("Migration failed:", err)
	}
	
	log.Println("Database migrated")
	DB = db
}
