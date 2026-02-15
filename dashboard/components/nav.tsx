"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FolderKanban,
  MessageSquare,
  Users,
  CheckCircle,
  DollarSign,
  Activity,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/conversations", label: "Conversations", icon: MessageSquare },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/approvals", label: "Approvals", icon: CheckCircle },
  { href: "/usage", label: "Usage & Costs", icon: DollarSign },
  { href: "/traces", label: "Traces", icon: Activity },
  { href: "/prompts", label: "Prompt Layers", icon: FileText },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="w-64 border-r border-gray-200 bg-white h-screen sticky top-0 flex flex-col">
      <div className="p-6 border-b border-gray-200">
        <h1 className="text-2xl font-bold text-gray-900">Nexus Core</h1>
        <p className="text-sm text-gray-500 mt-1">Agent Dashboard</p>
      </div>

      <div className="flex-1 overflow-y-auto py-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-6 py-3 text-sm font-medium transition-colors",
                isActive
                  ? "bg-blue-50 text-blue-700 border-r-2 border-blue-700"
                  : "text-gray-700 hover:bg-gray-50 hover:text-gray-900"
              )}
            >
              <Icon className="w-5 h-5" />
              {item.label}
            </Link>
          );
        })}
      </div>

      <div className="p-4 border-t border-gray-200 text-xs text-gray-500">
        Nexus Core v0.1.0
      </div>
    </nav>
  );
}
