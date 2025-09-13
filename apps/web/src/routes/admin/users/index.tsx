import { $, component$, type QRL, useSignal, useVisibleTask$ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import { type RequestEventLoader, routeLoader$ } from "@builder.io/qwik-city";
import { cn } from "~/lib/cn";
import { csrfHeader } from "../../../lib/csrf";

// --- types ---
// Basic shape of a User object returned by the backend.
// - id/email uniquely identify the user
// - username may be undefined if not set
// - role is either 'admin' or 'user'
// - created_at is optional and provided as epoch seconds by the server
export type User = {
  id: string;
  email: string;
  username?: string;
  role: "admin" | "user";
  created_at?: number; // epoch seconds
};

/**
 * Route loader (Qwik City):
 * - routeLoader$ runs on the server during SSR to fetch data needed for the page.
 * - The returned value is serialized and available client-side through useUsersLoader().
 * - Good place to fetch data and forward cookies/session headers for server-side requests.
 */
export const useUsersLoader = routeLoader$<{
  users?: User[];
  error?: string;
  status?: number;
}>(async (ev: RequestEventLoader) => {
  // Prefer IPv4 to avoid environments where "localhost" resolves to ::1 while the
  // gateway binds to 0.0.0.0. If GATEWAY_URL is provided, use it but rewrite any
  // "localhost" to "127.0.0.1" to be safe in SSR/dev.
  const envBase = ev.env.get("GATEWAY_URL") ?? process.env.GATEWAY_URL;
  const inDocker = ev.env.get("DOCKER_TRAEFIK") === "1" || process.env.DOCKER_TRAEFIK === "1";
  let base = envBase ?? (inDocker ? "http://gateway:7000" : "http://127.0.0.1:7000");
  if (base.includes("localhost")) {
    base = base.replace("localhost", "127.0.0.1");
  }

  // Forward cookies from the incoming request so that server-side fetches keep auth/session.
  const cookieHeader = ev.request.headers.get("cookie") ?? "";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (cookieHeader) headers.cookie = cookieHeader;

  // If no cookies are present (static generation or cold deep-link without auth),
  // avoid contacting the gateway during SSG and let the client fetch after hydration.
  if (!cookieHeader) {
    return { users: [] };
  }

  // Server-side fetch to the gateway to list admin users.
  const res = await fetch(new URL("/api/admin/users", base).toString(), {
    method: "GET",
    headers,
  });

  // Determine if response is JSON before parsing to avoid errors on 204/non-JSON bodies.
  const ct = res.headers.get("content-type") || "";
  const isJSON = ct.includes("application/json");
  const payload: unknown = isJSON ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    return {
      error:
        (payload &&
        typeof payload === "object" &&
        "message" in payload &&
        typeof (payload as { message?: unknown }).message === "string"
          ? ((payload as { message: string }).message as string)
          : payload &&
              typeof payload === "object" &&
              "error" in payload &&
              typeof (payload as { error?: unknown }).error === "string"
            ? ((payload as { error: string }).error as string)
            : null) ?? `Failed to load (status ${res.status})`,
      status: res.status,
    };
  }

  const users: User[] = Array.isArray(payload) ? payload : [];
  return { users };
});

/**
 * QRL-safe API helper:
 * - Wrapping with $ makes the function serializable by Qwik (so it can be referenced from the
 *   rendered output and invoked later).
 * - Using credentials: 'same-origin' ensures cookies are sent for same-origin requests (auth).
 */
export const api: QRL<(url: string, options?: RequestInit) => Promise<Response>> = $(
  (url: string, options: RequestInit = {}) =>
    fetch(url, { credentials: "same-origin", ...options }),
);

/**
 * Page component:
 * - component$ creates a Qwik component that can be lazily resumed and partially executed.
 * - useSignal creates reactive state that persists between renders and updates the UI when changed.
 */
