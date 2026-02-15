"use client";

import { useEffect, useState } from "react";
import { getProjects } from "@/lib/api";
import { FolderKanban, Calendar, CheckCircle, Pause } from "lucide-react";
import { format } from "date-fns";

interface Project {
  id: string;
  name: string;
  description?: string;
  status: "active" | "paused";
  createdAt: string;
  updatedAt: string;
  config?: {
    provider: string;
    budget?: {
      dailyLimitUsd?: number;
      monthlyLimitUsd?: number;
    };
  };
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProjects()
      .then((data) => setProjects(data as Project[]))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-24 bg-gray-200 rounded"></div>
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
          Error loading projects: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Projects</h1>
          <p className="text-gray-600 mt-2">
            Manage your Nexus Core projects and configurations
          </p>
        </div>
        <div className="text-sm text-gray-500">
          {projects.length} project{projects.length !== 1 ? "s" : ""}
        </div>
      </div>

      <div className="space-y-4">
        {projects.map((project) => (
          <div
            key={project.id}
            className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-blue-100 text-blue-700 rounded-lg">
                  <FolderKanban className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    {project.name}
                  </h3>
                  {project.description && (
                    <p className="text-gray-600 mt-1">{project.description}</p>
                  )}
                  <div className="flex items-center gap-4 mt-3 text-sm text-gray-500">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-4 h-4" />
                      Created {format(new Date(project.createdAt), "MMM d, yyyy")}
                    </div>
                    {project.config?.provider && (
                      <div className="px-2 py-1 bg-gray-100 rounded text-xs font-medium">
                        {project.config.provider}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div
                className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${
                  project.status === "active"
                    ? "bg-green-100 text-green-700"
                    : "bg-gray-100 text-gray-700"
                }`}
              >
                {project.status === "active" ? (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Active
                  </>
                ) : (
                  <>
                    <Pause className="w-4 h-4" />
                    Paused
                  </>
                )}
              </div>
            </div>

            {project.config?.budget && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <div className="flex gap-6 text-sm">
                  {project.config.budget.dailyLimitUsd && (
                    <div>
                      <span className="text-gray-500">Daily Limit:</span>{" "}
                      <span className="font-medium text-gray-900">
                        ${project.config.budget.dailyLimitUsd.toFixed(2)}
                      </span>
                    </div>
                  )}
                  {project.config.budget.monthlyLimitUsd && (
                    <div>
                      <span className="text-gray-500">Monthly Limit:</span>{" "}
                      <span className="font-medium text-gray-900">
                        ${project.config.budget.monthlyLimitUsd.toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {projects.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
          <FolderKanban className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">No projects yet</h3>
          <p className="text-gray-500 mt-2">
            Create your first project to get started with Nexus Core
          </p>
        </div>
      )}
    </div>
  );
}
