"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FileText, GitBranch, Shield, Settings, BarChart3, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/reviews", label: "Reviews", icon: FileText },
  { href: "/graph", label: "Code Graph", icon: GitBranch },
  { href: "/rules", label: "Rules", icon: Shield },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/usage", label: "Usage & Audit", icon: BarChart3 },
];

export function Sidebar() {
  const pathname = usePathname();
  const { logout } = useAuth();

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r border-white/[0.06] bg-[#060911] flex flex-col">
      <div className="p-6 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <GitBranch className="h-3.5 w-3.5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white tracking-tight">AI Code Review</h1>
            <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Azure DevOps</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 space-y-0.5">
        {navItems.map((item) => {
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-150 ${
                active
                  ? "bg-white/[0.06] text-white"
                  : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
              }`}
            >
              {active && <span className="absolute left-0 w-[2px] h-5 rounded-r bg-emerald-400" />}
              <item.icon className={`h-4 w-4 ${active ? "text-emerald-400" : "text-slate-500 group-hover:text-slate-400"}`} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-white/[0.06]">
        <button
          onClick={logout}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-slate-500 hover:bg-white/[0.04] hover:text-slate-300 w-full transition-all duration-150 cursor-pointer"
        >
          <LogOut className="h-4 w-4" />
          Disconnect
        </button>
      </div>
    </aside>
  );
}
