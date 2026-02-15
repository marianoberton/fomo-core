"use client";

import { useEffect, useState } from "react";
import { getDashboardOverview } from "@/lib/api";
import {
  FolderKanban,
  Bot,
  MessageSquare,
  AlertCircle,
  DollarSign,
  TrendingUp,
} from "lucide-react";

interface OverviewData {
  projectsCount: number;
  activeAgentsCount: number;
  activeSessionsCount: number;
  pendingApprovalsCount: number;
  todayCostUsd: number;
  weekCostUsd: number;
}

export default function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDashboardOverview()
      .then((data) => setData(data as OverviewData))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-32 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          Error loading overview: {error || "Unknown error"}
        </div>
      </div>
    );
  }

  const stats = [
    {
      label: "Projects",
      value: data.projectsCount,
      icon: FolderKanban,
      color: "bg-blue-100 text-blue-700",
    },
    {
      label: "Active Agents",
      value: data.activeAgentsCount,
      icon: Bot,
      color: "bg-green-100 text-green-700",
    },
    {
      label: "Active Sessions",
      value: data.activeSessionsCount,
      icon: MessageSquare,
      color: "bg-purple-100 text-purple-700",
    },
    {
      label: "Pending Approvals",
      value: data.pendingApprovalsCount,
      icon: AlertCircle,
      color: "bg-yellow-100 text-yellow-700",
    },
    {
      label: "Today's Cost",
      value: `$${data.todayCostUsd.toFixed(4)}`,
      icon: DollarSign,
      color: "bg-emerald-100 text-emerald-700",
    },
    {
      label: "Week's Cost",
      value: `$${data.weekCostUsd.toFixed(4)}`,
      icon: TrendingUp,
      color: "bg-indigo-100 text-indigo-700",
    },
  ];

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dashboard Overview</h1>
        <p className="text-gray-600 mt-2">
          Monitor your Nexus Core agents and projects
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">{stat.label}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-2">
                    {stat.value}
                  </p>
                </div>
                <div className={`p-3 rounded-lg ${stat.color}`}>
                  <Icon className="w-6 h-6" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <a
            href="/conversations"
            className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <MessageSquare className="w-5 h-5 text-gray-600" />
            <div>
              <p className="font-medium text-gray-900">View Conversations</p>
              <p className="text-sm text-gray-500">Browse active sessions</p>
            </div>
          </a>
          <a
            href="/approvals"
            className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <AlertCircle className="w-5 h-5 text-gray-600" />
            <div>
              <p className="font-medium text-gray-900">Pending Approvals</p>
              <p className="text-sm text-gray-500">
                {data.pendingApprovalsCount} waiting for review
              </p>
            </div>
          </a>
        </div>
      </div>
    </div>
  );
}
