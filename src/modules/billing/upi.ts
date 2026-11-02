import QRCode from "qrcode";

export type UpiPaymentParams = {
  vpa: string;
  payeeName: string;
  amount: number; // In INR (e.g. 500.00)
  note?: string;
  refId?: string;
  currency?: string;
};

export function buildUpiUri(params: UpiPaymentParams): string {
  const vpa = params.vpa.trim();
  const payeeName = params.payeeName.trim();
  const amountStr = params.amount.toFixed(2);
  const currency = params.currency || "INR";

  // Standard NPCI UPI URI scheme
  const search = new URLSearchParams();
  search.set("pa", vpa);
  search.set("pn", payeeName);
  search.set("am", amountStr);
  search.set("cu", currency);
  if (params.note) {
    search.set("tn", params.note.slice(0, 80));
  }
  if (params.refId) {
    search.set("tr", params.refId.slice(0, 35));
  }

  return `upi://pay?${search.toString()}`;
}

export async function generateUpiQrSvg(upiUri: string): Promise<string> {
  return QRCode.toString(upiUri, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    color: {
      dark: "#081816",
      light: "#FFFFFF",
    },
  });
}

export async function generateUpiQrDataUrl(upiUri: string): Promise<string> {
  return QRCode.toDataURL(upiUri, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 320,
    color: {
      dark: "#081816",
      light: "#FFFFFF",
    },
  });
}

// 0% Direct UPI Savings vs Payment Gateways (standard 2.00% MDR + 18% GST = 2.36%)
export function calculateGatewaySavings(amountInr: number) {
  const effectiveRate = 0.0236;
  const savedInr = Number((amountInr * effectiveRate).toFixed(2));
  const savedPaise = Math.round(savedInr * 100);
  return {
    ratePercent: 2.36,
    savedInr,
    savedPaise,
  };
}
