import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { trpc } from "@/lib/trpc";
import { effectiveBranchId } from "../../../shared/branch-selection";

export type Branch = {
  id: number;
  name: string;
  city?: string | null;
  ordersEnabled?: boolean;
};
export type BranchAwareUser = {
  id?: number;
  role?: string | null;
  branchId?: number | null;
  canStation?: boolean;
  canKitchen?: boolean;
  canManager?: boolean;
  [key: string]: unknown;
};

type BranchContextValue = {
  branches: Branch[];
  branchId: number | null;
  activeBranchId?: number;
  activeBranch?: Branch;
  isSystemAdmin: boolean;
  isLoading?: boolean;
  setBranchId: (id: number | null) => void;
  setActiveBranchId: (id: number | null) => void;
  branchInput: { branchId: number } | undefined;
};

const BranchContext = createContext<BranchContextValue | null>(null);

export function BranchProvider({
  children,
  user,
}: {
  children: ReactNode;
  user?: BranchAwareUser | null;
}) {
  const isSystemAdmin = user?.role === "system_admin" || user?.role === "developer";
  const branchQuery = trpc.branches.list.useQuery(undefined, {
    retry: false,
    staleTime: 30_000,
  });
  const branches: Branch[] = branchQuery.data ?? [];
  const permittedBranches = useMemo(
    () =>
      isSystemAdmin
        ? branches
        : branches.filter(branch => branch.id === user?.branchId),
    [branches, isSystemAdmin, user?.branchId]
  );
  // Selection is temporary for this session, never a home branch for a global account.
  const [selected, setSelected] = useState<number | undefined>();
  useEffect(() => {
    setSelected(undefined);
  }, [user?.id, isSystemAdmin]);
  const activeBranchId = effectiveBranchId(user, permittedBranches, selected);

  const value = useMemo<BranchContextValue>(() => {
    const select = (id: number | null) => {
      if (!isSystemAdmin) return;
      if (id === null) setSelected(undefined);
      else if (permittedBranches.some(branch => branch.id === id))
        setSelected(id);
    };
    return {
      branches: permittedBranches,
      branchId: activeBranchId ?? null,
      activeBranchId,
      activeBranch: permittedBranches.find(
        branch => branch.id === activeBranchId
      ),
      isSystemAdmin,
      isLoading: branchQuery.isLoading,
      setBranchId: select,
      setActiveBranchId: select,
      branchInput: activeBranchId ? { branchId: activeBranchId } : undefined,
    };
  }, [activeBranchId, branchQuery.isLoading, isSystemAdmin, permittedBranches]);
  return (
    <BranchContext.Provider value={value}>{children}</BranchContext.Provider>
  );
}

export function useBranch() {
  const context = useContext(BranchContext);
  if (!context) throw new Error("useBranch must be used inside BranchProvider");
  return context;
}
