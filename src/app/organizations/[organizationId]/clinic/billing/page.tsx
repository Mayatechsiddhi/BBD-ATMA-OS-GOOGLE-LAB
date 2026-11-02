import { organizationContext } from "@/modules/organizations/page-context";
import { listInvoices } from "@/modules/billing/service";
import {
  getGatewayConfig,
  listSubscriptionsData,
  listPaymentLinks,
} from "@/modules/billing/gateway-router";
import { createDirectInvoiceAction } from "@/app/billing-actions";
import { ClinicHeader } from "@/components/clinic";
import { Message } from "@/components/message";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { MultiGatewayDashboard } from "@/components/multi-gateway-dashboard";
import type { QueueTokenInfo } from "@/components/upi-billing-terminal";
import { IndianRupee, ShieldCheck, Zap } from "lucide-react";

export default async function ClinicBillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{
    activeInvoice?: string;
    tab?: string;
    error?: string;
  }>;
}) {
  const { organizationId } = await params;
  const { user, role, organization } = await organizationContext(
    organizationId,
    "clinic",
  );
  const { activeInvoice: activeInvoiceId, tab, error } = await searchParams;

  const [invoicesData, gatewayConfig, subsData, linksData] = await Promise.all([
    listInvoices(user.id, organizationId),
    getGatewayConfig(user.id, organizationId),
    listSubscriptionsData(user.id, organizationId),
    listPaymentLinks(user.id, organizationId),
  ]);

  const activeInvoice =
    invoicesData.invoices.find((i) => i.id === activeInvoiceId) ||
    invoicesData.invoices[0] ||
    null;

  return (
    <>
      <ClinicHeader
        org={organizationId}
        title="Multi-Gateway Billing &amp; Payment Router"
        description="Unified payment infrastructure: 0%-fee Direct UPI QR engine, Razorpay &amp; Cashfree multi-gateway routing for credit cards, debit cards, net banking, payment links, and recurring subscriptions."
      />

      <Message error={error} />

      {/* High-level KPI Summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <p className="text-xs font-medium text-muted-foreground">
              Total Invoiced &amp; Collected
            </p>
            <div className="flex items-center gap-1 text-2xl font-bold text-foreground">
              <IndianRupee className="h-5 w-5 text-emerald-600" />
              {(
                (invoicesData.stats.totalCollectedPaise +
                  linksData.stats.totalCollectedPaise) /
                100
              ).toFixed(2)}
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Across UPI, Cards, Net Banking &amp; Links
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <p className="text-xs font-medium text-muted-foreground">
              Active Recurring MRR
            </p>
            <div className="flex items-center gap-1 text-2xl font-bold text-blue-600">
              <IndianRupee className="h-5 w-5" />
              {(subsData.stats.mrrPaise / 100).toFixed(2)}
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {subsData.stats.activeSubscriptions} active subscriber mandates
            </p>
          </CardContent>
        </Card>

        <Card className="border-emerald-500/30 bg-emerald-50/40 dark:bg-emerald-950/20">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                0% UPI Gateway Fee Saved
              </p>
              <Zap className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="flex items-center gap-1 text-2xl font-extrabold text-emerald-700 dark:text-emerald-300">
              <IndianRupee className="h-5 w-5" />
              {(invoicesData.stats.totalFeeSavedPaise / 100).toFixed(2)}
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-emerald-700/80 dark:text-emerald-400">
              Direct P2M bank transfers
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                Active Gateways
              </p>
              <ShieldCheck className="h-4 w-4 text-primary" />
            </div>
            <div className="flex items-center gap-2 text-xl font-bold text-foreground">
              <span className="inline-flex items-center gap-1 text-xs bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 px-2 py-0.5 rounded-md font-semibold">
                UPI
              </span>
              <span className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 px-2 py-0.5 rounded-md font-semibold">
                Razorpay
              </span>
              <span className="inline-flex items-center gap-1 text-xs bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 px-2 py-0.5 rounded-md font-semibold">
                Cashfree
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Smart Router active with auto-failover
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Multi-Gateway Main Terminal & Modules */}
      <MultiGatewayDashboard
        orgId={organizationId}
        orgName={organization.name}
        initialTab={tab || "upi"}
        gatewayConfig={gatewayConfig}
        subscriptionPlans={subsData.plans}
        subscriptions={subsData.subscriptions}
        paymentLinks={linksData.links}
        invoices={invoicesData.invoices}
        queueTokens={invoicesData.queueTokens as unknown as QueueTokenInfo[]}
        activeInvoice={activeInvoice}
        createDirectInvoiceAction={createDirectInvoiceAction.bind(
          null,
          organizationId,
        )}
        role={role}
      />
    </>
  );
}
