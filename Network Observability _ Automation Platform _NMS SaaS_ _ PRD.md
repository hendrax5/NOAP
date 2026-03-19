
# Network Observability & Automation Platform (NMS SaaS) — PRD

### TL;DR

A multi-tenant SaaS platform engineered as the next-generation NMS for ISP network engineers and enterprise NOC teams. The platform combines unified SNMP/BGP/MPLS monitoring, *full optical dBm/signal loss tracking, ICMP/ping performance and loss, live syslog and SNMP trap integration, and CPU/memory monitoring*, hyper-scale flow analytics, topology mapping, zero-downtime config automation, and actionable AI-driven root cause analysis—all delivered via a frictionless SaaS model. Tenants configure their own alert rules and notification endpoints (including Telegram Bot, per tenant), with industry-defining speed, cost efficiency, and time-to-value. More powerful, open, and affordable than Kentik, SolarWinds, PRTG, Zabbix, or LibreNMS—with a sub-1-day onboarding process, API-first design, and SaaS reliability.

---

## Goals

### Business Goals

* Redefine the NMS landscape for ISPs and enterprises—delivering Kentik/SolarWinds/PRTG/Zabbix/LibreNMS power in an affordable, agile SaaS form for regional and SMB ISPs.

* Build a sustainable recurring revenue engine with at least 20+ live, paying tenants within two years.

* Deliver automation-led value, aiming for 20% YoY reduction in human-initiated incident remediations.

* Establish best-in-industry trust and reliability: 99.9%+ uptime, end-to-end tenant isolation, and a modern security track-record post-SolarWinds era.

* Remove onboarding friction: new tenants achieve meaningful monitoring and alerting under one business day.

### User Goals

* Gain unified, real-time network visibility across all devices (SNMP/BGP/MPLS/Flow/ICMP/Optical/Syslog), with instant context and single-pane control.

* Detect fiber/optical degradation before outages via per-interface dBm optical power (signal loss) monitoring—receive alert before critical impact.

* Confirm and accelerate remediation with actionable, AI-driven RCA, not mere dashboards or logs.

* Gain full event-driven visibility via syslog and SNMP trap ingestion; see all alerts, logs, and context in one tenant-focused live view.

* Safeguard and automate device management—config backup, audit-grade diff & rollback, and mass configuration push.

* Empower NOC ops working across APAC, LATAM, EMEA to opt into Telegram, Email, or other alerts—per tenant, not system-wide.

* Manage large-scale multi-vendor estates in one platform, with zero risk of data overlap or cross-tenant exposure.

### Non-Goals

* No on-premise-only “boxed” deployments—SaaS is default, hybrid/edge as roadmap extensions.

* No physical datacenter environmental monitoring (power/cooling/fans).

* Not a replacement for mature ITSM/ticketing suites; focused, with possible integrations.

---

## Competitive Differentiation

### Competitive Comparison Table

### Competitive Weaknesses:

**Kentik**

* Enterprise-only pricing, complex onboarding.

* Weak/complex multi-tenancy.

* Email/Slack alerting only.

* Lacks config automation, AI RCA, or full syslog integration.

**SolarWinds**

* Expensive, on-premises focus, legacy UI, major security trust gap post-breach.

* No SaaS, no real-time automation, limited optical support.

**PRTG**

* Per-sensor licensing—costs escalate fast.

* Windows-first, no real multi-tenancy.

* Optical monitoring is effort-intensive; config and automation missing.

**Zabbix**

* Not SaaS, steep learning curve, significant DevOps upkeep.

* Lacks flow analytics, AI, config automation.

**LibreNMS**

* Open source, lacks native SaaS, no support SLAs.

* Optical support incomplete, no real config or RCA automation.

**NagiosXI**

* Aging architecture, no visibility into flow, config, or advanced automation.

**Our Platform Key Advantages:**

* *Seamless SaaS with strict tenant data/alert separation.*

* *Integrated SNMP (interfaces, optical, CPU/mem), BGP/MPLS, and advanced flow.*

* *Per-tenant Telegram/E-mail alerting—critical for global teams.*

* *Built-in automation—backup, diff, rollback, mass push.*

* *AI-powered RCA and remediation—“what happened, what to do, and do it now.”*

* *Sub-1-day onboarding for any SMB/ISP, Docker Compose for evaluation in 30 minutes or less.*

* *Open API and modern, accessible UI — no more legacy pain.*

---

## User Stories

### ISP Network Engineer

* As an ISP Network Engineer, I want to receive *optical dBm (signal loss)* alerts when fiber links degrade, so I can take action before a full outage.

* As an ISP Network Engineer, I want to get notified of *CPU spikes* or high *memory usage* before BGP flaps or outages occur, minimizing downtime.

* As an ISP Network Engineer, I want per-interface dashboards to check not just status and bandwidth, but also current/historical Rx/Tx dBm values and errors, to quickly spot fiber and SFP/optic issues.

