// Persora Docs — workspace root: the Persora Docs dashboard or one open document editor.
import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import "./docs.css";
import type { AppUser } from "../../types";
import { isPagesApiConfigured } from "../../lib/cloud";
import DocsHome from "./DocsHome";
import { Spinner } from "@/components/ui/spinner";
import { PersoraEmptyState } from "@/design-system";

const DocEditor = lazy(() => import("./DocEditor"));

export const DOC_PARAM = "doc";

function readOpenDocId(): string | null {
  try {
    const value = new URLSearchParams(window.location.search).get(DOC_PARAM);
    return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
  } catch {
    return null;
  }
}

export default function DocsView({
  user,
  notify,
  onTrashChanged,
}: {
  user: AppUser;
  notify: (message: string, kind?: "success" | "error") => void;
  onTrashChanged?: () => void;
}) {
  const disabled = Boolean(user.demo) || !isPagesApiConfigured;
  const [openId, setOpenId] = useState<string | null>(readOpenDocId);

  const open = useCallback((id: string | null) => {
    setOpenId(id);
    try {
      const url = new URL(window.location.href);
      if (id) {
        url.searchParams.set("view", "docs");
        url.searchParams.set(DOC_PARAM, id);
      } else {
        url.searchParams.delete(DOC_PARAM);
      }
      window.history.replaceState(window.history.state, "", url);
    } catch {
      /* URL sync is cosmetic */
    }
  }, []);

  useEffect(() => {
    const onPop = () => setOpenId(readOpenDocId());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  if (disabled) {
    return (
      <div className="pd-view">
        <PersoraEmptyState
          className="pd-empty"
          role="status"
          moduleId="docs"
          tone="blue"
          title="Persora Docs needs your Persora account"
          description="Documents are saved privately to your account on the server, so they aren't available in the local sample session. Sign in to create and edit documents."
        />
      </div>
    );
  }

  return (
    <div className="pd-view">
      {openId ? (
        <Suspense
          fallback={
            <div className="pd-loading" role="status">
              <Spinner className="size-4 text-primary" />
              <span>Opening document…</span>
            </div>
          }
        >
          <DocEditor
            key={openId}
            docId={openId}
            user={user}
            notify={notify}
            onClose={() => open(null)}
            onOpen={open}
          />
        </Suspense>
      ) : (
        <DocsHome notify={notify} onOpen={open} onTrashChanged={onTrashChanged} />
      )}
    </div>
  );
}
