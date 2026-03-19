/**
 * Sample / demo data for Flow Analytics.
 * Used as fallback when the API returns empty results (no real NetFlow yet).
 */

export const SAMPLE_TALKERS = [
  { src_ip:"103.162.16.1",  dst_ip:"8.8.8.8",         protocol:"UDP",  total_bytes:  982_400_000, app:"DNS",   dst_asn_name:"Google LLC" },
  { src_ip:"103.162.16.2",  dst_ip:"1.1.1.1",          protocol:"UDP",  total_bytes:  741_200_000, app:"DNS",   dst_asn_name:"Cloudflare Inc" },
  { src_ip:"103.162.16.3",  dst_ip:"13.248.118.1",     protocol:"TCP",  total_bytes:  634_800_000, app:"HTTPS", dst_asn_name:"Amazon.com Inc" },
  { src_ip:"103.162.16.4",  dst_ip:"157.240.8.35",     protocol:"TCP",  total_bytes:  521_600_000, app:"HTTPS", dst_asn_name:"Meta Platforms" },
  { src_ip:"103.162.16.5",  dst_ip:"172.217.194.102",  protocol:"TCP",  total_bytes:  478_300_000, app:"HTTPS", dst_asn_name:"Google LLC" },
  { src_ip:"103.162.16.6",  dst_ip:"104.26.0.132",     protocol:"TCP",  total_bytes:  354_100_000, app:"HTTPS", dst_asn_name:"Cloudflare Inc" },
  { src_ip:"103.162.16.7",  dst_ip:"52.84.234.100",    protocol:"TCP",  total_bytes:  298_700_000, app:"HTTPS", dst_asn_name:"Amazon CloudFront" },
  { src_ip:"103.162.16.8",  dst_ip:"203.0.113.42",     protocol:"ICMP", total_bytes:   12_400_000, app:"ICMP",  dst_asn_name:"APNIC Research" },
];

export const SAMPLE_BW_STATS = {
  total_gb:    4.83,
  tcp_pct:     62.4,
  udp_pct:     31.7,
  icmp_pct:     5.9,
  active_flows: 247,
};

/** 24 time-buckets simulating ~6h of traffic with realistic peaks */
export const SAMPLE_TIME_SERIES = Array.from({ length: 24 }, (_, i) => {
  const base = 180_000_000; // ~180 Mbps base
  const wave = Math.sin((i / 23) * Math.PI * 2) * 60_000_000;
  const noise = (Math.random() - 0.5) * 40_000_000;
  return {
    bucket: i,
    in_bps:  Math.max(20_000_000, base + wave + noise),
    out_bps: Math.max(10_000_000, base * 0.6 + wave * 0.7 + noise * 0.8),
  };
});

export const SAMPLE_APPS = [
  { app:"HTTPS",     bytes: 2_140_000_000 },
  { app:"DNS",       bytes:   923_000_000 },
  { app:"HTTP",      bytes:   410_000_000 },
  { app:"SSH",       bytes:   178_000_000 },
  { app:"NTP",       bytes:    92_000_000 },
  { app:"SMTP",      bytes:    61_000_000 },
  { app:"SNMP",      bytes:    38_000_000 },
  { app:"Other",     bytes:   158_000_000 },
];

export const SAMPLE_ASNS = [
  { asn: 15169, asn_name:"Google LLC",           bytes: 1_620_000_000 },
  { asn: 16509, asn_name:"Amazon.com Inc",       bytes: 1_070_000_000 },
  { asn: 13335, asn_name:"Cloudflare Inc",       bytes:   820_000_000 },
  { asn: 32934, asn_name:"Meta Platforms",       bytes:   610_000_000 },
  { asn:  4713, asn_name:"NTT Communications",   bytes:   380_000_000 },
  { asn:  4787, asn_name:"Telkomsel",            bytes:   274_000_000 },
  { asn:  7713, asn_name:"PT Telkom Indonesia",  bytes:   218_000_000 },
];

export const SAMPLE_SANKEY = {
  nodes: [
    { id:"103.162.16.1" },
    { id:"103.162.16.3" },
    { id:"103.162.16.5" },
    { id:"Google LLC" },
    { id:"Amazon.com" },
    { id:"Cloudflare" },
    { id:"Meta" },
  ],
  links: [
    { source:"103.162.16.1", target:"Google LLC",  value:982_400_000 },
    { source:"103.162.16.3", target:"Amazon.com",  value:634_800_000 },
    { source:"103.162.16.5", target:"Google LLC",  value:478_300_000 },
    { source:"103.162.16.1", target:"Cloudflare",  value:354_100_000 },
    { source:"103.162.16.3", target:"Meta",        value:521_600_000 },
  ],
};