* As an ISP Network Engineer, I want to receive *immediate Telegram or Email alerts* at my org’s channel for all these health indicators.

### NOC Operator

* As a NOC Operator, I want to view a *live syslog and SNMP trap feed* per device so I see at a glance what critical events are happening.

* As a NOC Operator, I need an *SLA probe dashboard* to monitor uptime and latency for upstreams, peering, and customer endpoints.

* As a NOC Operator, I want to see *historical latency and packet loss* trends from ICMP probes to preempt instability.

### Platform Admin (SaaS Tenant Admin)

* As a Platform Admin, I want to configure, test, and update my own Telegram bot token and chat from our admin interface, ensuring only my org can access our alerts.

* As a Platform Admin, I want an audit trail for every alert and notification dispatched, including syslog/trap/ICMP synthetic events.

### Super Admin (Platform Owner)

* As a Super Admin, I want to monitor per-tenant syslog/trap ingestion volumes and SLA probe performance to assure platform SLOs.

---

## Functional Requirements

### Phase 0: Core Infrastructure (Critical)

* \[No changes—retained as foundation.\]

### Phase 1: **Interface + Enhanced Monitoring**

* **SNMP Polling Worker:** Bandwidth, error/discard, *optical Rx/Tx dBm per interface* (vendor MIBs: Cisco ENTITY-SENSOR-MIB, Juniper, Huawei, MikroTik).

* **ICMP/Ping Worker** (per device): Tracks round-trip latency (min/avg/max/jitter), packet loss %, graphs trending; configurable probes.

* **CPU & Memory SNMP Polling:** HOST-RESOURCES-MIB + vendor extensions; dashboard and alerting.

* **Alert Engine:** Triggers for bandwidth, errors, interface down, optical dBm (e.g., Rx < -23 dBm = degraded; < -30 dBm = critical), CPU >80%, RAM >90%.

* **Time-series DB** holds all metrics; *optical dBm stored with raw, min/max/avg per interface*.

* **Dashboards:** Real-time interface/optical health, bandwidth, loss/error trend; CPU/memory charts.

### Phase 1b/2: **SLA, Event-Driven, and Synthetic Monitoring**

* **SLA Probes:** Tenant-defined HTTP, TCP port, DNS, ICMP multi-hop probes. Tracks uptime %, response time, SLA compliance, and breach log.

* **Syslog & SNMP Trap Collection:** UDP listener services (port 514/162), per-tenant endpoint, parses/events, triggers alerting and records to dashboard.

* **Syslog/Trap Dashboard:** Live feed per tenant/device, filters for severity/type/source; links to incidents for AI RCA context.

### Subsequent Phases

* \[Phases 2–7 as previously defined, building up BGP/MPLS/flow, topology mapping, config automation, and AI RCA.\]

---

## User Experience

* **Optical Monitoring**: On per-interface dashboard, user can view current/historical Rx/Tx dBm graph, with color-coded warnings (degraded/critical); hovering shows min/max trends. Clicking the SFP icon shows optic details, vendor, and VLAN/lane mapping for multi-lane optics.

* **ICMP/Ping Monitoring**: Devices overview page displays live ping/loss/latency for each device. Clicking device opens historical trend; green/yellow/red highlights for healthy/degraded/loss as per thresholds. Configure probes under device settings.

* **CPU/Memory**: Resource dashboard offers snapshot and trendline per device. Integrated with alerting for spike/breach events.

* **SLA/Synthetic Probes**: New dashboard shows status of HTTP, TCP, DNS, and multi-hop ICMP checks; visualizes SLA uptime %, response time, logs any failed/breached probes; tenants create/edit probes from settings.

* **Syslog/SNMP Trap**: Live event feed panel shows incoming syslog/trap messages with search and filtering; major events (auth failures, link down) trigger color badges and can be linked to full incident RCA screens.

* **Unified Incident Experience**: All relevant SNMP, syslog, synthetic, and AI-driven RCA information presented in one incident pane, with one-click rollback/apply fix action where supported.

* **Per-Tenantized Alerting**: All email/Telegram alerts generated and delivered according to tenant-specific config—custom bots, no global overlap.

* **Bulk Actions and Secure UX**: Bulk device add, safe handling of all sensitive data, responsive NOC wall interface, and role-based access per tenant.

---

## Technical Considerations

* **Vendor MIB Matrix:** Out-of-box support for Cisco (ENTITY-SENSOR-MIB), Juniper, MikroTik, Huawei for optical dBm/Rx/Tx, with config stub for fast extensions.

* **SNMP Optical Poller:** Parses dBm for all vendor-supported SFP/QSFP/optical interfaces, stores as time-series data with dBm units.

* **ICMP/Synthetic Workers:** Scalable pool dispatches ping, HTTP, TCP, DNS synthetic probes per tenant probe definition.

