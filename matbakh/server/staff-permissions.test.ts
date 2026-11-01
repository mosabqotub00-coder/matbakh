import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import type { StaffSessionUser } from "./staff";

vi.mock("./kitchen", () => ({
  createOrder: vi.fn(), createProduct: vi.fn(), getOrderVoiceNote: vi.fn(() => ({ data: "test", type: "audio/webm" })),
  listHistory: vi.fn(() => ({ orders: [], total: 0 })), listKitchenOrders: vi.fn(() => []),
  listProducts: vi.fn(() => []), listStationOrders: vi.fn(() => []), transitionOrder: vi.fn(), updateProduct: vi.fn(),
}));
vi.mock("./staff", async importOriginal => ({
  ...await importOriginal<typeof import("./staff")>(),
  listStaffAccounts: vi.fn(() => ({ users: [], total: 0, activeCount: 0 })),
}));
import { appRouter } from "./routers";

function userFor(section: "canStation" | "canKitchen" | "canManager"): StaffSessionUser {
  const role = section === "canStation" ? "station" : section === "canKitchen" ? "kitchen" : "shift_manager";
  return {
    id: 22, username: "staff01", displayName: "موظف", name: "موظف", email: null,
    role, branchId: 1, canStation: role === "shift_manager", canKitchen: role === "shift_manager", canManager: true, canManageUsers: role === "shift_manager", canBroadcast: role === "shift_manager", canExtend: role === "shift_manager", [section]: true,
    isActive: true, mustChangePassword: false, createdAt: new Date(),
  };
}
function callerFor(staffUser: StaffSessionUser | null) {
  const context: TrpcContext = {
    req: { headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"],
    staffUser, staffSessionHash: "session-hash",
  };
  return appRouter.createCaller(context);
}

beforeEach(() => vi.clearAllMocks());
describe("independent staff section authorization", () => {
  it("allows station tracking and history but blocks kitchen and administration", async () => {
    const caller = callerFor(userFor("canStation"));
    await expect(caller.orders.station()).resolves.toEqual([]);
    await expect(caller.orders.stationHistory()).resolves.toEqual({ orders: [], total: 0 });
    await expect(caller.orders.kitchen()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.orders.monitor()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.staff.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.orders.history()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.orders.transition({ orderId: 1, nextStatus: "preparing" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("allows a manager-only account to monitor but not operate other sections", async () => {
    const caller = callerFor(userFor("canManager"));
    await expect(caller.orders.monitor()).resolves.toEqual([]);
    await expect(caller.orders.history()).resolves.toEqual({ orders: [], total: 0 });
    await expect(caller.orders.voiceNote({ orderId: 1 })).resolves.toMatchObject({ type: "audio/webm" });
    await expect(caller.staff.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.orders.kitchen()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.orders.station()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.products.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.orders.create({ items: [{ productId: 1, quantity: 1 }] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.orders.transition({ orderId: 1, nextStatus: "ready" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("allows a kitchen-only account to read kitchen data but not station or manager data", async () => {
    const caller = callerFor(userFor("canKitchen"));
    await expect(caller.orders.kitchen()).resolves.toEqual([]);
    await expect(caller.orders.monitor()).resolves.toEqual([]);
    await expect(caller.orders.voiceNote({ orderId: 1 })).resolves.toMatchObject({ type: "audio/webm" });
    await expect(caller.staff.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.orders.station()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("requires password replacement before any section or monitoring procedure", async () => {
    const caller = callerFor({ ...userFor("canManager"), mustChangePassword: true });
    await expect(caller.orders.monitor()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.staff.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("fails closed for anonymous and inactive accounts", async () => {
    await expect(callerFor(null).orders.station()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(callerFor({ ...userFor("canKitchen"), isActive: false }).orders.kitchen()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
