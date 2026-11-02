import { notFound } from "next/navigation";
import { getPaymentLinkPublic } from "@/modules/billing/gateway-router";
import { payPaymentLinkAction } from "@/app/billing-actions";
import { generateUpiQrDataUrl, buildUpiUri } from "@/modules/billing/upi";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/message";
import Image from "next/image";
import {
  CreditCard,
  QrCode,
  Building,
  ShieldCheck,
  CheckCircle2,
  Clock,
  ArrowRight,
  Zap,
} from "lucide-react";

export default async function PublicPaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ linkId: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { linkId } = await params;
  const { success, error } = await searchParams;

  const data = await getPaymentLinkPublic(linkId);
  if (!data || !data.link) {
    notFound();
  }

  const { link, organizationName, config } = data;
  const amountInr = link.amountPaise / 100;
  const isPaid = link.status === "PAID" || success === "true";

  const vpa = config?.directUpiVpa || "bharathbloom@okicici";
  const upiUri = buildUpiUri({
    vpa,
    payeeName: organizationName,
    amount: amountInr,
    note: link.purpose,
    refId: link.linkCode,
  });

  const qrDataUrl = await generateUpiQrDataUrl(upiUri);

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#091f1d] via-[#0b2422] to-[#061413] py-12 px-4 text-white selection:bg-emerald-500/30">
      <div className="mx-auto max-w-xl space-y-6">
        {/* Brand Header */}
        <header className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-950/60 px-3.5 py-1 text-xs font-semibold tracking-wider text-emerald-300 uppercase">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            Verified Secure Payment Checkout
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            {organizationName}
          </h1>
          <p className="text-xs text-gray-300">
            Reference #{link.linkCode} · Safe multi-gateway transaction
          </p>
        </header>

        <Message error={error} />

        {isPaid ? (
          <Card className="border-emerald-500/40 bg-card/95 text-card-foreground shadow-2xl backdrop-blur-md">
            <CardContent className="p-8 text-center space-y-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
                <CheckCircle2 className="h-10 w-10 animate-bounce" />
              </div>
              <h2 className="text-2xl font-bold">Payment Completed Successfully!</h2>
              <p className="text-sm text-muted-foreground">
                Your payment of <span className="font-bold text-foreground">₹{amountInr.toFixed(2)}</span> for{" "}
                <span className="font-semibold text-foreground">&quot;{link.purpose}&quot;</span> has been recorded and verified.
              </p>
              <div className="rounded-xl border bg-muted/30 p-4 text-xs text-left space-y-2 font-mono">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Receipt Number:</span>
                  <span className="font-bold">{link.referenceNumber || `REF-${link.linkCode}`}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status:</span>
                  <span className="text-emerald-600 font-bold">SETTLED (0% FEE / GATEWAY)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Patient / Client:</span>
                  <span>{link.customerName}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Amount Summary Card */}
            <Card className="border-emerald-500/30 bg-card text-card-foreground shadow-xl">
              <CardContent className="p-6">
                <div className="flex items-start justify-between border-b pb-4">
                  <div>
                    <span className="text-xs font-semibold uppercase text-emerald-600">Bill To</span>
                    <h2 className="text-lg font-bold">{link.customerName}</h2>
                    <p className="text-xs text-muted-foreground">{link.purpose}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-muted-foreground">Amount Due</span>
                    <p className="text-3xl font-extrabold text-foreground">₹{amountInr.toFixed(2)}</p>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Expires: {new Date(link.expiresAt).toLocaleDateString("en-IN")}</span>
                  <span className="text-emerald-600 font-semibold flex items-center gap-1">
                    <Zap className="h-3.5 w-3.5" />
                    Zero surcharge on UPI
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Payment Method Selection Tabs & Form */}
            <Card className="border-white/10 bg-card text-card-foreground shadow-2xl">
              <CardHeader>
                <CardTitle className="text-base font-semibold">Choose Payment Method</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Method 1: 0% Direct UPI QR */}
                <div className="rounded-2xl border-2 border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-950/20 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-xl bg-emerald-600 text-white">
                        <QrCode className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm">Direct UPI QR</span>
                          <span className="text-[10px] font-bold bg-emerald-600 text-white px-2 py-0.5 rounded-full">
                            0% Surcharge
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">GPay, PhonePe, Paytm, BHIM</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center justify-center gap-6 pt-2">
                    <div className="relative p-2 bg-white rounded-xl shadow-md border">
                      <Image
                        src={qrDataUrl}
                        alt="Direct UPI QR Code"
                        width={180}
                        height={180}
                        className="rounded-lg"
                        unoptimized
                      />
                    </div>
                    <div className="space-y-3 text-center sm:text-left text-xs">
                      <p className="text-muted-foreground">
                        Scan with your UPI mobile camera to instantly auto-fill ₹{amountInr.toFixed(2)}.
                      </p>
                      <form action={payPaymentLinkAction.bind(null, link.linkCode)}>
                        <input type="hidden" name="paymentMethod" value="DIRECT_UPI_P2M" />
                        <input type="hidden" name="gateway" value="DIRECT_UPI" />
                        <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs h-9">
                          I Have Completed UPI Payment →
                        </Button>
                      </form>
                    </div>
                  </div>
                </div>

                {/* Method 2: Credit / Debit Card (Razorpay Multi-Gateway Router) */}
                <div className="rounded-2xl border bg-muted/20 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-xl bg-blue-600 text-white">
                        <CreditCard className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm">Credit &amp; Debit Cards</span>
                          <span className="text-[10px] border px-1.5 py-0.2 rounded text-muted-foreground">
                            Via Razorpay Router
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">Visa, Mastercard, RuPay, Amex</p>
                      </div>
                    </div>
                  </div>

                  <form action={payPaymentLinkAction.bind(null, link.linkCode)} className="pt-2">
                    <input type="hidden" name="paymentMethod" value="CREDIT_CARD" />
                    <input type="hidden" name="gateway" value="RAZORPAY" />
                    <Button variant="outline" className="w-full justify-between h-10 text-xs font-medium">
                      <span>Pay ₹{amountInr.toFixed(2)} with Card</span>
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </form>
                </div>

                {/* Method 3: Net Banking (Cashfree Router) */}
                <div className="rounded-2xl border bg-muted/20 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-xl bg-purple-600 text-white">
                        <Building className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm">Net Banking</span>
                          <span className="text-[10px] border px-1.5 py-0.2 rounded text-muted-foreground">
                            Via Cashfree Router
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">HDFC, ICICI, SBI, Axis, Kotak &amp; 50+ Banks</p>
                      </div>
                    </div>
                  </div>

                  <form action={payPaymentLinkAction.bind(null, link.linkCode)} className="pt-2">
                    <input type="hidden" name="paymentMethod" value="NET_BANKING" />
                    <input type="hidden" name="gateway" value="CASHFREE" />
                    <Button variant="outline" className="w-full justify-between h-10 text-xs font-medium">
                      <span>Pay ₹{amountInr.toFixed(2)} with Net Banking</span>
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </form>
                </div>
              </CardContent>
            </Card>

            <footer className="text-center text-xs text-gray-400 space-y-1">
              <div className="flex items-center justify-center gap-2">
                <Clock className="h-3.5 w-3.5" />
                <span>256-bit Bank-Grade SSL Encryption · NPCI &amp; RBI Compliant</span>
              </div>
              <p>Powered by BBD Master ATMA OS Payment Router</p>
            </footer>
          </div>
        )}
      </div>
    </main>
  );
}
