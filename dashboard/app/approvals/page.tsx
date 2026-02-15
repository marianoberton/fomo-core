"use client";

import { useEffect, useState } from "react";
import { getApprovals, approveRequest, rejectRequest } from "@/lib/api";
import { AlertCircle, CheckCircle, XCircle, Clock, Wrench } from "lucide-react";
import { format } from "date-fns";

interface Approval {
  id: string;
  projectId: string;
  toolId: string;
  toolInput: unknown;
  sessionId: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  note?: string;
}

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const loadApprovals = () => {
    const status = filter === "pending" ? "pending" : undefined;
    getApprovals(status)
      .then((data) => setApprovals(data as Approval[]))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadApprovals();
  }, [filter]);

  const handleApprove = async (id: string) => {
    setProcessingId(id);
    try {
      await approveRequest(id, "Approved via dashboard");
      loadApprovals();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      }
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (id: string) => {
    setProcessingId(id);
    try {
      await rejectRequest(id, "Rejected via dashboard");
      loadApprovals();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      }
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-32 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const pendingCount = approvals.filter((a) => a.status === "pending").length;

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Approvals</h1>
          <p className="text-gray-600 mt-2">
            Review and approve high-risk tool executions
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as "pending" | "all")}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="pending">Pending Only</option>
            <option value="all">All Approvals</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error}
        </div>
      )}

      {pendingCount > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-700" />
          <p className="text-yellow-700">
            <span className="font-semibold">{pendingCount}</span> approval
            {pendingCount !== 1 ? "s" : ""} waiting for review
          </p>
        </div>
      )}

      <div className="space-y-4">
        {approvals.map((approval) => (
          <div
            key={approval.id}
            className={`bg-white border rounded-lg p-6 ${
              approval.status === "pending"
                ? "border-yellow-300 shadow-sm"
                : "border-gray-200"
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4 flex-1">
                <div
                  className={`p-3 rounded-lg ${
                    approval.status === "pending"
                      ? "bg-yellow-100 text-yellow-700"
                      : approval.status === "approved"
                      ? "bg-green-100 text-green-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  <Wrench className="w-6 h-6" />
                </div>

                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold text-gray-900">
                      {approval.toolId}
                    </h3>
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                        approval.status === "pending"
                          ? "bg-yellow-100 text-yellow-700"
                          : approval.status === "approved"
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {approval.status}
                    </span>
                  </div>

                  <div className="text-sm text-gray-600 space-y-1">
                    <p>Session: {approval.sessionId.slice(0, 12)}...</p>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      Requested {format(new Date(approval.requestedAt), "MMM d, yyyy HH:mm")}
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="text-sm font-medium text-gray-700 mb-1">
                      Tool Input:
                    </div>
                    <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-x-auto">
                      {JSON.stringify(approval.toolInput, null, 2)}
                    </pre>
                  </div>

                  {approval.note && (
                    <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded">
                      <div className="text-sm font-medium text-blue-900 mb-1">
                        Note:
                      </div>
                      <p className="text-sm text-blue-700">{approval.note}</p>
                    </div>
                  )}

                  {approval.resolvedAt && (
                    <div className="mt-2 text-xs text-gray-500">
                      Resolved {format(new Date(approval.resolvedAt), "MMM d, yyyy HH:mm")}
                      {approval.resolvedBy && ` by ${approval.resolvedBy}`}
                    </div>
                  )}
                </div>
              </div>

              {approval.status === "pending" && (
                <div className="flex gap-2 ml-4">
                  <button
                    onClick={() => handleApprove(approval.id)}
                    disabled={processingId === approval.id}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 transition-colors"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Approve
                  </button>
                  <button
                    onClick={() => handleReject(approval.id)}
                    disabled={processingId === approval.id}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-400 transition-colors"
                  >
                    <XCircle className="w-4 h-4" />
                    Reject
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {approvals.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
          <CheckCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">
            {filter === "pending" ? "No pending approvals" : "No approvals yet"}
          </h3>
          <p className="text-gray-500 mt-2">
            {filter === "pending"
              ? "All approval requests have been processed"
              : "Approval requests will appear here"}
          </p>
        </div>
      )}
    </div>
  );
}
