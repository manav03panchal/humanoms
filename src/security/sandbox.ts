import path from "path";
import dns from "dns/promises";

// ── Shell command validation ─────────────────────────────────────────────
// Runs inside Docker — allow everything, just block host-escape attempts.

const BLOCKED_BINARIES = new Set([
  "reboot", "shutdown", "poweroff", "halt", "init",
  "mount", "umount", "fdisk", "mkfs", "dd",
  "iptables", "ip6tables", "nftables",
  "insmod", "rmmod", "modprobe",
]);

export function validateShellCommand(command: string): void {
  // Block obvious host-escape / destructive-to-container patterns
  if (/\brm\s+(-\S+\s+)*\/\s*$/.test(command)) {
    throw new Error("shell_command: refusing to rm /");
  }

  // Check for blocked binaries in each pipe/semicolon segment
  const segments = command.split(/[|;&]/).map(s => s.trim()).filter(Boolean);
  for (const segment of segments) {
    const tokens = segment.split(/\s+/);
    for (const token of tokens) {
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
      const binary = path.basename(token);
      if (BLOCKED_BINARIES.has(binary)) {
        throw new Error(`shell_command: '${binary}' is blocked`);
      }
      break;
    }
  }
}

// ── File path restriction ────────────────────────────────────────────────

const ALLOWED_PATH_PREFIXES = (process.env.HUMANOMS_ALLOWED_PATHS || "/app,/tmp")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

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
