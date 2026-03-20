"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export default function SensorDetail() {
  const { id, type, sensorId } = useParams();
  const router = useRouter();
  
  const [device, setDevice] = useState<any>(null);
  const [timeseries, setTimeseries] = useState<any[]>([]);
  const [interfaceDetails, setInterfaceDetails] = useState<any>(null);
  const [activeRange, setActiveRange] = useState("1h");
  
  useEffect(() => {
    const opts = { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } };
    
    // Fetch Device Info
    fetch(`/api/devices`, opts)
      .then(r => r.json())
      .then(data => setDevice(data.find((d: any) => d.ID == id)));

    const fetchSensorData = () => {
      if (type === 'traffic') {
        fetch(`/api/metrics/interfaces/sparklines?device_id=${id}&range=${activeRange}`, opts)
          .then(r => r.json())
          .then(data => {
              if (data && data[Number(sensorId)]) setTimeseries(data[Number(sensorId)]);
          });
        fetch(`/api/devices/${id}/interfaces`, opts)
          .then(r => r.json())
          .then(data => {
              const inf = data.find((i: any) => i.if_index == sensorId);
              if (inf) setInterfaceDetails(inf);
          });
      } else if (type === 'optical') {
        fetch(`/api/metrics/optical/sparklines?device_id=${id}&range=${activeRange}`, opts)
          .then(r => r.json())
          .then(data => {
              if (data && data[Number(sensorId)]) setTimeseries(data[Number(sensorId)]);
          });
        fetch(`/api/devices/${id}/interfaces`, opts)
          .then(r => r.json())
          .then(data => {
              const inf = data.find((i: any) => i.if_index == sensorId);
              if (inf) setInterfaceDetails(inf);
          });
      } else if (type === 'system') {
        fetch(`/api/metrics/system?device_id=${id}&range=${activeRange}`, opts).then(r => r.json()).then(setTimeseries);
      } else if (type === 'icmp') {
        fetch(`/api/metrics/icmp?device_id=${id}&range=${activeRange}`, opts).then(r => r.json()).then(setTimeseries);
      }
    };
    
    fetchSensorData();
    const interval = setInterval(fetchSensorData, 10000);
    return () => clearInterval(interval);
  }, [id, type, sensorId, activeRange]);

  const latestData = timeseries.length > 0 ? timeseries[timeseries.length - 1] : null;

  // Render logic depending on sensor type
  let sensorTitle = "";
  let icon = null;
  
  if (type === 'icmp') {
      sensorTitle = "Ping (ICMP)";
      icon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20"></path><path d="M2 12h20"></path></svg>;
  } else if (type === 'system' && sensorId === 'cpu') {
      sensorTitle = "System CPU";
      icon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect></svg>;
  } else if (type === 'system' && sensorId === 'mem') {
      sensorTitle = "System Memory";
      icon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect></svg>;
  } else if (type === 'system' && sensorId === 'uptime') {
      sensorTitle = "System Uptime";
      icon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>;
  } else if (type === 'optical') {
      sensorTitle = `Optical Transceiver ${interfaceDetails?.name || sensorId}`;
      if (interfaceDetails?.description) sensorTitle += ` - ${interfaceDetails.description}`;
      icon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path><path d="M2 12h20"></path></svg>;
  } else if (type === 'traffic') {
      sensorTitle = interfaceDetails?.name || `Interface ${sensorId}`;
      if (interfaceDetails?.description) sensorTitle += ` - ${interfaceDetails.description}`;
      icon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>;
  }

  const renderStats = () => {
      if (type === 'traffic') {
          const in_mbps = latestData?.in_mbps || 0;
          const out_mbps = latestData?.out_mbps || 0;
          const total = in_mbps + out_mbps;
          const capacity = 1000; // Mocked 1Gbps capacity
          const util = (total / capacity) * 100;
          
          return (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 my-8">
                  <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-5 flex flex-col justify-between hover:bg-zinc-800/50 transition-colors">
                      <div className="text-zinc-500 text-xs font-semibold tracking-wider mb-2 uppercase">Traffic In</div>
                      <div className="flex items-end gap-2 text-indigo-400">
                          <span className="text-3xl font-bold font-mono tracking-tight">{in_mbps.toFixed(2)}</span>
                          <span className="text-sm font-medium mb-1">Mbps</span>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="mb-1 ml-auto"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>
                      </div>
                  </div>
                  <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-5 flex flex-col justify-between hover:bg-zinc-800/50 transition-colors">
                      <div className="text-zinc-500 text-xs font-semibold tracking-wider mb-2 uppercase">Traffic Out</div>
                      <div className="flex items-end gap-2 text-emerald-400">
                          <span className="text-3xl font-bold font-mono tracking-tight">{out_mbps.toFixed(2)}</span>
                          <span className="text-sm font-medium mb-1">Mbps</span>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="mb-1 ml-auto"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
                      </div>
                  </div>
                  <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-5 flex flex-col justify-between hover:bg-zinc-800/50 transition-colors">
                      <div className="text-zinc-500 text-xs font-semibold tracking-wider mb-2 uppercase">Traffic Total</div>
                      <div className="flex items-end gap-2 text-zinc-200">
                          <span className="text-3xl font-bold font-mono tracking-tight">{total.toFixed(2)}</span>
                          <span className="text-sm font-medium mb-1">Mbps</span>
                      </div>
                  </div>
                  <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-5 flex flex-col justify-between hover:bg-zinc-800/50 transition-colors relative overflow-hidden">
                      <div className="relative z-10 text-zinc-500 text-xs font-semibold tracking-wider mb-2 uppercase">Utilization</div>
                      <div className={`relative z-10 flex items-end gap-2 ${util > 80 ? 'text-rose-400' : util > 50 ? 'text-orange-400' : 'text-[#a3e635]'}`}>
                          <span className="text-3xl font-bold font-mono tracking-tight">{util.toFixed(1)}</span>
                          <span className="text-sm font-medium mb-1">%</span>
                      </div>
                      <div className="absolute inset-0 bg-gradient-to-t from-[#a3e635]/5 to-transparent z-0 pointer-events-none"></div>
                  </div>
              </div>
          );
      } else if (type === 'optical') {
          const rx = latestData?.rx_dbm || 0;
          const tx = latestData?.tx_dbm || 0;
          return (
              <div className="grid grid-cols-2 gap-4 my-8">
                  <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-5 flex flex-col justify-between hover:bg-zinc-800/50 transition-colors">
                      <div className="text-zinc-500 text-xs font-semibold tracking-wider mb-2 uppercase flex items-center gap-2"><div className={`w-2 h-2 rounded-full ${rx < -23 ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'}`}></div> Optical RX (Receive) Power</div>
                      <div className={`flex items-end gap-2 ${rx < -23 ? 'text-rose-400' : 'text-emerald-400'}`}>
                          <span className="text-3xl font-bold font-mono tracking-tight">{rx.toFixed(2)}</span>
                          <span className="text-sm font-medium mb-1">dBm</span>
                      </div>
                  </div>
                  <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-5 flex flex-col justify-between hover:bg-zinc-800/50 transition-colors">
                      <div className="text-zinc-500 text-xs font-semibold tracking-wider mb-2 uppercase flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-indigo-500"></div> Optical TX (Transmit) Power</div>
                      <div className="flex items-end gap-2 text-indigo-400">
                          <span className="text-3xl font-bold font-mono tracking-tight">{tx.toFixed(2)}</span>
                          <span className="text-sm font-medium mb-1">dBm</span>
                      </div>
                  </div>
              </div>
          );
      }
      return null;
  };

  const renderChannels = () => {
      let content = null;
      
      if (type === 'traffic') {
          const in_mbps = latestData?.in_mbps || 0;
          const out_mbps = latestData?.out_mbps || 0;
          const total = in_mbps + out_mbps;
          content = (
              <>
                  <div className="flex items-center px-6 py-4 hover:bg-zinc-800/50 transition-colors">
                      <div className="w-1/4 font-semibold text-zinc-300">Traffic In</div>
                      <div className="w-1/4 font-mono text-zinc-400">{in_mbps.toFixed(2)} Mbps</div>
                      <div className="w-1/4 flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500"></div><span className="text-emerald-500 text-xs font-bold uppercase">Normal</span></div>
                      <div className="w-1/4 text-right"><button className="text-zinc-500 hover:text-white transition-colors">⚙️</button></div>
                  </div>
                  <div className="flex items-center px-6 py-4 hover:bg-zinc-800/50 transition-colors">
                      <div className="w-1/4 font-semibold text-zinc-300">Traffic Out</div>
                      <div className="w-1/4 font-mono text-zinc-400">{out_mbps.toFixed(2)} Mbps</div>
                      <div className="w-1/4 flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500"></div><span className="text-emerald-500 text-xs font-bold uppercase">Normal</span></div>
                      <div className="w-1/4 text-right"><button className="text-zinc-500 hover:text-white transition-colors">⚙️</button></div>
                  </div>
                  <div className="flex items-center px-6 py-4 hover:bg-zinc-800/50 transition-colors">
                      <div className="w-1/4 font-semibold text-zinc-200">Traffic Total</div>
                      <div className="w-1/4 font-mono text-zinc-200 font-bold">{total.toFixed(2)} Mbps</div>
                      <div className="w-1/4 flex items-center gap-2"><div className={`w-2 h-2 rounded-full ${total > 800 ? 'bg-orange-500' : 'bg-emerald-500'}`}></div><span className={`${total > 800 ? 'text-orange-500' : 'text-emerald-500'} text-xs font-bold uppercase`}>{total > 800 ? 'High' : 'Normal'}</span></div>
                      <div className="w-1/4 text-right"><button className="text-zinc-500 hover:text-white transition-colors">⚙️</button></div>
                  </div>
              </>
          );
      } else if (type === 'icmp') {
          content = (
              <div className="flex items-center px-6 py-4 hover:bg-zinc-800/50 transition-colors">
                  <div className="w-1/4 font-semibold text-zinc-300">Ping Time</div>
                  <div className="w-1/4 font-mono text-zinc-400">{latestData?.latency || 0} msec</div>
                  <div className="w-1/4 flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500"></div><span className="text-emerald-500 text-xs font-bold uppercase">Normal</span></div>
                  <div className="w-1/4 text-right"><button className="text-zinc-500 hover:text-white transition-colors">⚙️</button></div>
              </div>
          );
      } else if (type === 'system' && sensorId === 'cpu') {
          content = (
              <div className="flex items-center px-6 py-4 hover:bg-zinc-800/50 transition-colors">
                  <div className="w-1/4 font-semibold text-zinc-300">CPU Load</div>
                  <div className="w-1/4 font-mono text-zinc-400">{latestData?.cpu?.toFixed(0) || 0} %</div>
                  <div className="w-1/4 flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${latestData?.cpu > 80 ? 'bg-orange-500' : 'bg-emerald-500'}`}></div>
                      <span className={`${latestData?.cpu > 80 ? 'text-orange-500' : 'text-emerald-500'} text-xs font-bold uppercase`}>{latestData?.cpu > 80 ? 'Warning' : 'Normal'}</span>
                  </div>
                  <div className="w-1/4 text-right"><button className="text-zinc-500 hover:text-white transition-colors">⚙️</button></div>
              </div>
          );
      } else if (type === 'system' && sensorId === 'mem') {
          content = (
              <div className="flex items-center px-6 py-4 hover:bg-zinc-800/50 transition-colors">
                  <div className="w-1/4 font-semibold text-zinc-300">Memory Usage</div>
                  <div className="w-1/4 font-mono text-zinc-400">{latestData?.mem?.toFixed(0) || 0} %</div>
                  <div className="w-1/4 flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500"></div><span className="text-emerald-500 text-xs font-bold uppercase">Normal</span></div>
                  <div className="w-1/4 text-right"><button className="text-zinc-500 hover:text-white transition-colors">⚙️</button></div>
              </div>
          );
      } else if (type === 'system' && sensorId === 'uptime') {
          const formatUptimeStr = (seconds: number) => {
              if (!seconds) return "0s";
              const d = Math.floor(seconds / (3600*24));
              const h = Math.floor(seconds % (3600*24) / 3600);
              const m = Math.floor(seconds % 3600 / 60);
              return `${d}d ${h}h ${m}m`;
          };
          content = (
              <div className="flex items-center px-6 py-4 hover:bg-zinc-800/50 transition-colors">
                  <div className="w-1/4 font-semibold text-zinc-300">System Uptime</div>
                  <div className="w-1/4 font-mono text-zinc-400">{formatUptimeStr(latestData?.uptime || 0)}</div>
                  <div className="w-1/4 flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500"></div><span className="text-emerald-500 text-xs font-bold uppercase">Normal</span></div>
                  <div className="w-1/4 text-right"><button className="text-zinc-500 hover:text-white transition-colors">⚙️</button></div>
              </div>
          );
      } else if (type === 'optical') {
          const rx = latestData?.rx_dbm || 0;
          const tx = latestData?.tx_dbm || 0;
          content = (
              <>
                  <div className="flex items-center px-6 py-4 hover:bg-zinc-800/50 transition-colors">
                      <div className="w-1/4 font-semibold text-zinc-300">RX Power (Input/Receive)</div>
                      <div className="w-1/4 font-mono text-zinc-400">{rx.toFixed(2)} dBm</div>
                      <div className="w-1/4 flex items-center gap-2"><div className={`w-2 h-2 rounded-full ${rx < -23 ? 'bg-rose-500' : 'bg-emerald-500'}`}></div><span className={`${rx < -23 ? 'text-rose-500' : 'text-emerald-500'} text-xs font-bold uppercase`}>{rx < -23 ? 'Degraded/Failing' : 'Normal'}</span></div>
                      <div className="w-1/4 text-right"><button className="text-zinc-500 hover:text-white transition-colors">⚙️</button></div>
                  </div>
                  <div className="flex items-center px-6 py-4 hover:bg-zinc-800/50 transition-colors">
                      <div className="w-1/4 font-semibold text-zinc-300">TX Power (Output/Transmit)</div>
                      <div className="w-1/4 font-mono text-zinc-400">{tx.toFixed(2)} dBm</div>
                      <div className="w-1/4 flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500"></div><span className="text-emerald-500 text-xs font-bold uppercase">Normal</span></div>
                      <div className="w-1/4 text-right"><button className="text-zinc-500 hover:text-white transition-colors">⚙️</button></div>
                  </div>
              </>
          );
      }
      
      return (
          <div className="mt-8">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 overflow-hidden divide-y divide-zinc-800/60">
                 {content}
              </div>
          </div>
      );
  };

  const calculateExtremes = () => {
      if (timeseries.length === 0) return { min: 0, max: 0, avg: 0 };
      
      let values: number[] = [];
      if (type === 'traffic') {
          values = timeseries.map(t => (t.in_mbps || 0) + (t.out_mbps || 0));
      } else if (type === 'icmp') {
          values = timeseries.map(t => t.latency || 0);
      } else if (type === 'system' && sensorId === 'cpu') {
          values = timeseries.map(t => t.cpu || 0);
      } else if (type === 'system' && sensorId === 'mem') {
          values = timeseries.map(t => t.mem || 0);
      } else if (type === 'system' && sensorId === 'uptime') {
          values = timeseries.map(t => t.uptime || 0);
      } else if (type === 'optical') {
          values = timeseries.flatMap(t => [t.rx_dbm || 0, t.tx_dbm || 0]);
      }
      
      if (values.length === 0) return { min: 0, max: 0, avg: 0 };
      
      const min = Math.min(...values);
      const max = Math.max(...values);
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      
      return { min, max, avg };
  };

  const { min, max, avg } = calculateExtremes();
  let unit = "";
  if (type === 'traffic') unit = "Mbps";
  else if (type === 'icmp') unit = "ms";
  else if (type === 'system' && sensorId === 'uptime') unit = "sec";
  else if (type === 'system') unit = "%";
  else if (type === 'optical') unit = "dBm";

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      
      {/* Header Back Button */}
      <button onClick={() => router.push(`/dashboard/devices/${id}`)} className="text-zinc-500 hover:text-white transition-colors flex items-center gap-2 mb-6 text-sm font-medium">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        Back to {device ? device.name : 'Device Overview'}
      </button>

      {/* Main Container */}
      <div className="bg-[#121214] border border-zinc-800 rounded-2xl p-6 md:p-10 shadow-lg">
          
          {/* Top Info Banner */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-zinc-800/50">
              <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                      {icon}
                  </div>
                  <div>
                      <h1 className="text-xl md:text-2xl font-bold text-white flex items-center gap-3">
                        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> OK
                        </span>
                        {sensorTitle}
                      </h1>
                      <div className="flex items-center gap-3 text-zinc-500 text-xs mt-1.5">
                          <span>Last Scan: <strong className="text-zinc-300">10s</strong></span>
                          <span>&bull;</span>
                          <span><strong className="text-zinc-300">{type === 'traffic' ? 'SNMP 64bit' : 'System'}</strong></span>
                          <span>&bull;</span>
                          <span>Coverage <strong className="text-emerald-400">100%</strong></span>
                      </div>
                  </div>
              </div>
              <div className="flex items-center gap-2">
                  <button className="px-4 py-2 border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition-colors">Scan Now</button>
                  <button className="px-4 py-2 border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition-colors">Pause</button>
              </div>
          </div>

          {/* Cards Row */}
          {renderStats()}

          {/* Graph Section */}
          <div className="mt-8">
              <div className="flex items-center justify-between mb-4">
                  <h3 className="text-white font-semibold flex items-center gap-2">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-indigo-400"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
                      Performance Trends
                  </h3>
                  <div className="flex bg-zinc-900 border border-zinc-800 rounded-lg p-1">
                      {['1h', '6h', '24h', '7d', '30d'].map((r) => (
                          <button 
                              key={r} 
                              onClick={() => { setActiveRange(r); setTimeseries([]); }}
                              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${activeRange === r ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                          >
                              {r}
                          </button>
                      ))}
                  </div>
              </div>
              
              <div className="h-64 sm:h-80 w-full bg-zinc-900/20 rounded-xl p-4 border border-zinc-800 flex flex-col justify-center">
                  <div className="mb-2 text-right text-zinc-500 text-xs font-medium uppercase tracking-wider h-4">{timeseries.length > 0 ? `Showing ${timeseries.length} Data Points` : ''}</div>
                  {timeseries.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                         <AreaChart data={timeseries} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                            <XAxis 
                                dataKey="ts" 
                                stroke="#52525b" 
                                fontSize={11} 
                                minTickGap={40}
                                tickMargin={10}
                                tickFormatter={(tick) => {
                                    const d = new Date(tick);
                                    if (activeRange === '1h' || activeRange === '6h') {
                                        return d.toLocaleTimeString("id-ID", { hour: '2-digit', minute: '2-digit' });
                                    }
                                    return d.toLocaleDateString("id-ID", { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                                }} 
                            />
                            <YAxis 
                                stroke="#52525b" 
                                fontSize={11} 
                                width={45}
                                tickFormatter={(val) => val >= 1000 ? `${(val/1000).toFixed(1)}k` : val}
                            />
                            <Tooltip 
                                labelFormatter={(label) => new Date(label).toLocaleString("id-ID")}
                                contentStyle={{ backgroundColor: '#18181b', borderColor: '#3f3f46', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                itemStyle={{ color: '#e4e4e7', fontSize: '13px' }}
                                labelStyle={{ color: '#a1a1aa', fontSize: '11px', marginBottom: '4px' }}
                            />
                            {type === 'traffic' && (
                                <>
                                    <Area type="monotone" dataKey="in_mbps" name="Traffic In (Mbps)" stroke="#818cf8" fill="#818cf8" fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />
                                    <Area type="monotone" dataKey="out_mbps" name="Traffic Out (Mbps)" stroke="#34d399" fill="#34d399" fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />
                                </>
                            )}
                            {type === 'icmp' && <Area type="monotone" dataKey="latency" name="Ping (ms)" stroke="#a3e635" fill="#a3e635" fillOpacity={0.2} strokeWidth={2} isAnimationActive={false} />}
                            {type === 'system' && sensorId === 'cpu' && <Area type="step" dataKey="cpu" name="CPU (%)" stroke="#fb923c" fill="#fb923c" fillOpacity={0.2} strokeWidth={2} isAnimationActive={false} />}
                            {type === 'system' && sensorId === 'mem' && <Area type="monotone" dataKey="mem" name="Memory (%)" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.2} strokeWidth={2} isAnimationActive={false} />}
                            {type === 'system' && sensorId === 'uptime' && <Area type="step" dataKey="uptime" name="Uptime (s)" stroke="#eab308" fill="#eab308" fillOpacity={0.2} strokeWidth={2} isAnimationActive={false} />}
                            {type === 'optical' && (
                                <>
                                    <Area type="monotone" dataKey="rx_dbm" name="RX Power (dBm)" stroke="#10b981" fill="#10b981" fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />
                                    <Area type="monotone" dataKey="tx_dbm" name="TX Power (dBm)" stroke="#818cf8" fill="#818cf8" fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />
                                </>
                            )}
                         </AreaChart>
                     </ResponsiveContainer>
                  ) : (
                      <div className="h-full flex items-center justify-center text-zinc-500 text-sm gap-2">
                          <svg className="animate-spin h-5 w-5 text-zinc-600" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                          Loading Historical Data...
                      </div>
                  )}
              </div>
          </div>

          {/* Channels List */}
          {renderChannels()}

          {/* Footer Stats summary */}
          <div className="mt-8 bg-zinc-900/60 border border-zinc-800 rounded-lg p-4 flex flex-wrap items-center justify-center gap-8 text-sm">
              <div className="flex items-center gap-2">
                  <span className="text-zinc-500">Min:</span>
                  <span className="text-zinc-200 font-mono font-medium">{min.toFixed(2)} {unit}</span>
              </div>
              <div className="w-px h-4 bg-zinc-700 hidden sm:block"></div>
              <div className="flex items-center gap-2">
                  <span className="text-zinc-500">Avg:</span>
                  <span className="text-zinc-200 font-mono font-medium">{avg.toFixed(2)} {unit}</span>
              </div>
              <div className="w-px h-4 bg-zinc-700 hidden sm:block"></div>
              <div className="flex items-center gap-2">
                  <span className="text-zinc-500">Max:</span>
                  <span className="text-zinc-200 font-mono font-medium">{max.toFixed(2)} {unit}</span>
              </div>
          </div>

          {/* Footer Actions */}
          <div className="mt-8 pt-6 border-t border-zinc-800/50 flex flex-wrap items-center gap-3">
              <button className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm font-medium transition-colors">Edit Settings</button>
              <button className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm font-medium transition-colors">View History</button>
              <button className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm font-medium transition-colors ml-auto text-rose-400 hover:bg-rose-500/10">Delete Sensor</button>
          </div>

      </div>
    </div>
  );
}
