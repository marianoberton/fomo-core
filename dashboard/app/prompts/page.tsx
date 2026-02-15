"use client";

import { useEffect, useState } from "react";
import { getProjects, getPromptLayers, activatePromptLayer } from "@/lib/api";
import {
  FileText,
  Clock,
  CheckCircle,
  Circle,
  User,
  AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";

type LayerType = "identity" | "instructions" | "safety";

interface Project {
  id: string;
  name: string;
}

interface PromptLayer {
  id: string;
  projectId: string;
  layerType: LayerType;
  content: string;
  version: number;
  active: boolean;
  createdBy: string;
  createdAt: string;
  changeReason?: string;
}

export default function PromptsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [activeTab, setActiveTab] = useState<LayerType>("identity");
  const [layers, setLayers] = useState<Record<LayerType, PromptLayer[]>>({
    identity: [],
    instructions: [],
    safety: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activating, setActivating] = useState<string | null>(null);

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

    const loadLayers = async () => {
      try {
        const [identityData, instructionsData, safetyData] = await Promise.all([
          getPromptLayers(selectedProject, "identity"),
          getPromptLayers(selectedProject, "instructions"),
          getPromptLayers(selectedProject, "safety"),
        ]);

        setLayers({
          identity: identityData as PromptLayer[],
          instructions: instructionsData as PromptLayer[],
          safety: safetyData as PromptLayer[],
        });
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        }
      }
    };

    loadLayers();
  }, [selectedProject]);

  const handleActivate = async (layerId: string) => {
    setActivating(layerId);
    try {
      await activatePromptLayer(layerId);
      // Reload layers
      const [identityData, instructionsData, safetyData] = await Promise.all([
        getPromptLayers(selectedProject, "identity"),
        getPromptLayers(selectedProject, "instructions"),
        getPromptLayers(selectedProject, "safety"),
      ]);
      setLayers({
        identity: identityData as PromptLayer[],
        instructions: instructionsData as PromptLayer[],
        safety: safetyData as PromptLayer[],
      });
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      }
    } finally {
      setActivating(null);
    }
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

  const tabs: Array<{ key: LayerType; label: string; icon: typeof FileText }> = [
    { key: "identity", label: "Identity", icon: User },
    { key: "instructions", label: "Instructions", icon: FileText },
    { key: "safety", label: "Safety", icon: AlertTriangle },
  ];

  const currentLayers = layers[activeTab];
  const activeLayers = currentLayers.filter((l) => l.active);
  const inactiveLayers = currentLayers.filter((l) => !l.active);

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Prompt Layers</h1>
        <p className="text-gray-600 mt-2">
          Manage system prompt layers: Identity, Instructions, and Safety
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
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                  isActive
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-600 hover:text-gray-900"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="font-medium">{tab.label}</span>
                <span
                  className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                    isActive
                      ? "bg-blue-100 text-blue-700"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {layers[tab.key].length}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Active Layer */}
      {activeLayers.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">
            Active Version
          </h2>
          {activeLayers.map((layer) => (
            <div
              key={layer.id}
              className="bg-green-50 border-2 border-green-300 rounded-lg p-6"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="w-5 h-5 text-green-700" />
                    <span className="text-lg font-semibold text-gray-900">
                      Version {layer.version}
                    </span>
                    <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                      ACTIVE
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-600">
                    <div className="flex items-center gap-1">
                      <User className="w-4 h-4" />
                      {layer.createdBy}
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      {format(new Date(layer.createdAt), "MMM d, yyyy HH:mm")}
                    </div>
                  </div>
                </div>
              </div>

              {layer.changeReason && (
                <div className="mb-3 p-3 bg-white border border-green-200 rounded">
                  <div className="text-sm font-medium text-gray-700 mb-1">
                    Change Reason:
                  </div>
                  <p className="text-sm text-gray-600">{layer.changeReason}</p>
                </div>
              )}

              <div>
                <div className="text-sm font-medium text-gray-700 mb-2">
                  Content:
                </div>
                <pre className="bg-white border border-green-200 rounded p-4 text-sm whitespace-pre-wrap overflow-x-auto">
                  {layer.content}
                </pre>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Version History */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">
          Version History
        </h2>
        <div className="space-y-3">
          {inactiveLayers.map((layer) => (
            <div
              key={layer.id}
              className="bg-white border border-gray-200 rounded-lg p-6"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Circle className="w-5 h-5 text-gray-400" />
                    <span className="text-lg font-semibold text-gray-900">
                      Version {layer.version}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-600">
                    <div className="flex items-center gap-1">
                      <User className="w-4 h-4" />
                      {layer.createdBy}
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      {format(new Date(layer.createdAt), "MMM d, yyyy HH:mm")}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleActivate(layer.id)}
                  disabled={activating === layer.id}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors text-sm font-medium"
                >
                  {activating === layer.id ? "Activating..." : "Activate"}
                </button>
              </div>

              {layer.changeReason && (
                <div className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded">
                  <div className="text-sm font-medium text-gray-700 mb-1">
                    Change Reason:
                  </div>
                  <p className="text-sm text-gray-600">{layer.changeReason}</p>
                </div>
              )}

              <details className="group">
                <summary className="cursor-pointer text-sm font-medium text-blue-600 hover:text-blue-700">
                  Show content
                </summary>
                <pre className="mt-2 bg-gray-50 border border-gray-200 rounded p-4 text-sm whitespace-pre-wrap overflow-x-auto">
                  {layer.content}
                </pre>
              </details>
            </div>
          ))}
        </div>

        {inactiveLayers.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
            <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500">No previous versions</p>
          </div>
        )}
      </div>

      {currentLayers.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
          <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">
            No {activeTab} layers yet
          </h3>
          <p className="text-gray-500 mt-2">
            Create a {activeTab} layer to define your agent&apos;s{" "}
            {activeTab === "identity"
              ? "personality and role"
              : activeTab === "instructions"
              ? "behavior and workflows"
              : "boundaries and constraints"}
          </p>
        </div>
      )}
    </div>
  );
}
