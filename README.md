# NOAP — Network Observability & Automation Platform

Full-stack network monitoring platform with real-time dashboards, NetFlow analytics, SNMP polling, ICMP probes, BGP monitoring, configuration backup, alerting, and SLA tracking.

## Architecture

| Component | Tech | Port |
|-----------|------|------|
| Frontend | Next.js 14 / React / Tailwind | `3003` |
| Backend | Go (Gin) | `4000` |
| PostgreSQL | 15 Alpine | `5432` |
| ClickHouse | Latest | `8123` / `9000` |
| NATS | Latest | `4222` |
| NetFlow Collector | UDP (Go) | `2055/udp` |

## Quick Start

```bash
git clone <repo-url> && cd NOAP
docker compose up -d --build
```

Open **http://localhost:3003** and bootstrap your first tenant using the key set in `BOOTSTRAP_KEY`.

---

## NetFlow Configuration Guide

NOAP listens on **UDP port 2055** for **NetFlow v5** packets. Below are vendor-specific configurations.

> **Important:** Replace `<NOAP_IP>` with the IP address of the machine running NOAP Docker.  
> To find it on Windows: `ipconfig | findstr "IPv4"`

---

### MikroTik (RouterOS)

#### Enable Traffic Flow

```routeros
/ip traffic-flow
set enabled=yes interfaces=all active-flow-timeout=1m inactive-flow-timeout=15s
```

#### Add NOAP as Target

```routeros
/ip traffic-flow target
add dst-address=<NOAP_IP>:2055 version=5
```

#### Verify

```routeros
/ip traffic-flow print
/ip traffic-flow target print
```

#### Monitor Active Flows

```routeros
/ip traffic-flow connection print count-only
```

#### Troubleshooting MikroTik

| Symptom | Cause | Fix |
|---------|-------|-----|
| No packets in NOAP log | Target IP wrong or firewall blocking | Verify `target print`, check Windows firewall allows UDP 2055 |
| Packets arrive but `not registered` | Device IP not in NOAP Devices | Add the exporter IP (or `172.20.0.1` for Docker) in Devices page |
| Flows delayed | `active-flow-timeout` too long | `/ip traffic-flow set active-flow-timeout=1m` |
| Only some interfaces | `interfaces` not set to `all` | `/ip traffic-flow set interfaces=all` |
| v9 or IPFIX target | NOAP only supports v5 | Ensure target has `version=5` |

---

### Juniper (Junos — MX / SRX / EX)

#### Option A: Standard Sampling (All Platforms)

```junos
# Create flow collector
set forwarding-options sampling instance NOAP input rate 1
set forwarding-options sampling instance NOAP family inet output flow-server <NOAP_IP> port 2055
set forwarding-options sampling instance NOAP family inet output flow-server <NOAP_IP> version 5

# Enable sampling on interfaces
set interfaces ge-0/0/0 unit 0 family inet sampling input
set interfaces ge-0/0/0 unit 0 family inet sampling output

commit
```

#### Option B: Inline jFlow (MX Series — Better Performance)

```junos
# Create v5 template
set services flow-monitoring version5 template NOAP-TMPL

# Configure inline jflow
set forwarding-options sampling instance NOAP input rate 1
set forwarding-options sampling instance NOAP family inet output flow-server <NOAP_IP> port 2055
set forwarding-options sampling instance NOAP family inet output flow-server <NOAP_IP> version5-template NOAP-TMPL
set forwarding-options sampling instance NOAP family inet output inline-jflow source-address <ROUTER_LOOPBACK_IP>

# Enable on interfaces
set interfaces xe-0/0/0 unit 0 family inet sampling input
set interfaces xe-0/0/0 unit 0 family inet sampling output

commit
```

#### Verify

```junos
show services accounting flow
show services accounting status
show services accounting errors
show forwarding-options sampling
```

#### Troubleshooting Juniper

| Symptom | Cause | Fix |
|---------|-------|-----|
| No flows exported | Sampling not enabled on interface | Add `family inet sampling input/output` to interface |
| `show accounting errors` shows drops | Collector unreachable | Verify route to `<NOAP_IP>`, check firewall |
| Inline jflow not working | Platform doesn't support it | Use standard sampling (Option A) instead |
| High CPU from sampling | Rate too low (`rate 1`) | Increase to `rate 100` or `rate 1000` for production |
| Only ingress flows | Missing `sampling output` | Add output sampling to interface |
| IPFIX instead of v5 | Wrong version configured | Use `version 5` or `version5-template` |

