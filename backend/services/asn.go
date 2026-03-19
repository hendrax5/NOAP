package services

import (
	"encoding/binary"
	"net"
)

// ASNInfo holds the AS number and organisation name for an IP address.
type ASNInfo struct {
	ASN  uint32
	Name string
}

// asnEntry is one row in the static lookup table.
type asnEntry struct {
	prefix string
	bits   int
	asn    uint32
	name   string
}

// staticASNTable covers RFC-1918 private space and a representative set of
// well-known public networks. Production deployments should replace this with
// a MaxMind GeoLite2-ASN or RouteViews mmdb lookup.
var staticASNTable = []asnEntry{
	// ── Private / special ────────────────────────────────────────────────────
	{"10.0.0.0", 8, 0, "Private"},
	{"172.16.0.0", 12, 0, "Private"},
	{"192.168.0.0", 16, 0, "Private"},
	{"127.0.0.0", 8, 0, "Loopback"},
	{"169.254.0.0", 16, 0, "Link-Local"},
	// ── Google ───────────────────────────────────────────────────────────────
	{"8.8.8.0", 24, 15169, "Google"},
	{"8.8.4.0", 24, 15169, "Google"},
	{"34.0.0.0", 8, 15169, "Google"},
	{"35.190.0.0", 16, 15169, "Google"},
	{"74.125.0.0", 16, 15169, "Google"},
	// ── Cloudflare ───────────────────────────────────────────────────────────
	{"1.1.1.0", 24, 13335, "Cloudflare"},
	{"1.0.0.0", 24, 13335, "Cloudflare"},
	{"104.16.0.0", 12, 13335, "Cloudflare"},
	// ── Amazon / AWS ─────────────────────────────────────────────────────────
	{"52.0.0.0", 8, 16509, "Amazon AWS"},
	{"54.0.0.0", 8, 16509, "Amazon AWS"},
	{"18.0.0.0", 8, 16509, "Amazon AWS"},
	// ── Microsoft / Azure ────────────────────────────────────────────────────
	{"13.64.0.0", 12, 8075, "Microsoft Azure"},
	{"40.64.0.0", 10, 8075, "Microsoft Azure"},
	{"20.0.0.0", 8, 8075, "Microsoft Azure"},
	// ── Meta / Facebook ──────────────────────────────────────────────────────
	{"31.13.24.0", 21, 32934, "Meta"},
	{"157.240.0.0", 17, 32934, "Meta"},
	// ── Akamai ───────────────────────────────────────────────────────────────
	{"23.32.0.0", 11, 20940, "Akamai"},
	{"104.64.0.0", 10, 20940, "Akamai"},
	// ── Fastly ───────────────────────────────────────────────────────────────
	{"151.101.0.0", 16, 54113, "Fastly"},
}

// compiled entries — precomputed network + mask for fast lookup.
type compiledASN struct {
	net  uint32
	mask uint32
	info ASNInfo
}

var compiledTable []compiledASN

func init() {
	compiledTable = make([]compiledASN, 0, len(staticASNTable))
	for _, e := range staticASNTable {
		ip := net.ParseIP(e.prefix).To4()
		if ip == nil {
			continue
		}
		netInt := binary.BigEndian.Uint32(ip)
		mask := ^uint32(0) << (32 - e.bits)
		compiledTable = append(compiledTable, compiledASN{
			net:  netInt & mask,
			mask: mask,
			info: ASNInfo{ASN: e.asn, Name: e.name},
		})
	}
}

// LookupASN returns the ASNInfo for the given dotted-decimal IPv4 string.
// Tries MaxMind MMDB first; falls back to static table if MMDB unavailable.
func LookupASN(ipStr string) ASNInfo {
	// Prefer MMDB when loaded
	if info, ok := LookupASNFromMMDB(ipStr); ok && info.ASN != 0 {
		return info
	}

	// Static-table fallback
	ip := net.ParseIP(ipStr).To4()
	if ip == nil {
		return ASNInfo{0, "Unknown"}
	}
	ipInt := binary.BigEndian.Uint32(ip)
	for _, e := range compiledTable {
		if ipInt&e.mask == e.net {
			return e.info
		}
	}
	return ASNInfo{0, "Unknown"}
}
