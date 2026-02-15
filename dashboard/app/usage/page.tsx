"use client";

import { useEffect, useState } from "react";
import { getProjects, getUsage } from "@/lib/api";
import { DollarSign, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

interface Project {
  id: string;
  name: string;
  config?: {
    budget?: {
      dailyLimitUsd?: number;
      monthlyLimitUsd?: number;
    };
  };
}

interface UsageRecord {
  id: string;
  projectId: string;
  timestamp: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface UsageStats {
  totalCost: number;
  totalTokens: number;
  records: UsageRecord[];
}

export default function UsagePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [period, setPeriod] = useState<"day" | "week" | "month">("day");
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProjects()
      .then((data) => {
        const p = data as Project[];
        setProjects(p);
        if (p.length > 0) {
          setSelectedProject(p[0].id);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    getUsage(selectedProject, period)
      .then((data) => setUsage(data as UsageStats))
      .catch((err) => setError(err.message));
  }, [selectedProject, period]);

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-32 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          Error: {error}
        </div>
      </div>
    );
  }

  const currentProject = projects.find((p) => p.id === selectedProject);
  const dailyLimit = currentProject?.config?.budget?.dailyLimitUsd;
  const monthlyLimit = currentProject?.config?.budget?.monthlyLimitUsd;
  const currentCost = usage?.totalCost || 0;

  let budgetWarning = null;
  if (period === "day" && dailyLimit && currentCost > dailyLimit * 0.8) {
    budgetWarning = {
      type: "daily",
      limit: dailyLimit,
      usage: currentCost,
      percent: (currentCost / dailyLimit) * 100,
    };
  } else if (period === "month" && monthlyLimit && currentCost > monthlyLimit * 0.8) {
    budgetWarning = {
      type: "monthly",
      limit: monthlyLimit,
      usage: currentCost,
      percent: (currentCost / monthlyLimit) * 100,
    };
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Usage & Costs</h1>
        <p className="text-gray-600 mt-2">
          Monitor LLM usage and costs across projects
        </p>
      </div>

      <div className="flex items-center gap-4">
        <select
          value={selectedProject}
          onChange={(e) => setSelectedProject(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as "day" | "week" | "month")}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="day">Today</option>
          <option value="week">This Week</option>
          <option value="month">This Month</option>
        </select>
      </div>

      {budgetWarning && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-700" />
          <div>
            <p className="text-yellow-700 font-medium">
              {budgetWarning.percent >= 100 ? "Budget Exceeded" : "Budget Warning"}
            </p>
            <p className="text-yellow-600 text-sm">
              {budgetWarning.type === "daily" ? "Daily" : "Monthly"} usage is at{" "}
              {budgetWarning.percent.toFixed(0)}% of limit ($
              {budgetWarning.usage.toFixed(4)} / ${budgetWarning.limit.toFixed(2)})
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Cost</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">
                ${currentCost.toFixed(4)}
              </p>
            </div>
            <div className="p-3 bg-green-100 text-green-700 rounded-lg">
              <DollarSign className="w-6 h-6" />
            </div>
          </div>
          {dailyLimit && period === "day" && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Daily Limit</span>
                <span className="font-medium">${dailyLimit.toFixed(2)}</span>
              </div>
              <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full ${
                    (currentCost / dailyLimit) * 100 >= 100
                      ? "bg-red-500"
                      : (currentCost / dailyLimit) * 100 >= 80
                      ? "bg-yellow-500"
                      : "bg-green-500"
                  }`}
                  style={{ width: `${Math.min((currentCost / dailyLimit) * 100, 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Tokens</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">
                {(usage?.totalTokens || 0).toLocaleString()}
              </p>
            </div>
            <div className="p-3 bg-blue-100 text-blue-700 rounded-lg">
              <TrendingUp className="w-6 h-6" />
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">API Calls</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">
                {usage?.records.length || 0}
              </p>
            </div>
            <div className="p-3 bg-purple-100 text-purple-700 rounded-lg">
              <TrendingDown className="w-6 h-6" />
            </div>
          </div>
        </div>
      </div>

      {/* Usage Records Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Usage Records</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Timestamp
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Provider
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Model
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                  Input Tokens
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                  Output Tokens
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                  Cost
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {usage?.records.map((record) => (
                <tr key={record.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-900">
                    {format(new Date(record.timestamp), "MMM d, HH:mm:ss")}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {record.provider}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {record.model}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 text-right">
                    {record.inputTokens.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 text-right">
                    {record.outputTokens.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 text-right">
                    ${record.costUsd.toFixed(6)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {usage?.records.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
          <DollarSign className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">No usage data</h3>
          <p className="text-gray-500 mt-2">
            No LLM API calls have been made in this period
          </p>
        </div>
      )}
    </div>
  );
}
