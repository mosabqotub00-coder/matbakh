export type TicketReference = {
  id: number;
  orderCode?: string | null;
};

/** Use the durable record number. Never reset or rewrite existing references. */
export function ticketNumber(ticket: TicketReference): string {
  return String(ticket.id);
}

export function ticketLabel(ticket: TicketReference): string {
  const arabicNumber = ticketNumber(ticket).replace(
    /[0-9]/g,
    digit => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]
  );
  return `ضربة رقم ${arabicNumber}`;
}

export function normalizeTicketSearch(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("ar")
    .replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
}

export function humanTicketText(text: string, ticket: TicketReference): string {
  return text.replace(
    /\bS-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\b/g,
    ticketLabel(ticket)
  );
}
