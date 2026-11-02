"use client";

import { useState } from "react";
import Image from "next/image";
import {
  QrCode,
  CheckCircle2,
  Clock,
  Printer,
  Copy,
  Check,
  ShieldCheck,
  Zap,
  ArrowRight,
  Sparkles,
  PhoneCall,
  User,
  IndianRupee,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { markInvoiceAsPaidAction } from "@/app/billing-actions";
import type { BillingInvoice } from "@/modules/billing/service";

export type QueueTokenInfo = {
  id: string;
  number: number;
  patient?: {
    lead?: {
      name?: string;
      phone?: string;
    } | null;
  } | null;
  doctor?: {
    name?: string;
    room?: string;
  } | null;
};

const FEE_PRESETS = [
  { label: "Follow-up Visit", amount: 250, desc: "Routine review" },
  { label: "General Consultation", amount: 500, desc: "OPD physician visit" },
  { label: "Specialist / ECG", amount: 1000, desc: "Senior consultant" },
  { label: "Complete Health Package", amount: 2500, desc: "Full wellness checkup" },
];

export function UpiBillingTerminal({
  orgId,
  orgName,
  defaultVpa,
  createAction,
  queueTokens = [],
  activeInvoice,
  invoices = [],
  role,
}: {
  orgId: string;
  orgName: string;
  defaultVpa: string;
  createAction: (formData: FormData) => void;
  queueTokens?: QueueTokenInfo[];
  activeInvoice?: BillingInvoice | null;
  invoices: BillingInvoice[];
  role: string;
}) {
  const [selectedAmount, setSelectedAmount] = useState<number>(500);
  const [patientName, setPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [serviceName, setServiceName] = useState("General Physician Consultation");
  const [customVpa, setCustomVpa] = useState(defaultVpa);
  const [copied, setCopied] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<BillingInvoice | null>(
    activeInvoice || (invoices.length > 0 ? invoices[0] : null),
  );

  const isWritable = role === "OWNER" || role === "ADMIN";

  // Calculate 0% MDR savings: 2.36% (2% MDR + 18% GST)
  const gatewayFeePercent = 2.36;
  const currentSavings = Number((selectedAmount * (gatewayFeePercent / 100)).toFixed(2));

  const handleSelectToken = (token: QueueTokenInfo) => {
    if (!token) return;
    const name = token.patient?.lead?.name || `Patient Token #${token.number}`;
    const phone = token.patient?.lead?.phone || "";
    const doctor = token.doctor?.name ? ` - ${token.doctor.name}` : "";
    setPatientName(name);
    setPatientPhone(phone);
    setServiceName(`Token #${token.number} Consultation${doctor}`);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-8">
      {/* 0% MDR Fee Guarantee Banner */}
      <section className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/80 via-[#0a2321] to-[#081816] p-6 text-white shadow-xl">
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold tracking-wider text-emerald-300 uppercase">
              <Zap className="h-3.5 w-3.5 text-emerald-400" />
              NPCI Direct P2M Architecture
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white md:text-3xl">
              0%-Fee Direct UPI Billing Terminal
            </h2>
            <p className="max-w-2xl text-sm text-emerald-100/80">
              Zero payment gateway commission. Patient payments route directly from UPI (Google Pay,
              PhonePe, Paytm, BHIM) straight to your clinic bank account with 0% MDR transaction fees.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-4 rounded-xl border border-emerald-500/20 bg-black/40 p-4 backdrop-blur-sm">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-300">
              <ShieldCheck className="h-7 w-7" />
            </div>
            <div>
              <p className="text-xs text-gray-400 font-medium">Gateway Fees Paid</p>
              <p className="text-2xl font-black text-emerald-400">0.0%</p>
              <p className="text-[11px] text-emerald-300/80">Direct Bank Settlement</p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-12">
        {/* Left Column: Quick Invoicing Form */}
        <div className="space-y-6 lg:col-span-7">
          {isWritable ? (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl flex items-center gap-2">
                    <QrCode className="h-5 w-5 text-emerald-600" />
                    Generate Direct UPI Bill
                  </CardTitle>
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    Instant QR
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                {/* Active Queue Quick Fill */}
                {queueTokens.length > 0 && (
                  <div className="mb-6 rounded-xl border border-muted bg-muted/30 p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                      Quick fill from active reception queue:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {queueTokens.slice(0, 6).map((token) => (
                        <button
                          key={token.id}
                          type="button"
                          onClick={() => handleSelectToken(token)}
                          className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1 text-xs font-medium hover:border-primary hover:text-primary transition-colors"
                        >
                          <span className="font-bold text-primary">#{token.number}</span>
                          <span>{token.patient?.lead?.name || "Patient"}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <form action={createAction} className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-sm font-medium">
                      Patient / Customer Name
                      <div className="relative mt-1">
                        <Input
                          name="patientName"
                          value={patientName}
                          onChange={(e) => setPatientName(e.target.value)}
                          placeholder="e.g. Sunita Patel"
                          required
                          minLength={2}
                          className="pl-9"
                        />
                        <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      </div>
                    </label>

                    <label className="text-sm font-medium">
                      Phone Number (Optional)
                      <div className="relative mt-1">
                        <Input
                          name="patientPhone"
                          value={patientPhone}
                          onChange={(e) => setPatientPhone(e.target.value)}
                          placeholder="+91 98765 43210"
                          className="pl-9"
                        />
                        <PhoneCall className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      </div>
                    </label>
                  </div>

                  {/* Consultation / Fee Presets */}
                  <div>
                    <label className="text-sm font-medium mb-2 block">
                      Consultation Service Preset
                    </label>
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                      {FEE_PRESETS.map((preset) => {
                        const isSelected = selectedAmount === preset.amount;
                        return (
                          <button
                            key={preset.amount}
                            type="button"
                            onClick={() => {
                              setSelectedAmount(preset.amount);
                              setServiceName(preset.label);
                            }}
                            className={`flex flex-col items-start justify-between rounded-xl border p-3 text-left transition-all ${
                              isSelected
                                ? "border-emerald-500 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200 ring-2 ring-emerald-500/20"
                                : "hover:border-muted-foreground/30 bg-card"
                            }`}
                          >
                            <span className="text-xs font-semibold">{preset.label}</span>
                            <span className="mt-1 text-base font-bold">₹{preset.amount}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-sm font-medium">
                      Billing Amount (₹ INR)
                      <div className="relative mt-1">
                        <Input
                          name="amountInr"
                          type="number"
                          min={1}
                          max={100000}
                          value={selectedAmount}
                          onChange={(e) => setSelectedAmount(Number(e.target.value))}
                          required
                          className="pl-9 font-semibold text-lg"
                        />
                        <IndianRupee className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      </div>
                    </label>

                    <label className="text-sm font-medium">
                      Service / Bill Description
                      <Input
                        name="serviceName"
                        value={serviceName}
                        onChange={(e) => setServiceName(e.target.value)}
                        placeholder="e.g. General Consultation"
                        required
                        className="mt-1"
                      />
                    </label>
                  </div>

                  {/* VPA Configuration */}
                  <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Clinic Payee UPI ID (VPA)</span>
                      <span>Direct Bank Account Destination</span>
                    </div>
                    <Input
                      name="customVpa"
                      value={customVpa}
                      onChange={(e) => setCustomVpa(e.target.value)}
                      placeholder="clinic@okicici"
                      required
                    />
                    <div className="flex items-center justify-between text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                      <span>✓ 0% Gateway Commission (Direct UPI)</span>
                      <span>You save ~₹{currentSavings} vs 2.36% PG cut</span>
                    </div>
                  </div>

                  <Button className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-base shadow-md">
                    Generate 0%-Fee UPI QR Code
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <p>You have view-only access to clinic billing records.</p>
              </CardContent>
            </Card>
          )}

          {/* Quick Stats Cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border bg-card p-4">
              <p className="text-xs text-muted-foreground">Gateway Commission</p>
              <p className="text-2xl font-bold text-emerald-600">0.0%</p>
              <p className="text-[11px] text-muted-foreground">Direct P2M settlement</p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <p className="text-xs text-muted-foreground">Payment Method</p>
              <p className="text-xl font-bold">UPI Auto-Fill</p>
              <p className="text-[11px] text-muted-foreground">GPay, PhonePe, Paytm</p>
            </div>
            <div className="col-span-2 sm:col-span-1 rounded-xl border bg-card p-4">
              <p className="text-xs text-muted-foreground">Settlement Time</p>
              <p className="text-xl font-bold text-primary">Instant T+0</p>
              <p className="text-[11px] text-muted-foreground">Real-time to bank account</p>
            </div>
          </div>
        </div>

        {/* Right Column: Live QR Code & Slip Preview */}
        <div className="space-y-6 lg:col-span-5">
          {selectedInvoice ? (
            <div
              id="printable-invoice"
              className="relative overflow-hidden rounded-3xl border border-emerald-500/30 bg-card p-6 shadow-2xl space-y-6"
            >
              {/* Receipt Header */}
              <div className="border-b pb-4 flex items-start justify-between">
                <div>
                  <span className="text-[10px] font-bold tracking-widest text-emerald-600 uppercase">
                    Official Tax Receipt & QR
                  </span>
                  <h3 className="text-xl font-bold">{selectedInvoice.payeeName}</h3>
                  <p className="text-xs text-muted-foreground">
                    Invoice #{selectedInvoice.invoiceNumber} · Ref: {selectedInvoice.referenceNumber}
                  </p>
                </div>
                <div
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    selectedInvoice.status === "PAID"
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                      : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                  }`}
                >
                  {selectedInvoice.status === "PAID" ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>PAID & VERIFIED</span>
                    </>
                  ) : (
                    <>
                      <Clock className="h-3.5 w-3.5 animate-pulse" />
                      <span>AWAITING SCAN</span>
                    </>
                  )}
                </div>
              </div>

              {/* QR Code Container */}
              <div className="flex flex-col items-center justify-center p-4 bg-muted/20 rounded-2xl border border-muted">
                {selectedInvoice.qrDataUrl ? (
                  <div className="relative p-3 bg-white rounded-2xl shadow-md border">
                    <Image
                      src={selectedInvoice.qrDataUrl}
                      alt="0% Fee Direct UPI QR Code"
                      width={220}
                      height={220}
                      className="rounded-lg"
                      unoptimized
                    />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="bg-white/95 rounded-full p-1.5 shadow-md border border-gray-200">
                        <QrCode className="h-6 w-6 text-emerald-700" />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-52 w-52 flex items-center justify-center bg-gray-100 rounded-xl">
                    <QrCode className="h-16 w-16 text-gray-400 animate-pulse" />
                  </div>
                )}

                {/* Amount display */}
                <div className="mt-4 text-center">
                  <p className="text-xs text-muted-foreground">Scan with any UPI App to Pay</p>
                  <p className="text-3xl font-extrabold text-foreground tracking-tight">
                    ₹{(selectedInvoice.amountPaise / 100).toFixed(2)}
                  </p>
                  <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 mt-0.5">
                    0% Processing Fee · Direct Bank Transfer
                  </p>
                </div>
              </div>

              {/* Bill Details */}
              <div className="space-y-2 text-xs border-t pt-4">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Patient / Client:</span>
                  <span className="font-semibold">{selectedInvoice.patientName}</span>
                </div>
                {selectedInvoice.patientPhone && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Phone:</span>
                    <span>{selectedInvoice.patientPhone}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Service:</span>
                  <span className="font-medium">{selectedInvoice.serviceName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">UPI ID (VPA):</span>
                  <span className="font-mono text-[11px]">{selectedInvoice.vpa}</span>
                </div>
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-medium">
                  <span>Merchant Gateway Fee:</span>
                  <span>₹0.00 (Saved ₹{(selectedInvoice.feeSavedPaise / 100).toFixed(2)})</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2.5 pt-2">
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      handleCopy(
                        `upi://pay?pa=${encodeURIComponent(selectedInvoice.vpa)}&pn=${encodeURIComponent(selectedInvoice.payeeName)}&am=${(selectedInvoice.amountPaise / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(selectedInvoice.transactionNote)}`,
                      )
                    }
                    className="text-xs"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-600 mr-1" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 mr-1" />
                        Copy UPI Link
                      </>
                    )}
                  </Button>

                  <Button type="button" variant="outline" onClick={handlePrint} className="text-xs">
                    <Printer className="h-3.5 w-3.5 mr-1" />
                    Print Receipt
                  </Button>
                </div>

                {/* Mark as paid button */}
                {isWritable && selectedInvoice.status === "PENDING" && (
                  <form
                    action={markInvoiceAsPaidAction.bind(null, orgId, selectedInvoice.id)}
                    className="w-full"
                  >
                    <input
                      type="hidden"
                      name="bankRefNumber"
                      value={selectedInvoice.referenceNumber}
                    />
                    <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs h-10">
                      <CheckCircle2 className="h-4 w-4 mr-1.5" />
                      Mark Payment as Received & Settle
                    </Button>
                  </form>
                )}
              </div>
            </div>
          ) : (
            <Card>
              <CardContent className="p-12 text-center text-muted-foreground">
                <QrCode className="mx-auto h-12 w-12 text-muted-foreground/40 mb-3" />
                <h4 className="font-semibold text-foreground">No Invoice Selected</h4>
                <p className="text-xs mt-1">
                  Fill in the patient details on the left to generate an instant 0%-fee Direct UPI
                  QR code.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Recent Invoices Ledger */}
      <section className="space-y-4 pt-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold">Recent Direct UPI Invoices</h3>
            <p className="text-xs text-muted-foreground">
              Direct bank settlements audited under {orgName}
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            {invoices.length ? (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-muted-foreground text-xs uppercase tracking-wider">
                    <th className="py-3 px-4">Invoice #</th>
                    <th className="py-3 px-4">Patient / Customer</th>
                    <th className="py-3 px-4">Service</th>
                    <th className="py-3 px-4">Amount (₹)</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Fee Saved</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {invoices.map((inv) => (
                    <tr
                      key={inv.id}
                      className={`hover:bg-muted/30 transition-colors ${
                        selectedInvoice?.id === inv.id ? "bg-muted/40 font-medium" : ""
                      }`}
                    >
                      <td className="py-3 px-4 font-mono text-xs">{inv.invoiceNumber}</td>
                      <td className="py-3 px-4">
                        <p className="font-medium">{inv.patientName}</p>
                        {inv.patientPhone && (
                          <p className="text-xs text-muted-foreground">{inv.patientPhone}</p>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs text-muted-foreground">{inv.serviceName}</td>
                      <td className="py-3 px-4 font-bold">
                        ₹{(inv.amountPaise / 100).toFixed(2)}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            inv.status === "PAID"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                              : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          }`}
                        >
                          {inv.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        +₹{(inv.feeSavedPaise / 100).toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Button
                          variant="ghost"
                          onClick={() => setSelectedInvoice(inv)}
                          className="h-8 px-2 text-xs"
                        >
                          View QR
                          <ArrowRight className="ml-1 h-3 w-3" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-8 text-center text-muted-foreground">
                <p>No billing invoices generated yet.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
