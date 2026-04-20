/**
 * Configuration loader for nexus-admin CLI.
 *
 * Priority: env vars > ~/.nexus/admin.json > defaults
 */
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface AdminConfig {
  apiKey: string;
  apiUrl: string;
}

interface ConfigFile {
  apiKey?: string;
  apiUrl?: string;
}

function loadConfigFile(): ConfigFile {
  const configPath = join(homedir(), '.nexus', 'admin.json');
  try {
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as ConfigFile;
  } catch {
    return {};
  }
}

export function loadConfig(): AdminConfig {
  const file = loadConfigFile();
  const apiKey = process.env['NEXUS_API_KEY'] ?? file.apiKey ?? '';
  const apiUrl = process.env['NEXUS_API_URL'] ?? file.apiUrl ?? 'http://localhost:3002';

  if (!apiKey) {
    console.error(
      'Error: No API key found.\n' +
      'Set NEXUS_API_KEY env var or add "apiKey" to ~/.nexus/admin.json',
    );
    process.exit(1);
  }

  return { apiKey, apiUrl };
}
