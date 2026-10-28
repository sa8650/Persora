// Persora Table — space root: the tables home page or one open table.
import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import "./table.css";
import type { AppUser } from "../../types";
import { isPagesApiConfigured } from "../../lib/cloud";
import TableHome from "./TableHome";
import { Spinner } from "@/components/ui/spinner";
import { PersoraEmptyState } from "@/design-system";

const TableEditor = lazy(() => import("./TableEditor"));

export const TABLE_PARAM = "table";

function readOpenId(): string | null {
  try {
    const value = new URLSearchParams(window.location.search).get(TABLE_PARAM);
    return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
  } catch { return null; }
}

export default function TableView({ user, notify, canUpload, maxUploadMb, onUpgrade, onTrashChanged }: {
  user: AppUser;
  notify: (message: string, kind?: "success" | "error") => void;
  canUpload: boolean;
  maxUploadMb: number;
  onUpgrade?: () => void;
  onTrashChanged?: () => void;
}) {
  const disabled = Boolean(user.demo) || !isPagesApiConfigured;
  const [openId, setOpenId] = useState<string | null>(readOpenId);

  const open = useCallback((id: string | null) => {
    setOpenId(id);
    try {
      const url = new URL(window.location.href);
      if (id) { url.searchParams.set("view", "tables"); url.searchParams.set(TABLE_PARAM, id); } else url.searchParams.delete(TABLE_PARAM);
      window.history.replaceState(window.history.state, "", url);
    } catch { /* address bar sync is cosmetic */ }
  }, []);

  useEffect(() => {
    const onPop = () => setOpenId(readOpenId());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  if (disabled) {
    return <div className="tb-view">
      <PersoraEmptyState
        className="tb-empty"
        role="status"
        moduleId="tables"
        tone="emerald"
        title="Persora Table needs your Persora account"
        description="Tables are saved privately to your account on the server, so they aren't available in the local sample session. Sign in to create spreadsheets and Smart Tables."
      />
    </div>;
  }
  return <div className="tb-view">
    {openId
      ? <Suspense fallback={<div className="tb-loading" role="status"><Spinner className="size-4"/> Opening table…</div>}>
        <TableEditor key={openId} tableId={openId} user={user} notify={notify} canUpload={canUpload} maxUploadMb={maxUploadMb} onUpgrade={onUpgrade}
          onClose={() => open(null)} onOpen={open} onTrashChanged={onTrashChanged}/>
      </Suspense>
      : <TableHome user={user} notify={notify} onOpen={open} onTrashChanged={onTrashChanged}/>}
  </div>;
}
