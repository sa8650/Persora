import type { AppUser } from "../types";
import { PagesApiError, pagesApiJson } from "./cloud";

interface AuthResponse { user: AppUser }

export async function signIn(identifier: string, password: string): Promise<AppUser> {
  const result = await pagesApiJson<AuthResponse>("/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
  return result.user;
}

export async function signUp(fullName: string, email: string, password: string): Promise<AppUser> {
  const result = await pagesApiJson<AuthResponse>("/auth/register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fullName, email, password }),
  });
  return result.user;
}

export async function getCurrentUser(): Promise<AppUser | null> {
  try {
    const result = await pagesApiJson<AuthResponse>("/auth/me");
    return result.user;
  } catch (error) {
    if (error instanceof PagesApiError && error.status === 401) return null;
    throw error;
  }
}

export async function signOut(): Promise<void> {
  await pagesApiJson<{ ok: boolean }>("/auth/logout", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
}
