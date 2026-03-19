"use client";

import { useState, useEffect } from "react";

interface AddSensorWizardProps {
  deviceId: string;
  isOpen: boolean;
  onClose: () => void;
  onAdded: () => void;
}

export default function AddSensorWizard({ deviceId, isOpen, onClose, onAdded }: AddSensorWizardProps) {
  const [step, setStep] = useState<number>(1);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  
  // Discovery State
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [interfaces, setInterfaces] = useState<any[]>([]);
  const [selectedIfs, setSelectedIfs] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setSelectedType(null);
      setInterfaces([]);
      setSelectedIfs({});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSelectType = async (type: string) => {
    setSelectedType(type);
    if (type === "snmp_traffic") {
      setStep(2);
      setIsDiscovering(true);
      const opts = { method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } };
      try {
        await fetch(`/api/devices/${deviceId}/discover`, opts);
        const res = await fetch(`/api/devices/${deviceId}/interfaces`, { headers: opts.headers });
        const data = await res.json();
        setInterfaces(data || []);
      } catch (e) {
        console.error("Discovery failed", e);
      }
      setIsDiscovering(false);
    } else {
      setStep(3); // Auto-complete for system sensors
    }
  };

  const handleToggleIf = (ifIndex: number) => {
    setSelectedIfs(prev => ({ ...prev, [ifIndex]: !prev[ifIndex] }));
  };

  const submitInterfaces = async () => {
    setIsDiscovering(true); // Re-using for loading state
    const opts = {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
      body: JSON.stringify({ is_monitored: true })
    };
    
    const promises = Object.entries(selectedIfs)
      .filter(([_, isSelected]) => isSelected)
      .map(([ifIndex]) => fetch(`/api/devices/${deviceId}/interfaces/${ifIndex}`, opts));
      
    await Promise.all(promises);
    setIsDiscovering(false);
    onAdded();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#18181b] border border-zinc-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50">
          <div>
            <h2 className="text-lg font-semibold text-white">Add Sensor to Device</h2>
            <p className="text-sm text-zinc-400">Step {step}: {step === 1 ? 'Select Sensor Type' : step === 2 ? 'Select Interfaces' : 'Complete'}</p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white transition-colors">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1">
          {step === 1 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <button onClick={() => handleSelectType("snmp_traffic")} className="flex flex-col items-center justify-center p-6 bg-zinc-800/20 border border-zinc-700/50 hover:border-indigo-500 hover:bg-indigo-500/10 rounded-xl transition-all group text-left w-full h-full">
                <div className="w-12 h-12 rounded-full bg-indigo-500/20 flex items-center justify-center mb-4 group-hover:bg-indigo-500/30">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
                </div>
                <h3 className="text-white font-medium text-center">SNMP Traffic</h3>
                <p className="text-xs text-zinc-400 mt-2 text-center">Monitor bandwidth (In/Out) and operational status of network interfaces.</p>
              </button>
              
              <button onClick={() => handleSelectType("ping")} className="flex flex-col items-center justify-center p-6 bg-zinc-800/20 border border-zinc-700/50 hover:border-emerald-500 hover:bg-emerald-500/10 rounded-xl transition-all group text-left w-full h-full">
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center mb-4 group-hover:bg-emerald-500/30">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path><path d="M2 12h20"></path></svg>
                </div>
                <h3 className="text-white font-medium text-center">Ping (ICMP)</h3>
                <p className="text-xs text-zinc-400 mt-2 text-center">Monitor round-trip-time latency and packet loss.</p>
              </button>

              <button onClick={() => handleSelectType("system")} className="flex flex-col items-center justify-center p-6 bg-zinc-800/20 border border-zinc-700/50 hover:border-orange-500 hover:bg-orange-500/10 rounded-xl transition-all group text-left w-full h-full">
                <div className="w-12 h-12 rounded-full bg-orange-500/20 flex items-center justify-center mb-4 group-hover:bg-orange-500/30">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fb923c" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg>
                </div>
                <h3 className="text-white font-medium text-center">CPU / Memory</h3>
                <p className="text-xs text-zinc-400 mt-2 text-center">System health resources via HOST-RESOURCES-MIB.</p>
              </button>
            </div>
          )}

          {step === 2 && selectedType === "snmp_traffic" && (
            <div className="flex flex-col h-full">
              {isDiscovering ? (
                <div className="flex flex-col items-center justify-center py-20">
                  <svg className="animate-spin h-8 w-8 text-indigo-500 mb-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                  <p className="text-zinc-400 text-sm">Walking IF-MIB to discover physical interfaces...</p>
                </div>
              ) : (
                <div className="overflow-x-auto border border-zinc-800 rounded-lg">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-zinc-800/50 border-b border-zinc-800 text-zinc-400 uppercase text-xs">
                      <tr>
                        <th className="p-3 w-12 text-center">Select</th>
                        <th className="p-3">Index</th>
                        <th className="p-3">Interface Name</th>
                        <th className="p-3">Alias / Description</th>
                        <th className="p-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50">
                      {interfaces.length === 0 ? (
                        <tr><td colSpan={5} className="py-8 text-center text-zinc-500">No interfaces discovered via SNMP. Please verify connectivity and credentials.</td></tr>
                      ) : interfaces.filter(i => !i.is_monitored).length === 0 ? (
                        <tr><td colSpan={5} className="py-8 text-center text-zinc-500">All discovered interfaces are already being monitored.</td></tr>
                      ) : interfaces.map((intf: any) => intf.is_monitored ? null : (
                        <tr key={intf.if_index} className="hover:bg-zinc-800/30 transition-colors">
                          <td className="p-3 text-center">
                            <input 
                              type="checkbox" 
                              className="w-4 h-4 rounded border-zinc-600 bg-zinc-700 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-zinc-900"
                              checked={!!selectedIfs[intf.if_index]}
                              onChange={() => handleToggleIf(intf.if_index)}
                            />
                          </td>
                          <td className="p-3 text-zinc-400 font-mono text-xs">{intf.if_index}</td>
                          <td className="p-3 text-zinc-200 font-medium">{intf.name || '-'}</td>
                          <td className="p-3 text-zinc-400 truncate max-w-xs">{intf.description || <span className="text-zinc-600 italic">None</span>}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 border rounded text-[10px] font-bold uppercase tracking-wider ${
                              intf.status === 'up' ? 'bg-green-500/10 border-green-500/20 text-green-400' :
                              intf.status === 'down' ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' :
                              'bg-zinc-800 border-zinc-700 text-zinc-400'
                            }`}>
                              {intf.status || 'Unknown'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col items-center justify-center py-16">
               <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mb-4"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
               <h3 className="text-white text-xl font-medium">Sensor Included By Default</h3>
               <p className="text-zinc-400 mt-2 text-center max-w-sm">
                 The core system automatically monitors Ping, Uptime, CPU, and Memory for every provisioned device. These are already visible on the Overview page!
               </p>
               <button onClick={onClose} className="mt-8 px-6 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-sm transition-colors">
                 Close Wizard
               </button>
            </div>
          )}
        </div>

        {/* Footer actions */}
        {step === 2 && (
          <div className="px-6 py-4 border-t border-zinc-800 bg-zinc-900/50 flex justify-between items-center">
            <button onClick={() => setStep(1)} className="px-4 py-2 bg-transparent text-zinc-400 hover:text-white transition-colors text-sm font-medium">
              &larr; Back
            </button>
            <button 
              onClick={submitInterfaces} 
              disabled={isDiscovering || Object.values(selectedIfs).filter(v=>v).length === 0}
              className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              Add Selected Sensors
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
