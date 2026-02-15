"use client";

import { useEffect, useState } from "react";
import { getProjects, getContacts } from "@/lib/api";
import { Users, Mail, Phone, Building, Calendar } from "lucide-react";
import { format } from "date-fns";

interface Project {
  id: string;
  name: string;
}

interface Contact {
  id: string;
  projectId: string;
  name: string;
  email?: string;
  phone?: string;
  organization?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export default function ContactsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [contacts, setContacts] = useState<Contact[]>([]);
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
    getContacts(selectedProject)
      .then((data) => setContacts(data as Contact[]))
      .catch((err) => setError(err.message));
  }, [selectedProject]);

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-40 bg-gray-200 rounded"></div>
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

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Contacts</h1>
          <p className="text-gray-600 mt-2">
            Manage contacts across your projects
          </p>
        </div>
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
          {contacts.length} contact{contacts.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {contacts.map((contact) => (
          <div
            key={contact.id}
            className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow"
          >
            <div className="flex items-start gap-4">
              <div className="p-3 bg-blue-100 text-blue-700 rounded-lg">
                <Users className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900">
                  {contact.name}
                </h3>

                <div className="mt-3 space-y-2">
                  {contact.email && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Mail className="w-4 h-4" />
                      <a
                        href={`mailto:${contact.email}`}
                        className="hover:text-blue-600"
                      >
                        {contact.email}
                      </a>
                    </div>
                  )}
                  {contact.phone && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Phone className="w-4 h-4" />
                      <a
                        href={`tel:${contact.phone}`}
                        className="hover:text-blue-600"
                      >
                        {contact.phone}
                      </a>
                    </div>
                  )}
                  {contact.organization && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Building className="w-4 h-4" />
                      <span>{contact.organization}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-xs text-gray-500 mt-3">
                    <Calendar className="w-3 h-3" />
                    <span>
                      Added {format(new Date(contact.createdAt), "MMM d, yyyy")}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {contacts.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
          <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">No contacts yet</h3>
          <p className="text-gray-500 mt-2">
            Contacts will appear here as they are added to the project
          </p>
        </div>
      )}
    </div>
  );
}