* **Syslog/Trap Receivers:** UDP 514/162 multi-tenant services tokenized by tenant, with per-tenant ingestion endpoints and DB scoping.

* **Alert Engine:** Includes optical/ICMP/CPU/mem/SLA breach logic, mapped to tenant channels (Telegram/email/webhook).

* **Data Storage:** All data—interface, optical, syslog, traps, SLA probe, flows, configs—partitioned by tenant_id; enables strict row-level security.

* **Security:** Tokens for all per-tenant endpoints (Telegram, syslog) stored encrypted; only tenant admins have edit/test privilege.

* **Scalability:** All workers horizontally scalable, central event bus (NATS), ClickHouse for flows/trending, PostgreSQL for config/entity.

* **API:** Open API for device onboarding, probe definition, alert rule config; full multi-tenancy enforced.

---

## Success Metrics

* **Optical Alert Accuracy**: ≥98% detection rate for critical dBm drops, verified via incident audit.

* **Syslog Ingestion Rate**: 2,000+ messages/sec/tenant target, zero message loss; latency to dashboard <2s.

* **SLA Probe Uptime Tracking**: >99.99% accuracy on uptime calculations vs. independent checkers.

* **ICMP Latency Monitoring**: <1s difference vs. ground truth; ping loss alarms delivered in <3s to Telegram.

* **Dashboards**: >90% of incidents triaged from optical, syslog, or synthetic dashboards within 10 minutes.

* **Business/Adoption**: >50% of new tenants enabling optical/ICMP/CPU/SLA monitoring within onboarding week.

* **Cross-Platform Coverage**: At least four major vendor optical dBm integrations live at launch.

---

## Milestones & Sequencing

### Team

* 1 Backend (Go) | 1 Frontend (Next.js) | 1 Infra/DevOps (pt) | 1 PM/Owner

### Phases

**Phase 0 (1w):** Core infra, login/JWT, tenant CRUD, device inventory, Tenant Notification Settings (Telegram UI, DB scoped, encrypted).

**Phase 1 (1.5–2w):**

* *SNMP/Interface dashboards*

* *Optical dBm monitoring (Rx/Tx per interface, vendor matrix)*

* *ICMP/ping/latency/loss engine*

* *CPU/memory polling & dashboard*

* *Per-tenant alert engine, Telegram alerting fully functional*

**Phase 2 (1w):**

* *BGP peer monitoring, dashboard upgrades*

* *SLA synthetic probes (ICMP/HTTP/TCP/DNS)*

* *Syslog & SNMP trap collection, event feed/dashboard*

* *Per-tenant endpoint, alert, and storage pipeline*

**Phase 3 (1w):** MPLS LSP monitoring.

**Phase 4 (2w):** Flow analytics pipeline (100K+ flows/sec, top talker/ASN).

**Phase 5 (1w):** Auto topology engine.

**Phase 6 (1w):** Config backup, diff, rollback.

**Phase 7 (1w):** AI RCA (rule-based, LLM), per-tenant RCA explanation panels and alerts.

---

## Quick Start

**1.** Clone the repo  

**2.** Edit `.env` (no Telegram creds here!)  

**3.** Run:

```
docker-compose up --build -d

```

**Access:**

* UI: [http://localhost:3000](http://localhost:3000)

* API: [http://localhost:4000](http://localhost:4000)

**Initial setup:** After logging in, admins enter their own Telegram Bot Token & Chat ID in the Tenant Notification Settings screen. These are stored, encrypted, per tenant—not in any global config.

> **Note:** Telegram bot token & chat ID *are not in .env or docker secrets*. They are per-tenant, set via UI, stored in DB, encrypted.

---

## Architecture Principles

* Modular, automation- and event-driven microservice architecture

* Strict multi-tenancy with shared DB, enforced by tenant_id everywhere

* Stateless APIs and workers, horizontally scalable from day one

* Low resource cost—fit for SaaS economics, high density

* Open, API-first, extensible foundation (full automation support)

* Modern, fast, and secure—all services designed for today's NOC workloads, no legacy pain

---

## FINAL TARGET

* Ready to *replace Kentik, SolarWinds, PRTG, Zabbix, LibreNMS, and NagiosXI* for regional, SMB, and global ISPs/enterprise NOCs

* End-to-end monitoring stack: *interface*, *BGP*, *MPLS*, *flow*, *optical dBm*, *CPU/mem*, *ICMP/ping*, *SLA probes*, *syslog*, *SNMP traps*, *topology*, *automation*, *AI RCA*

* Strict, enterprise-grade multi-tenant SaaS delivery powered by shared DB + tenant_id partitioning

* Real-time, actionable incident detection and notification—with per-tenant Telegram as a world-first

* Built-in, not bolted-on, config automation and RCA

* Sub-1-day onboarding (Docker Compose), full open API, and affordable pricing

* *A single, SaaS-native platform empowering ISPs and NOCs for the next decade*

---