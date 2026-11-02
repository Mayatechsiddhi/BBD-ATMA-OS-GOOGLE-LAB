"use client";

import { useState } from "react";
import {
  QrCode,
  CreditCard,
  Building,
  Link as LinkIcon,
  Repeat,
  Sliders,
  CheckCircle2,
  Clock,
  Copy,
  Check,
  Zap,
  ArrowUpRight,
  Send,
  Users,
  Activity,
  IndianRupee,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  createPaymentLinkAction,
  createSubscriptionPlanAction,
  createCustomerSubscriptionAction,
  updateGatewayConfigAction,
} from "@/app/billing-actions";
import { UpiBillingTerminal, type QueueTokenInfo } from "./upi-billing-terminal";
import type {
  GatewayConfig,
  SubscriptionPlan,
  CustomerSubscription,
  PaymentLink,
} from "@/modules/billing/gateway-router";
import type { BillingInvoice } from "@/modules/billing/service";

export function MultiGatewayDashboard({
  orgId,
  orgName,
  initialTab = "upi",
  gatewayConfig,
  subscriptionPlans = [],
  subscriptions = [],
  paymentLinks = [],
  invoices = [],
  queueTokens = [],
  activeInvoice,
  createDirectInvoiceAction,
  role,
}: {
  orgId: string;
  orgName: string;
  initialTab?: string;
  gatewayConfig: GatewayConfig;
  subscriptionPlans: SubscriptionPlan[];
  subscriptions: CustomerSubscription[];
  paymentLinks: PaymentLink[];
  invoices: BillingInvoice[];
  queueTokens?: QueueTokenInfo[];
  activeInvoice?: BillingInvoice | null;
  createDirectInvoiceAction: (formData: FormData) => void;
  role: string;
}) {
  const [tab, setTab] = useState<string>(initialTab);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const isWritable = role === "OWNER" || role === "ADMIN";

  const handleCopyLink = (url: string, id: string) => {
    const fullUrl = `${window.location.origin}${url}`;
    navigator.clipboard.writeText(fullUrl).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <nav
        aria-label="Billing modules"
        className="flex flex-wrap items-center gap-2 border-b pb-3"
      >
        {[
          { id: "upi", label: "0% Direct UPI Terminal", icon: QrCode, badge: "0% MDR" },
          { id: "links", label: "Payment Links (Cards/NetBanking)", icon: LinkIcon },
          { id: "subscriptions", label: "Recurring Subscriptions", icon: Repeat },
          { id: "gateways", label: "Multi-Gateway Router", icon: Sliders },
        ].map((item) => {
          const Icon = item.icon;
          const isActive = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold tracking-wide transition-all ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
              {item.badge && (
                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Tab 1: 0% Direct UPI Terminal */}
      {tab === "upi" && (
        <UpiBillingTerminal
          orgId={orgId}
          orgName={orgName}
          defaultVpa={gatewayConfig.directUpiVpa}
          createAction={createDirectInvoiceAction}
          queueTokens={queueTokens}
          activeInvoice={activeInvoice}
          invoices={invoices}
          role={role}
        />
      )}

      {/* Tab 2: Payment Links */}
      {tab === "links" && (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-12">
            {/* Create Payment Link Form */}
            {isWritable && (
              <div className="lg:col-span-5">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Send className="h-4 w-4 text-primary" />
                      Create Payment Link
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form
                      action={createPaymentLinkAction.bind(null, orgId)}
                      className="space-y-4 text-xs"
                    >
                      <label className="block text-xs font-medium">
                        Customer / Patient Name
                        <Input
                          name="customerName"
                          placeholder="e.g. Meera Sharma"
                          required
                          className="mt-1"
                        />
                      </label>

                      <div className="grid grid-cols-2 gap-3">
                        <label className="block text-xs font-medium">
                          Phone (for SMS/WhatsApp)
                          <Input
                            name="customerPhone"
                            placeholder="+91 98765 43210"
                            className="mt-1"
                          />
                        </label>
                        <label className="block text-xs font-medium">
                          Email (Optional)
                          <Input
                            name="customerEmail"
                            type="email"
                            placeholder="patient@example.com"
                            className="mt-1"
                          />
                        </label>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <label className="block text-xs font-medium">
                          Amount (₹ INR)
                          <Input
                            name="amountInr"
                            type="number"
                            min={1}
                            placeholder="1500"
                            required
                            className="mt-1 font-bold text-sm"
                          />
                        </label>
                        <label className="block text-xs font-medium">
                          Preferred Gateway
                          <select
                            name="preferredGateway"
                            defaultValue="SMART_ROUTER"
                            className="mt-1 block h-10 w-full rounded-md border bg-background px-3"
                          >
                            <option value="SMART_ROUTER">Smart Router (Auto)</option>
                            <option value="RAZORPAY">Razorpay (Cards/UPI)</option>
                            <option value="CASHFREE">Cashfree (Cards/NB)</option>
                            <option value="DIRECT_UPI">Direct UPI (0% Fee)</option>
                          </select>
                        </label>
                      </div>

                      <label className="block text-xs font-medium">
                        Payment Purpose / Notes
                        <Input
                          name="purpose"
                          placeholder="e.g. Lab Tests &amp; Doctor Follow-up"
                          required
                          className="mt-1"
                        />
                      </label>

                      <Button className="w-full h-10 text-xs">
                        Generate &amp; Share Payment Link
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Links List */}
            <div className={isWritable ? "lg:col-span-7" : "lg:col-span-12"}>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center justify-between">
                    <span>Active Payment Links</span>
                    <span className="text-xs text-muted-foreground font-normal">
                      {paymentLinks.length} total generated
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  {paymentLinks.length ? (
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b bg-muted/30 text-muted-foreground uppercase">
                          <th className="py-2.5 px-4">Link Ref</th>
                          <th className="py-2.5 px-4">Customer</th>
                          <th className="py-2.5 px-4">Amount</th>
                          <th className="py-2.5 px-4">Gateway</th>
                          <th className="py-2.5 px-4">Status</th>
                          <th className="py-2.5 px-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {paymentLinks.map((link) => (
                          <tr key={link.id} className="hover:bg-muted/20">
                            <td className="py-3 px-4 font-mono">{link.linkCode}</td>
                            <td className="py-3 px-4">
                              <p className="font-semibold">{link.customerName}</p>
                              <p className="text-[11px] text-muted-foreground">{link.purpose}</p>
                            </td>
                            <td className="py-3 px-4 font-bold">
                              ₹{(link.amountPaise / 100).toFixed(2)}
                            </td>
                            <td className="py-3 px-4">
                              <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-medium">
                                {link.gateway}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                  link.status === "PAID"
                                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                    : "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                                }`}
                              >
                                {link.status === "PAID" ? (
                                  <CheckCircle2 className="h-3 w-3" />
                                ) : (
                                  <Clock className="h-3 w-3" />
                                )}
                                {link.status}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right space-x-1">
                              <Button
                                variant="outline"
                                onClick={() => handleCopyLink(link.shortUrl, link.id)}
                                className="h-7 px-2 text-[11px]"
                              >
                                {copiedId === link.id ? (
                                  <>
                                    <Check className="h-3 w-3 text-emerald-600 mr-1" />
                                    Copied
                                  </>
                                ) : (
                                  <>
                                    <Copy className="h-3 w-3 mr-1" />
                                    Copy
                                  </>
                                )}
                              </Button>
                              <a
                                href={link.shortUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center justify-center rounded-md border h-7 px-2 text-[11px] font-medium hover:bg-muted"
                              >
                                <ArrowUpRight className="h-3 w-3" />
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="p-8 text-center text-muted-foreground">
                      No payment links created yet.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Recurring Subscriptions */}
      {tab === "subscriptions" && (
        <div className="space-y-6">
          {/* Subscription KPI Cards */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <p className="text-xs text-muted-foreground">Active Subscribers</p>
                <div className="flex items-center gap-2 text-2xl font-bold">
                  <Users className="h-5 w-5 text-primary" />
                  {subscriptions.filter((s) => s.status === "ACTIVE").length}
                </div>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <p className="text-xs text-muted-foreground">Monthly Recurring Revenue (MRR)</p>
                <div className="flex items-center gap-1 text-2xl font-bold text-emerald-600">
                  <IndianRupee className="h-5 w-5" />
                  {(
                    subscriptions
                      .filter((s) => s.status === "ACTIVE")
                      .reduce((acc, curr) => {
                        const m =
                          curr.interval === "annual"
                            ? Math.round(curr.amountPaise / 12)
                            : curr.amountPaise;
                        return acc + m;
                      }, 0) / 100
                  ).toFixed(2)}
                </div>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <p className="text-xs text-muted-foreground">Auto-Debit Mandates</p>
                <div className="flex items-center gap-2 text-2xl font-bold text-blue-600">
                  <Activity className="h-5 w-5" />
                  {subscriptions.filter((s) => s.autoDebitEnabled).length} Active e-Mandates
                </div>
              </CardHeader>
            </Card>
          </div>

          {/* Subscription Plans Catalog */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">Health Care &amp; OPD Membership Plans</h3>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {subscriptionPlans.map((plan) => (
                <Card key={plan.id} className="relative flex flex-col justify-between">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-[10px] font-bold text-primary uppercase">
                          {plan.interval}
                        </span>
                        <CardTitle className="text-base">{plan.name}</CardTitle>
                      </div>
                      <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-mono">
                        {plan.code}
                      </span>
                    </div>
                    <div className="mt-2 text-2xl font-black">
                      ₹{(plan.amountPaise / 100).toFixed(0)}
                      <span className="text-xs font-normal text-muted-foreground">
                        /{plan.interval}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{plan.description}</p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ul className="space-y-1.5 text-xs">
                      {plan.features.map((f, i) => (
                        <li key={i} className="flex items-center gap-1.5 text-muted-foreground">
                          <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="pt-2 border-t flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>Gateway Engine:</span>
                      <span className="font-semibold text-foreground">
                        {plan.gatewayPreference} e-Mandate
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          {/* Active Subscribers Table */}
          <section className="space-y-4">
            <h3 className="text-lg font-bold">Subscribers &amp; Mandate Status</h3>
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                {subscriptions.length ? (
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b bg-muted/30 text-muted-foreground uppercase">
                        <th className="py-2.5 px-4">Subscriber</th>
                        <th className="py-2.5 px-4">Plan</th>
                        <th className="py-2.5 px-4">Amount</th>
                        <th className="py-2.5 px-4">Gateway</th>
                        <th className="py-2.5 px-4">Next Charge Date</th>
                        <th className="py-2.5 px-4">Mandate Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {subscriptions.map((sub) => (
                        <tr key={sub.id} className="hover:bg-muted/20">
                          <td className="py-3 px-4">
                            <p className="font-semibold">{sub.customerName}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {sub.customerPhone} · {sub.customerEmail}
                            </p>
                          </td>
                          <td className="py-3 px-4 font-medium">{sub.plan?.name || sub.planId}</td>
                          <td className="py-3 px-4 font-bold">
                            ₹{(sub.amountPaise / 100).toFixed(0)}/{sub.interval}
                          </td>
                          <td className="py-3 px-4">
                            <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-mono">
                              {sub.gateway}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-muted-foreground">
                            {new Date(sub.nextChargeDate).toLocaleDateString("en-IN")}
                          </td>
                          <td className="py-3 px-4">
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 px-2 py-0.5 text-[10px] font-bold">
                              <CheckCircle2 className="h-3 w-3" />
                              AUTO-DEBIT ACTIVE
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-8 text-center text-muted-foreground">
                    No active subscribers currently enrolled.
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          {/* Enrollment & Plan Creation Forms */}
          {isWritable && (
            <div className="grid gap-6 md:grid-cols-2 pt-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    Enroll Subscriber Mandate
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form
                    action={createCustomerSubscriptionAction.bind(null, orgId)}
                    className="space-y-3 text-xs"
                  >
                    <label className="block">
                      Select Plan
                      <select
                        name="planId"
                        required
                        className="mt-1 block h-9 w-full rounded-md border bg-background px-2"
                      >
                        {subscriptionPlans.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} (₹{(p.amountPaise / 100).toFixed(0)}/{p.interval})
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      Subscriber Name
                      <Input name="customerName" required placeholder="e.g. Ananya Roy" className="mt-1 h-9" />
                    </label>

                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        Phone
                        <Input name="customerPhone" required placeholder="+91 98765 43210" className="mt-1 h-9" />
                      </label>
                      <label className="block">
                        Email
                        <Input name="customerEmail" type="email" required placeholder="patient@example.com" className="mt-1 h-9" />
                      </label>
                    </div>

                    <label className="block">
                      e-Mandate Gateway
                      <select
                        name="gatewayOverride"
                        defaultValue=""
                        className="mt-1 block h-9 w-full rounded-md border bg-background px-2"
                      >
                        <option value="">Plan Default</option>
                        <option value="RAZORPAY">Razorpay e-Mandate</option>
                        <option value="CASHFREE">Cashfree Subscriptions</option>
                      </select>
                    </label>

                    <Button className="w-full h-9 text-xs">
                      Enroll Subscriber &amp; Activate Auto-Debit
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Repeat className="h-4 w-4 text-primary" />
                    Create New Plan
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form
                    action={createSubscriptionPlanAction.bind(null, orgId)}
                    className="space-y-3 text-xs"
                  >
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        Plan Name
                        <Input name="name" required placeholder="e.g. Cardiac Care Pass" className="mt-1 h-9" />
                      </label>
                      <label className="block">
                        Plan Code
                        <Input name="code" required placeholder="CARDIAC-CARE" className="mt-1 h-9" />
                      </label>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        Price (₹ INR)
                        <Input name="amountInr" type="number" min={1} required placeholder="1499" className="mt-1 h-9 font-bold" />
                      </label>
                      <label className="block">
                        Billing Interval
                        <select
                          name="interval"
                          defaultValue="monthly"
                          className="mt-1 block h-9 w-full rounded-md border bg-background px-2"
                        >
                          <option value="monthly">Monthly</option>
                          <option value="quarterly">Quarterly</option>
                          <option value="annual">Annual</option>
                        </select>
                      </label>
                    </div>

                    <label className="block">
                      Plan Description
                      <Input name="description" required placeholder="Monthly specialist visits &amp; vitals check" className="mt-1 h-9" />
                    </label>

                    <label className="block">
                      Features (Comma-separated)
                      <Input name="features" placeholder="Free consultations, 15% off labs, Tele-health" className="mt-1 h-9" />
                    </label>

                    <Button className="w-full h-9 text-xs">
                      Create Subscription Plan
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Multi-Gateway Router Settings */}
      {tab === "gateways" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Sliders className="h-5 w-5 text-primary" />
                    Multi-Gateway Router Configuration
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Route between Direct UPI (0% fee), Razorpay, and Cashfree dynamically based on
                    cost and payment method.
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {isWritable ? (
                <form
                  action={updateGatewayConfigAction.bind(null, orgId)}
                  className="space-y-6 text-xs"
                >
                  {/* Smart Router Rules */}
                  <div className="rounded-2xl border-2 border-emerald-500/40 bg-emerald-50/30 dark:bg-emerald-950/20 p-5 space-y-4">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-emerald-600" />
                      <h4 className="font-bold text-sm">Smart Dynamic Routing Rules</h4>
                    </div>

                    <div className="space-y-3">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          name="smartRouteUpiToDirect"
                          defaultChecked={gatewayConfig.smartRouteUpiToDirect}
                          className="h-4 w-4 rounded text-emerald-600"
                        />
                        <div>
                          <span className="font-semibold text-foreground">
                            Route all Domestic UPI transactions to 0%-Fee Direct UPI QR
                          </span>
                          <p className="text-muted-foreground">
                            Saves 2.36% gateway fees on every UPI payment while crediting directly to
                            clinic bank account.
                          </p>
                        </div>
                      </label>

                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          name="smartRoutingEnabled"
                          defaultChecked={gatewayConfig.smartRoutingEnabled}
                          className="h-4 w-4 rounded text-emerald-600"
                        />
                        <div>
                          <span className="font-semibold text-foreground">
                            Enable Automatic Gateway Failover (Razorpay ↔ Cashfree)
                          </span>
                          <p className="text-muted-foreground">
                            Automatically switches traffic if a payment gateway reports degraded API
                            success rates.
                          </p>
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* Primary & Fallback Selection */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block text-xs font-medium">
                      Primary Gateway Mode
                      <select
                        name="activeGateway"
                        defaultValue={gatewayConfig.activeGateway}
                        className="mt-1 block h-10 w-full rounded-md border bg-background px-3"
                      >
                        <option value="SMART_ROUTER">Smart Router (Lowest fee + Auto-Failover)</option>
                        <option value="DIRECT_UPI">Direct UPI Only (0% Fee)</option>
                        <option value="RAZORPAY">Razorpay Dedicated</option>
                        <option value="CASHFREE">Cashfree Dedicated</option>
                      </select>
                    </label>

                    <label className="block text-xs font-medium">
                      Fallback Gateway Provider
                      <select
                        name="fallbackGateway"
                        defaultValue={gatewayConfig.fallbackGateway}
                        className="mt-1 block h-10 w-full rounded-md border bg-background px-3"
                      >
                        <option value="CASHFREE">Cashfree Payments</option>
                        <option value="RAZORPAY">Razorpay</option>
                        <option value="DIRECT_UPI">Direct UPI QR</option>
                      </select>
                    </label>
                  </div>

                  <div className="grid gap-6 md:grid-cols-2 pt-2">
                    {/* Razorpay Credentials Card */}
                    <div className="rounded-xl border p-4 space-y-3 bg-muted/10">
                      <div className="flex items-center justify-between border-b pb-2">
                        <div className="flex items-center gap-2">
                          <CreditCard className="h-4 w-4 text-blue-600" />
                          <span className="font-bold text-sm">Razorpay Integration</span>
                        </div>
                        <label className="flex items-center gap-1.5 text-xs font-semibold">
                          <input
                            type="checkbox"
                            name="razorpayEnabled"
                            defaultChecked={gatewayConfig.razorpayEnabled}
                          />
                          Enabled
                        </label>
                      </div>

                      <label className="block">
                        Razorpay Key ID
                        <Input
                          name="razorpayKeyId"
                          defaultValue={gatewayConfig.razorpayKeyId}
                          className="mt-1 font-mono text-xs"
                        />
                      </label>

                      <label className="block">
                        Environment Mode
                        <select
                          name="razorpayMode"
                          defaultValue={gatewayConfig.razorpayMode}
                          className="mt-1 block h-9 w-full rounded-md border bg-background px-2 text-xs"
                        >
                          <option value="test">Test Sandbox Mode</option>
                          <option value="live">Live Production</option>
                        </select>
                      </label>
                    </div>

                    {/* Cashfree Credentials Card */}
                    <div className="rounded-xl border p-4 space-y-3 bg-muted/10">
                      <div className="flex items-center justify-between border-b pb-2">
                        <div className="flex items-center gap-2">
                          <Building className="h-4 w-4 text-purple-600" />
                          <span className="font-bold text-sm">Cashfree Payments</span>
                        </div>
                        <label className="flex items-center gap-1.5 text-xs font-semibold">
                          <input
                            type="checkbox"
                            name="cashfreeEnabled"
                            defaultChecked={gatewayConfig.cashfreeEnabled}
                          />
                          Enabled
                        </label>
                      </div>

                      <label className="block">
                        Cashfree App ID
                        <Input
                          name="cashfreeAppId"
                          defaultValue={gatewayConfig.cashfreeAppId}
                          className="mt-1 font-mono text-xs"
                        />
                      </label>

                      <label className="block">
                        Environment Mode
                        <select
                          name="cashfreeMode"
                          defaultValue={gatewayConfig.cashfreeMode}
                          className="mt-1 block h-9 w-full rounded-md border bg-background px-2 text-xs"
                        >
                          <option value="sandbox">Sandbox Mode</option>
                          <option value="production">Production</option>
                        </select>
                      </label>
                    </div>
                  </div>

                  <label className="block text-xs font-medium">
                    Direct UPI Payee VPA
                    <Input
                      name="directUpiVpa"
                      defaultValue={gatewayConfig.directUpiVpa}
                      className="mt-1 font-mono"
                    />
                  </label>

                  <Button className="h-10 text-xs">Save Gateway Router Settings</Button>
                </form>
              ) : (
                <p className="text-xs text-muted-foreground">
                  You have view-only access to gateway configuration.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
