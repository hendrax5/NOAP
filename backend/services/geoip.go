package services

import (
	"log"
	"net"
	"os"
	"sync"

	"github.com/oschwald/maxminddb-golang"
)

// ─────────────────────────────────────────────────────────────────────────────
// GeoIP / ASN enrichment via MaxMind MMDB databases.
//
// Set GEOIP_CITY_DB and GEOIP_ASN_DB environment variables to the absolute
// paths of GeoLite2-City.mmdb and GeoLite2-ASN.mmdb respectively.
//
// If the files are not present, geo lookups return empty GeoInfo and ASN
// lookups fall back to the static table in asn.go.
// ─────────────────────────────────────────────────────────────────────────────

// GeoInfo holds GeoIP enrichment data for a single IP.
type GeoInfo struct {
	Country string
	City    string
	Lat     float64
	Lon     float64
}

// mmdb shared state — initialised once at startup.
var (
	cityDB     *maxminddb.Reader
	asnDB      *maxminddb.Reader
	geoOnce    sync.Once
	geoEnabled bool
)

// mmdbCityRecord matches the GeoLite2-City MMDB structure.
type mmdbCityRecord struct {
	Country struct {
		ISOCode string `maxminddb:"iso_code"`
	} `maxminddb:"country"`
	City struct {
		Names map[string]string `maxminddb:"names"`
	} `maxminddb:"city"`
	Location struct {
		Latitude  float64 `maxminddb:"latitude"`
		Longitude float64 `maxminddb:"longitude"`
	} `maxminddb:"location"`
}

// mmdbASNRecord matches the GeoLite2-ASN MMDB structure.
type mmdbASNRecord struct {
	AutonomousSystemNumber       uint32 `maxminddb:"autonomous_system_number"`
	AutonomousSystemOrganization string `maxminddb:"autonomous_system_organization"`
}

// InitGeoIP opens the MMDB files. Call once at startup (e.g. from main or init).
// Safe to call even if files don't exist — will log a warning and proceed
// without geo enrichment.
func InitGeoIP() {
	geoOnce.Do(func() {
		cityPath := os.Getenv("GEOIP_CITY_DB")
		asnPath := os.Getenv("GEOIP_ASN_DB")

		if cityPath == "" && asnPath == "" {
			log.Println("[GeoIP] no MMDB paths configured — geo enrichment disabled (set GEOIP_CITY_DB / GEOIP_ASN_DB)")
			return
		}

		var err error
		if cityPath != "" {
			cityDB, err = maxminddb.Open(cityPath)
			if err != nil {
				log.Printf("[GeoIP] failed to open city DB %s: %v", cityPath, err)
				cityDB = nil
			} else {
				log.Printf("[GeoIP] loaded city DB: %s", cityPath)
			}
		}

		if asnPath != "" {
			asnDB, err = maxminddb.Open(asnPath)
			if err != nil {
				log.Printf("[GeoIP] failed to open ASN DB %s: %v", asnPath, err)
				asnDB = nil
			} else {
				log.Printf("[GeoIP] loaded ASN DB: %s", asnPath)
			}
		}

		geoEnabled = cityDB != nil || asnDB != nil
	})
}

// GeoIPEnabled reports whether at least one MMDB is loaded.
func GeoIPEnabled() bool { return geoEnabled }

// LookupGeoIP returns geographic info for the given IP string.
// Returns zero-value GeoInfo if MMDB is not loaded or lookup fails.
func LookupGeoIP(ipStr string) GeoInfo {
	if cityDB == nil {
		return GeoInfo{}
	}
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return GeoInfo{}
	}

	var rec mmdbCityRecord
	if err := cityDB.Lookup(ip, &rec); err != nil {
		return GeoInfo{}
	}

	city := rec.City.Names["en"] // English name
	return GeoInfo{
		Country: rec.Country.ISOCode,
		City:    city,
		Lat:     rec.Location.Latitude,
		Lon:     rec.Location.Longitude,
	}
}

// LookupASNFromMMDB looks up ASN info using the MaxMind MMDB file.
// Returns (ASNInfo, true) on success, or (zero, false) if MMDB is unavailable.
func LookupASNFromMMDB(ipStr string) (ASNInfo, bool) {
	if asnDB == nil {
		return ASNInfo{}, false
	}
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return ASNInfo{}, false
	}

	var rec mmdbASNRecord
	if err := asnDB.Lookup(ip, &rec); err != nil {
		return ASNInfo{}, false
	}

	return ASNInfo{
		ASN:  rec.AutonomousSystemNumber,
		Name: rec.AutonomousSystemOrganization,
	}, true
}
