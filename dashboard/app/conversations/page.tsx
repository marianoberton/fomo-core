"use client";

import { useEffect, useState } from "react";
import { getProjects, getSessions, getSessionMessages } from "@/lib/api";
import {
  MessageSquare,
  Calendar,
  User,
  ChevronDown,
  ChevronUp,
  Wrench,
} from "lucide-react";
import { format } from "date-fns";

interface Project {
  id: string;
  name: string;
}

interface Session {
  id: string;
  projectId: string;
  status: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    input: unknown;
    output?: unknown;
  }>;
}

export default function ConversationsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
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
    getSessions(selectedProject, "active")
      .then((data) => {
        const s = data as Session[];
        setSessions(s);
        if (s.length > 0) {
          setSelectedSession(s[0].id);
        }
      })
      .catch((err) => setError(err.message));
  }, [selectedProject]);

  useEffect(() => {
    if (!selectedSession) return;
    getSessionMessages(selectedSession)
      .then((data) => setMessages(data as Message[]))
      .catch((err) => setError(err.message));
  }, [selectedSession]);

  const toggleTool = (toolId: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) {
        next.delete(toolId);
      } else {
        next.add(toolId);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
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
        <h1 className="text-3xl font-bold text-gray-900">Conversations</h1>
        <p className="text-gray-600 mt-2">View sessions and message history</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Project Selector */}
        <div className="lg:col-span-1 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Project
            </label>
            <select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Sessions List */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Sessions ({sessions.length})
            </label>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => setSelectedSession(session.id)}
                  className={`w-full text-left p-3 border rounded-lg transition-colors ${
                    selectedSession === session.id
                      ? "bg-blue-50 border-blue-300"
                      : "bg-white border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-center gap-2 text-sm">
                    <MessageSquare className="w-4 h-4" />
                    <span className="truncate">{session.id.slice(0, 8)}...</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {format(new Date(session.createdAt), "MMM d, HH:mm")}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="lg:col-span-3">
          <div className="bg-white border border-gray-200 rounded-lg">
            <div className="p-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                Message History
              </h2>
              <p className="text-sm text-gray-500">
                {messages.length} message{messages.length !== 1 ? "s" : ""}
              </p>
            </div>

            <div className="p-4 space-y-4 max-h-[600px] overflow-y-auto">
              {messages.map((msg) => (
                <div key={msg.id} className="space-y-2">
                  <div
                    className={`p-4 rounded-lg ${
                      msg.role === "user"
                        ? "bg-blue-50 border border-blue-200"
                        : msg.role === "assistant"
                        ? "bg-gray-50 border border-gray-200"
                        : "bg-yellow-50 border border-yellow-200"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <User className="w-4 h-4" />
                      <span className="text-sm font-medium capitalize">
                        {msg.role}
                      </span>
                      <span className="text-xs text-gray-500">
                        {format(new Date(msg.createdAt), "HH:mm:ss")}
                      </span>
                    </div>
                    <p className="text-sm text-gray-900 whitespace-pre-wrap">
                      {msg.content}
                    </p>
                  </div>

                  {/* Tool Calls */}
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="ml-6 space-y-2">
                      {msg.toolCalls.map((tool) => {
                        const isExpanded = expandedTools.has(tool.id);
                        return (
                          <div
                            key={tool.id}
                            className="border border-purple-200 bg-purple-50 rounded-lg"
                          >
                            <button
                              onClick={() => toggleTool(tool.id)}
                              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-purple-100 transition-colors"
                            >
                              <div className="flex items-center gap-2">
                                <Wrench className="w-4 h-4 text-purple-700" />
                                <span className="text-sm font-medium text-purple-900">
                                  {tool.name}
                                </span>
                              </div>
                              {isExpanded ? (
                                <ChevronUp className="w-4 h-4 text-purple-700" />
                              ) : (
                                <ChevronDown className="w-4 h-4 text-purple-700" />
                              )}
                            </button>
                            {isExpanded && (
                              <div className="px-4 pb-3 space-y-2 text-xs">
                                <div>
                                  <div className="font-medium text-purple-900 mb-1">
                                    Input:
                                  </div>
                                  <pre className="bg-white p-2 rounded border border-purple-200 overflow-x-auto">
                                    {JSON.stringify(tool.input, null, 2)}
                                  </pre>
                                </div>
                                {tool.output !== undefined && (
                                  <div>
                                    <div className="font-medium text-purple-900 mb-1">
                                      Output:
                                    </div>
                                    <pre className="bg-white p-2 rounded border border-purple-200 overflow-x-auto">
                                      {JSON.stringify(tool.output, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}

              {messages.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <MessageSquare className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                  <p>No messages in this session</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
