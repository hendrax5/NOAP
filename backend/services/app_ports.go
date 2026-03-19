package services

import "fmt"

// wellKnownPorts maps dst_port → application label.
// Priority: dst_port lookup first; src_port lookup second.
var wellKnownPorts = map[uint16]string{
	// Web
	80:   "HTTP",
	443:  "HTTPS",
	8080: "HTTP-Alt",
	8443: "HTTPS-Alt",
	// DNS
	53: "DNS",
	// Email
	25:  "SMTP",
	465: "SMTPS",
	587: "SMTP-Submit",
	110: "POP3",
	995: "POP3S",
	143: "IMAP",
	993: "IMAPS",
	// SSH / Remote
	22:   "SSH",
	23:   "Telnet",
	3389: "RDP",
	5900: "VNC",
	// File transfer
	21:  "FTP",
	20:  "FTP-Data",
	69:  "TFTP",
	990: "FTPS",
	// Database
	3306: "MySQL",
	5432: "PostgreSQL",
	1433: "MSSQL",
	1521: "Oracle",
	6379: "Redis",
	5672: "AMQP",
	// Streaming / Media
	1935: "RTMP",
	554:  "RTSP",
	3478: "STUN",
	// Monitoring / Network
	161: "SNMP",
	162: "SNMP-Trap",
	514: "Syslog",
	123: "NTP",
	179: "BGP",
	// VPN / Tunnelling
	500:  "IKE",
	4500: "IPsec-NAT",
	1194: "OpenVPN",
	51820: "WireGuard",
	// Kubernetes / Cloud
	6443: "k8s-API",
	2376: "Docker",
	2379: "etcd",
}

// MapApplication returns a human-readable application name for the given
// destination port and protocol. Returns "Other" when no match is found.
func MapApplication(dstPort, srcPort uint16, proto string) string {
	// ICMP has no port concept
	if proto == "ICMP" {
		return "ICMP"
	}
	if name, ok := wellKnownPorts[dstPort]; ok {
		return name
	}
	if name, ok := wellKnownPorts[srcPort]; ok {
		return name
	}
	// Classify ephemeral port ranges as "Other"
	if dstPort >= 49152 && srcPort >= 49152 {
		return fmt.Sprintf("%s-Ephemeral", proto)
	}
	return "Other"
}
