import fs from "fs";

const USERS_FILE = "./users.json";

/* ================= Load / Save ================= */

function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

/* ================= Auth API ================= */

// Check if a platform ID is already linked to a VIP profile
export function getVIPProfile(platformId) {
  const users = loadUsers();
  for (const [name, profile] of Object.entries(users)) {
    if (profile.linkedIds.includes(platformId)) {
      return { name, code: profile.code, ...profile };
    }
  }
  return null;
}

// Try to link a new platform ID using a code
// Returns profile name if success, null if failed
export function linkWithCode(platformId, code) {
  const users = loadUsers();
  for (const [name, profile] of Object.entries(users)) {
    if (profile.code === code.trim()) {
      if (!profile.linkedIds.includes(platformId)) {
        profile.linkedIds.push(platformId);
        saveUsers(users);
      }
      return name;
    }
  }
  return null;
}

// Check if a platform ID is pending code entry
const pendingAuth = new Map(); // platformId → true

export function setPendingAuth(platformId) {
  pendingAuth.set(platformId, true);
}

export function isPendingAuth(platformId) {
  return pendingAuth.has(platformId);
}

export function clearPendingAuth(platformId) {
  pendingAuth.delete(platformId);
}