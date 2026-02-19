import path from "path";
import dns from "dns/promises";

// ── Shell command allowlist ──────────────────────────────────────────────

const SHELL_ALLOWLIST = new Set([
  "git", "gh", "ls", "cat", "echo", "date", "mkdir", "cp", "mv",
  "find", "grep", "head", "tail", "wc", "sort", "uniq", "diff",
  "curl", "wget",
]);

const DANGEROUS_PATTERNS = [
  /`/,           // backtick execution
  /\$\(/,        // subshell execution
  /\beval\b/,    // eval
  /\bexec\b/,    // exec
  /\bsource\b/,  // source
  />>\s*\/etc/,  // append to /etc
  /\/dev\//,     // device files
];

/**
 * Extract the base binary name from a command segment.
 * Handles env vars prefixed (e.g. FOO=bar cmd) and absolute paths (e.g. /usr/bin/git).
 */
function extractBinary(segment: string): string {
  const trimmed = segment.trim();
  // Skip leading env var assignments like VAR=value
  const tokens = trimmed.split(/\s+/);
  for (const token of tokens) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
    // Return just the basename for absolute/relative paths
    return path.basename(token);
  }
  return tokens[0] ? path.basename(tokens[0]) : "";
}

export function validateShellCommand(command: string): void {
  // Check dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error(`shell_command: command rejected (dangerous pattern: ${pattern.source})`);
    }
  }

  // Check that the "." command is not used as a standalone command (source alias)
  // Match: starts with "." followed by space, or after pipe/semicolon
  if (/(?:^|\||\;)\s*\.\s+/.test(command)) {
    throw new Error("shell_command: command rejected (dangerous pattern: . command)");
  }

  // Split on pipes and semicolons, check each segment
  const segments = command.split(/[|;]/).map(s => s.trim()).filter(Boolean);
  for (const segment of segments) {
    const binary = extractBinary(segment);
    if (binary && !SHELL_ALLOWLIST.has(binary)) {
      throw new Error(`shell_command: binary '${binary}' is not in the allowlist`);
    }
  }
}

// ── File path restriction ────────────────────────────────────────────────

const ALLOWED_PATH_PREFIXES = [
  "/Users/manavpanchal/Desktop/Projects",
  "/tmp",
];

export function validateFilePath(filePath: string): void {
  const resolved = path.resolve(filePath);
  const allowed = ALLOWED_PATH_PREFIXES.some(prefix => resolved.startsWith(prefix + "/") || resolved === prefix);
  if (!allowed) {
    throw new Error(`File access denied: path '${resolved}' is outside allowed directories`);
  }
}

// ── SSRF protection ──────────────────────────────────────────────────────

function isPrivateIP(ip: string): boolean {
  // IPv6 loopback
  if (ip === "::1" || ip === "::ffff:127.0.0.1") return true;

  // IPv6 private (fd00::/8)
  if (ip.toLowerCase().startsWith("fd")) return true;

  // IPv4 ranges
  const parts = ip.replace("::ffff:", "").split(".").map(Number);
  if (parts.length === 4) {
    // 127.0.0.0/8
    if (parts[0] === 127) return true;
    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) return true;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 169.254.0.0/16 (link-local)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 0.0.0.0
    if (parts[0] === 0) return true;
  }

  return false;
}

export async function validateUrlNotSSRF(urlString: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error(`web_fetch: invalid URL: ${urlString}`);
  }

  const hostname = parsed.hostname;

  // Resolve hostname to IP
  try {
    const { address } = await dns.lookup(hostname);
    if (isPrivateIP(address)) {
      throw new Error(`web_fetch: URL resolves to private/internal IP (${address}), request blocked`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("request blocked")) throw err;
    // DNS lookup failed — block for safety
    throw new Error(`web_fetch: could not resolve hostname '${hostname}'`);
  }
}

// ── SQL column allowlists ────────────────────────────────────────────────

export const TASK_COLUMN_ALLOWLIST = new Set([
  "title", "description", "status", "priority", "due_date", "recurrence", "tags", "metadata",
]);

export const ENTITY_COLUMN_ALLOWLIST = new Set([
  "type", "name", "properties", "tags", "parent_id", "source_id",
]);