---

### DANOS / Vyatta / VyOS

#### Configure NetFlow v5

```vyos
set system flow-accounting interface eth0
set system flow-accounting netflow version 5
set system flow-accounting netflow server <NOAP_IP> port 2055
set system flow-accounting netflow timeout expiry-interval 60
set system flow-accounting netflow timeout max-active-life 60

# Optional: Set source IP
set system flow-accounting netflow source-ip <ROUTER_IP>

# Optional: Add more interfaces
set system flow-accounting interface eth1
set system flow-accounting interface eth2

commit
save
```

#### Verify

```vyos
show flow-accounting
show flow-accounting interface eth0
```

#### Troubleshooting DANOS / VyOS

| Symptom | Cause | Fix |
|---------|-------|-----|
| `flow-accounting` not available | Package not installed | `sudo apt install pmacct` (VyOS) or check DANOS image |
| No flows exported | Interface not added | `show flow-accounting` to check active interfaces |
| Wrong source IP in NOAP | `source-ip` not configured | Set `netflow source-ip <LOOPBACK_IP>` |
| Flows delayed | Timeout too long | Set `expiry-interval` and `max-active-life` to `60` |
| Service not running | Daemon crashed | `restart flow-accounting` or check syslog |

---

## General Troubleshooting

### Docker / NOAP Side

```bash
# Check if backend is receiving flows
docker compose logs -f backend 2>&1 | grep FlowReceiver

# Expected log progression:
# ✓ packet from <IP>:<PORT> — 30 flow records     ← Flow received
# ✓ inserted 30 flows from device <IP> (id=1)     ← Stored in ClickHouse

# If you see:
# ⚠ exporter <IP> not registered                  ← Add device in frontend
# ⚠ ClickHouse not ready                          ← Wait for CH to start
```

### Port Verification

```powershell
# Windows — check UDP 2055 is listening
netstat -an | findstr "2055"

# Docker — check port mapping
docker port noap-backend

# Send test packet from PowerShell
$u = New-Object System.Net.Sockets.UdpClient
$b = [byte[]]@(0,5,0,1) + (New-Object byte[] 80)
$u.Send($b, $b.Length, "localhost", 2055)
$u.Close()
```

### Firewall Rules

```powershell
# Windows Firewall — allow UDP 2055 inbound
netsh advfirewall firewall add rule name="NOAP NetFlow UDP 2055" protocol=UDP dir=in localport=2055 action=allow

# Linux iptables
sudo iptables -A INPUT -p udp --dport 2055 -j ACCEPT
```

### ClickHouse Issues

```bash
# If ClickHouse shows "TOO_MANY_UNEXPECTED_DATA_PARTS":
docker compose down
docker volume rm noap_chdata
docker compose up -d

# Manual table reset (if ClickHouse is responsive):
docker exec noap-clickhouse clickhouse-client --password password --query "DROP TABLE IF EXISTS default.metrics_flow"
docker compose restart backend
```

### Docker Desktop + Windows (NAT)

When running Docker Desktop on Windows, the **exporter IP** seen by NOAP will be the Docker gateway (e.g., `172.20.0.1`) instead of the router's real IP. This is normal — the NetFlow payload still contains the real source/destination IPs.

**Solution:** Register `172.20.0.1` (or whatever gateway IP appears in the log) as a Device in NOAP's Devices page.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | `postgres` | PostgreSQL hostname |
| `DB_USER` | `user` | PostgreSQL username |
| `DB_PASSWORD` | `password` | PostgreSQL password |
| `DB_NAME` | `noap` | Database name |
| `CH_HOST` | `clickhouse` | ClickHouse hostname |
| `NETFLOW_PORT` | `2055` | UDP port for NetFlow collector |
| `JWT_SECRET` | `noap-dev-secret-change-in-prod` | **Change in production** |
| `BOOTSTRAP_KEY` | `noap-bootstrap-key` | Initial tenant setup key |

---

## License

Internal use — Antigravity project.
