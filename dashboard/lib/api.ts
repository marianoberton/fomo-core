/**
 * API client for Nexus Core backend.
 * Connects to the REST API at /api/v1/*
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api/v1";

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: { message: "Unknown error" } }));
    throw new ApiError(response.status, errorData.error?.message || "Request failed");
  }

  const data = await response.json();
  return (data.data || data) as T;
}

// ─── Projects ───────────────────────────────────────────────────
export async function getProjects(): Promise<unknown[]> {
  return fetchApi<unknown[]>("/projects");
}

export async function getProject(id: string): Promise<unknown> {
  return fetchApi<unknown>(`/projects/${id}`);
}

// ─── Sessions ───────────────────────────────────────────────────
export async function getSessions(projectId: string, status?: string): Promise<unknown[]> {
  const query = status ? `?status=${status}` : "";
  return fetchApi<unknown[]>(`/projects/${projectId}/sessions${query}`);
}

export async function getSession(sessionId: string): Promise<unknown> {
  return fetchApi<unknown>(`/sessions/${sessionId}`);
}

export async function getSessionMessages(sessionId: string): Promise<unknown[]> {
  return fetchApi<unknown[]>(`/sessions/${sessionId}/messages`);
}

// ─── Contacts ───────────────────────────────────────────────────
export async function getContacts(projectId: string): Promise<unknown[]> {
  return fetchApi<unknown[]>(`/projects/${projectId}/contacts`);
}

// ─── Approvals ──────────────────────────────────────────────────
export async function getApprovals(status?: string): Promise<unknown[]> {
  const query = status ? `?status=${status}` : "";
  return fetchApi<unknown[]>(`/approvals${query}`);
}

export async function approveRequest(id: string, note?: string): Promise<unknown> {
  return fetchApi<unknown>(`/approvals/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

export async function rejectRequest(id: string, note?: string): Promise<unknown> {
  return fetchApi<unknown>(`/approvals/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

// ─── Usage/Costs ────────────────────────────────────────────────
export async function getUsage(projectId: string, period: string): Promise<unknown> {
  return fetchApi<unknown>(`/projects/${projectId}/usage?period=${period}`);
}

export async function getDashboardOverview(): Promise<unknown> {
  return fetchApi<unknown>("/dashboard/overview");
}

// ─── Traces ─────────────────────────────────────────────────────
export async function getTraces(projectId?: string): Promise<unknown[]> {
  const query = projectId ? `?projectId=${projectId}` : "";
  return fetchApi<unknown[]>(`/traces${query}`);
}

export async function getTrace(id: string): Promise<unknown> {
  return fetchApi<unknown>(`/traces/${id}`);
}

// ─── Prompt Layers ──────────────────────────────────────────────
export async function getPromptLayers(projectId: string, layerType?: string): Promise<unknown[]> {
  const query = layerType ? `?layerType=${layerType}` : "";
  return fetchApi<unknown[]>(`/projects/${projectId}/prompt-layers${query}`);
}

export async function createPromptLayer(projectId: string, data: {
  layerType: "identity" | "instructions" | "safety";
  content: string;
  createdBy: string;
  changeReason: string;
}): Promise<unknown> {
  return fetchApi<unknown>(`/projects/${projectId}/prompt-layers`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function activatePromptLayer(layerId: string): Promise<unknown> {
  return fetchApi<unknown>(`/prompt-layers/${layerId}/activate`, {
    method: "POST",
  });
}
