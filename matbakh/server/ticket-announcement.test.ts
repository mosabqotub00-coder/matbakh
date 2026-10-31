import { describe, expect, it } from "vitest";
import {
  ticketLabel,
  ticketNumber,
  normalizeTicketSearch,
} from "../shared/ticket-label";
import {
  orderAnnouncementText,
  spokenOrderNumber,
  type KitchenOrder,
} from "../client/src/lib/kitchen-ui";

const order: KitchenOrder = {
  id: 1,
  orderCode: "S-DRBXCZ",
  status: "new",
  createdAt: "2026-10-27T12:00:00Z",
  items: [{ id: 1, productName: "كرسبي", quantity: 2, prepMinutes: 10 }],
};

describe("human ticket labels and spoken notes", () => {
  it("shows a short Arabic label for legacy and modern references without rewriting them", () => {
    expect(ticketLabel(order)).toBe("ضربة رقم ١");
    expect(ticketLabel({ ...order, id: 42, orderCode: "S-20261027-42" })).toBe(
      "ضربة رقم ٤٢"
    );
    expect(order.orderCode).toBe("S-DRBXCZ");
  });
  it("keeps the durable record number even if a displayed legacy code differs", () => {
    expect(ticketNumber({ id: 42, orderCode: "S-20261027-999" })).toBe("42");
    expect(
      spokenOrderNumber({ ...order, id: 42, orderCode: "S-20261027-999" })
    ).toBe("42");
  });
  it("includes the product, quantity and written notes in the speech", () => {
    expect(
      orderAnnouncementText({
        ...order,
        notes: "بدون بهارات، الصوص على الجانب",
      })
    ).toBe(
      "ضربة رقم 1، 2 كرسبي. ملاحظات المطبخ: بدون بهارات، الصوص على الجانب."
    );
  });
  it("normalizes spaces without dropping any written note", () => {
    const text = orderAnnouncementText({
      ...order,
      notes: "  بدون  ملح\n والصوص\t منفصل  ",
    });
    expect(text).toContain("ملاحظات المطبخ: بدون ملح والصوص منفصل.");
  });
  it("does not invent notes for null, empty or whitespace-only notes", () => {
    for (const notes of [null, "", " \n\t "]) {
      const text = orderAnnouncementText({ ...order, notes });
      expect(text).not.toContain("ملاحظات المطبخ");
      expect(text).not.toContain(order.orderCode);
    }
  });
  it("keeps long notes in full rather than silently truncating them", () => {
    const notes = "ملاحظة طويلة ".repeat(70) + "آخر الملاحظة";
    expect(orderAnnouncementText({ ...order, notes })).toContain(notes.trim());
  });
  it("announces the attached audio but does not pretend to transcribe it", () => {
    expect(orderAnnouncementText({ ...order, voiceAvailable: true })).toContain(
      "يوجد تعليق صوتي مرفق يمكن الاستماع إليه"
    );
    expect(
      orderAnnouncementText({ ...order, voiceAvailable: true })
    ).not.toContain("ملاحظات المطبخ");
  });
  it("makes Arabic and Western ticket-number searches equivalent", () => {
    expect(normalizeTicketSearch("ضربة رقم ٤٢")).toBe(
      normalizeTicketSearch("ضربة رقم 42")
    );
    expect(normalizeTicketSearch("٤٢")).toBe("42");
  });
});

describe("legacy notification display", () => {
  it("humanizes legacy and dated codes only at display time", async () => {
    const { humanTicketText } = await import("../shared/ticket-label");
    const old = "وصلت التذكرة S-DRBXCZ إلى المطبخ.";
    expect(humanTicketText(old, { id: 42 })).toBe(
      "وصلت التذكرة ضربة رقم ٤٢ إلى المطبخ."
    );
    expect(humanTicketText("S-20261027-42 — جاهزة", { id: 42 })).toBe(
      "ضربة رقم ٤٢ — جاهزة"
    );
    expect(old).toBe("وصلت التذكرة S-DRBXCZ إلى المطبخ.");
  });
});
