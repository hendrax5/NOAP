"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: username, password })
      });
      const data = await res.json();
      if (res.ok && data.access_token) {
        localStorage.setItem("token", data.access_token);
        localStorage.setItem("refresh_token", data.refresh_token ?? "");
        router.push("/dashboard");
      } else {
        setError(data.error || "Login failed");
      }
    } catch {
      setError("Network or server error");
    }
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-zinc-950 font-display">
      <div className="w-full max-w-sm p-8 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center p-3 bg-indigo-500/10 rounded-xl mb-4 text-indigo-400">
            <span className="material-symbols-outlined text-4xl">travel_explore</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white mb-1">NMS Platform</h1>
          <p className="text-zinc-500 text-sm">Sign in to your NOC account</p>
        </div>
        
        {error && <div className="mb-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 p-3 rounded-lg text-sm">{error}</div>}
        
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div>
            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2 block">Username</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)} required className="w-full h-11 bg-zinc-950 border border-zinc-800 rounded-xl px-4 text-white focus:outline-none focus:border-indigo-500" placeholder="admin" />
          </div>
          <div>
            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2 block">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className="w-full h-11 bg-zinc-950 border border-zinc-800 rounded-xl px-4 text-white focus:outline-none focus:border-indigo-500" placeholder="••••••••" />
          </div>
          <button type="submit" className="w-full h-11 bg-indigo-600 hover:bg-indigo-500 transition-colors text-white font-semibold rounded-xl mt-2">Sign In</button>
        </form>
      </div>
    </div>
  );
}