export default component$(() => {
  // Loader provides server-fetched data when the page first renders.
  const loader = useUsersLoader();

  // Local reactive copy of users so we can update the UI immediately after actions (promote/demote/delete).
  const users = useSignal<User[]>(loader.value?.users ?? []);
  // Headers helper for same-origin cookie auth + CSRF for unsafe methods.
  const baseHeaders = $(() => ({ Accept: "application/json" as const }));

  // busy holds the ID of the user currently being acted upon (or null).
  // This is used to disable buttons for that row and show transient state.
  const busy = useSignal<string | null>(null);

  // Toasts: simple single-message toast
  const toast = useSignal<string | null>(null);
  const showToast = $((msg: string, ms = 3000) => {
    toast.value = msg;
    setTimeout(() => {
      toast.value = null;
    }, ms);
  });

  // Delete confirm modal (no email typing). Opens on Delete; user confirms or cancels.
  const deleteOpen = useSignal(false);
  const deleteId = useSignal<string | null>(null);
  const deleteEmail = useSignal<string | null>(null);

  const openDelete = $((id: string, email: string) => {
    deleteId.value = id;
    deleteEmail.value = email;
    deleteOpen.value = true;
  });
  const closeDelete = $(() => {
    deleteOpen.value = false;
    deleteId.value = null;
    deleteEmail.value = null;
  });
  const confirmDelete = $(async () => {
    const id = deleteId.value;
    if (!id) return;
    busy.value = id;
    try {
      const headers = { ...(await baseHeaders()), ...csrfHeader() };
      const res = await api(`/api/admin/users/${id}`, {
        method: "DELETE",
        headers,
      });
      if (res.status === 204) {
        users.value = users.value.filter((u) => u.id !== id);
        await showToast("User deleted");
        closeDelete();
      } else {
        const msg =
          (await res.json().catch(() => null))?.message ?? `Delete failed (${res.status})`;
        alert(msg);
      }
    } finally {
      busy.value = null;
    }
  });

  /**
   * Promote a user to admin.
   */
  const promote = $(async (id: string) => {
    if (!confirm("Promote this user to admin?")) return;
    busy.value = id;
    const headers = { ...(await baseHeaders()), ...csrfHeader() };
    const res = await api(`/api/admin/users/${id}/promote`, {
      method: "POST",
      headers,
    });
    if (res.ok) {
      users.value = users.value.map((u) => (u.id === id ? { ...u, role: "admin" } : u));
      await showToast("User promoted to admin");
    } else {
      const msg = (await res.json().catch(() => null))?.message ?? `Promote failed (${res.status})`;
      alert(msg);
    }
    busy.value = null;
  });

  /**
   * Demote an admin back to a regular user.
   */
  const demote = $(async (id: string) => {
    if (!confirm("Demote this admin to user?")) return;
    busy.value = id;
    const headers = { ...(await baseHeaders()), ...csrfHeader() };
    const res = await api(`/api/admin/users/${id}/demote`, {
      method: "POST",
      headers,
    });
    if (res.ok) {
      users.value = users.value.map((u) => (u.id === id ? { ...u, role: "user" } : u));
      await showToast("User demoted to user");
    } else {
      const msg = (await res.json().catch(() => null))?.message ?? `Demote failed (${res.status})`;
      alert(msg);
    }
    busy.value = null;
  });

  // Removed older modal-based performDelete in favor of deleteUser()

  // True when loader returned an error during server-side fetch.
  const isError = !!loader.value?.error;

  // Client fetch after hydration if the loader didn't populate (SSG deep-link)
  useVisibleTask$(async () => {
    try {
      if (!users.value || users.value.length === 0) {
        const res = await api("/api/admin/users", {
          method: "GET",
          headers: await baseHeaders(),
        });
        const ct = res.headers.get("content-type") || "";
        const isJSON = ct.includes("application/json");
        const payload: unknown = isJSON ? await res.json().catch(() => null) : null;
        if (res.ok && Array.isArray(payload)) {
          users.value = payload as User[];
        }
      }
    } catch {
      /* ignore; layout guard will redirect if not authorized */
    }
  });

  return (
    <main class="min-h-screen p-6">
      <div class="bg-base-content/5 border-base-content/10 mx-auto w-full max-w-none rounded-xl border p-6 backdrop-blur">
        <h2 class="mb-2 text-center text-2xl font-semibold">All Users</h2>
        <p class="text-base-content/70 mb-4 text-center text-sm">Manage accounts</p>

        {/* If the loader reported an error, show an alert. */}
        {isError && (
          <div class="alert alert-error" role="alert" aria-live="polite">
            <div>
              <span class="font-bold">Error</span>
              <span class="block">{loader.value?.error}</span>
            </div>
          </div>
        )}

        {/* Toast */}
        {toast.value && (
          <div class="fixed top-6 right-6 z-50">
            <div class="toast toast-end">
              <div class="alert alert-success">
                <div>
                  <span>{toast.value}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div class="overflow-x-auto">
          <table class="table-zebra table w-full">
            <thead>
              <tr>
                <th class="text-left">Username</th>
                <th>Role</th>
                <th>Created</th>
                <th class="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {/* If there are no users, show a single-row message. */}
              {users.value.length === 0 ? (
                <tr>
                  <td colSpan={4} class="py-6 text-center">
                    No users
                  </td>
                </tr>
              ) : (
                // Render a row per user. Keys are important so Qwik can track list items.
                users.value.map((u) => (
                  <tr key={u.id}>
                    <td class="max-w-xs break-words">
                      {/* Prefer username; otherwise show email prefix or fallback to id */}
                      {u.username ? u.username : u.email ? u.email.split("@")[0] : u.id}
                    </td>
                    <td class="text-center">
                      {/* Visual role indicator using DaisyUI badges */}
                      {u.role === "admin" ? (
                        <span class="badge badge-secondary">Admin</span>
                      ) : (
                        <span class="badge">User</span>
                      )}
                    </td>
                    <td class="text-center">
                      {/* created_at is epoch seconds; convert to a readable local string or show '-' */}
                      {u.created_at ? new Date(u.created_at * 1000).toLocaleString() : "-"}
                    </td>
                    <td class="text-right">
                      <div class="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          class={cn(
                            "btn btn-sm btn-accent",
                            u.role === "admin" && "cursor-not-allowed opacity-50",
                          )}
                          onClick$={() => promote(u.id)}
                          disabled={u.role === "admin" || busy.value === u.id}
                        >
                          Promote
                        </button>

                        {u.role === "admin" && (
                          <button
                            type="button"
                            class="btn btn-sm btn-warning"
                            onClick$={() => demote(u.id)}
                            disabled={busy.value === u.id}
                          >
                            Demote
                          </button>
                        )}

                        <button
                          type="button"
                          class={cn(
                            "btn btn-sm btn-error",
                            u.role === "admin" && "cursor-not-allowed opacity-50",
                          )}
                          onClick$={() => openDelete(u.id, u.email)}
                          disabled={u.role === "admin" || busy.value === u.id}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete confirmation modal (simple Yes/Cancel) */}
      {deleteOpen.value && (
        <div class="fixed inset-0 z-50 flex items-center justify-center">
          <div class="bg-base-content/50 absolute inset-0" onClick$={() => closeDelete()} />
          <div class="bg-base-100 z-60 w-full max-w-md rounded-lg p-6">
            <h3 class="mb-2 text-lg font-semibold">Delete user</h3>
            <p class="mb-3">
              Are you sure you want to delete <b>{deleteEmail.value}</b>? This action cannot be
              undone.
            </p>
            <div class="flex justify-end gap-2">
              <button type="button" class="btn" onClick$={() => closeDelete()}>
                Cancel
              </button>
              <button
                type="button"
                class="btn btn-error"
                onClick$={() => confirmDelete()}
                disabled={busy.value === deleteId.value}
              >
                {busy.value === deleteId.value ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
});

export const head: DocumentHead = {
  title: "Admin · Users | Stack",
  meta: [
    {
      name: "description",
      content: "Admin dashboard to view, promote, demote, and delete users in Stack.",
    },
  ],
};
