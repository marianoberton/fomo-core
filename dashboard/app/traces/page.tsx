"use client";

import { useEffect, useState } from "react";
import { getProjects, getTraces, getTrace } from "@/lib/api";
import {
  Activity,
  Calendar,
  ChevronRight,
  CheckCircle,
  XCircle,
  Clock,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

interface Project {
  id: string;
  name: string;
}

interface TraceEvent {
  id: string;
  timestamp: string;
  type: string;
  data: unknown;
}

interface Trace {
  id: string;
  projectId: string;
  sessionId: string;
  status: "running" | "completed" | "error";
  startedAt: string;
  completedAt?: string;
  events?: TraceEvent[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
}

export default function TracesPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [traces, setTraces] = useState<Trace[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<Trace | null>(null);
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
    getTraces(selectedProject)
      .then((data) => setTraces(data as Trace[]))
      .catch((err) => setError(err.message));
  }, [selectedProject]);

  const handleTraceClick = async (id: string) => {
    try {
      const data = await getTrace(id);
      setSelectedTrace(data as Trace);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      }
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="h-64 bg-gray-200 rounded"></div>
            <div className="h-64 bg-gray-200 rounded"></div>
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

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Execution Traces</h1>
        <p className="text-gray-600 mt-2">
          Timeline of agent execution events
        </p>
      </div>

      <div className="flex items-center gap-4">
        <label className="text-sm font-medium text-gray-700">Project:</label>
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
        <span className="text-sm text-gray-500">
          {traces.length} trace{traces.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Traces List */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Recent Traces</h2>
          <div className="space-y-2 max-h-[700px] overflow-y-auto">
            {traces.map((trace) => (
              <button
                key={trace.id}
                onClick={() => handleTraceClick(trace.id)}
                className={`w-full text-left p-4 border rounded-lg transition-all ${
                  selectedTrace?.id === trace.id
                    ? "bg-blue-50 border-blue-300 shadow-sm"
                    : "bg-white border-gray-200 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-gray-600" />
                    <span className="text-sm font-medium text-gray-900">
                      {trace.id.slice(0, 12)}...
                    </span>
                  </div>
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-medium ${
                      trace.status === "completed"
                        ? "bg-green-100 text-green-700"
                        : trace.status === "error"
                        ? "bg-red-100 text-red-700"
                        : "bg-blue-100 text-blue-700"
                    }`}
                  >
                    {trace.status}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Clock className="w-3 h-3" />
                  {formatDistanceToNow(new Date(trace.startedAt), {
                    addSuffix: true,
                  })}
                </div>
                {trace.usage && (
                  <div className="mt-2 text-xs text-gray-600">
                    {trace.usage.inputTokens + trace.usage.outputTokens} tokens · $
                    {trace.usage.costUsd.toFixed(6)}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Trace Detail */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">
            Trace Detail
          </h2>
          {selectedTrace ? (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="p-4 border-b border-gray-200 bg-gray-50">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-gray-900">
                    {selectedTrace.id}
                  </span>
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-medium ${
                      selectedTrace.status === "completed"
                        ? "bg-green-100 text-green-700"
                        : selectedTrace.status === "error"
                        ? "bg-red-100 text-red-700"
                        : "bg-blue-100 text-blue-700"
                    }`}
                  >
                    {selectedTrace.status}
                  </span>
                </div>
                <div className="space-y-1 text-xs text-gray-600">
                  <div>Session: {selectedTrace.sessionId.slice(0, 12)}...</div>
                  <div>Started: {format(new Date(selectedTrace.startedAt), "MMM d, yyyy HH:mm:ss")}</div>
                  {selectedTrace.completedAt && (
                    <div>
                      Completed:{" "}
                      {format(new Date(selectedTrace.completedAt), "MMM d, yyyy HH:mm:ss")}
                    </div>
                  )}
                </div>
              </div>

              {/* Event Timeline */}
              <div className="p-4 max-h-[600px] overflow-y-auto">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">
                  Event Timeline
                </h3>
                <div className="space-y-3">
                  {selectedTrace.events?.map((event, idx) => (
                    <div key={event.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center ${
                            event.type.includes("error")
                              ? "bg-red-100 text-red-700"
                              : event.type.includes("complete")
                              ? "bg-green-100 text-green-700"
                              : "bg-blue-100 text-blue-700"
                          }`}
                        >
                          {event.type.includes("error") ? (
                            <XCircle className="w-4 h-4" />
                          ) : event.type.includes("complete") ? (
                            <CheckCircle className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </div>
                        {idx < (selectedTrace.events?.length || 0) - 1 && (
                          <div className="w-0.5 h-full bg-gray-200 my-1" />
                        )}
                      </div>
                      <div className="flex-1 pb-4">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-900">
                            {event.type}
                          </span>
                          <span className="text-xs text-gray-500">
                            {format(new Date(event.timestamp), "HH:mm:ss.SSS")}
                          </span>
                        </div>
                        <pre className="bg-gray-50 border border-gray-200 rounded p-2 text-xs overflow-x-auto">
                          {JSON.stringify(event.data, null, 2)}
                        </pre>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
              <Activity className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">Select a trace to view details</p>
            </div>
          )}
        </div>
      </div>

      {traces.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
          <Activity className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">No traces yet</h3>
          <p className="text-gray-500 mt-2">
            Execution traces will appear here as agents run
          </p>
        </div>
      )}
    </div>
  );
}
