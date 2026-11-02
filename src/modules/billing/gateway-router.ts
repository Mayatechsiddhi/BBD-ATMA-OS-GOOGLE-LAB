import { inMemoryDb } from "@/lib/in-memory-db";
import { audit } from "@/modules/organizations/access";
import { moduleAccess } from "@/modules/entitlements/access";
import { AccessError } from "@/modules/organizations/policy";
import { calculateGatewaySavings } from "./upi";

const withOrganization = moduleAccess("clinic");

export type GatewayType = "SMART_ROUTER" | "DIRECT_UPI" | "RAZORPAY" | "CASHFREE";

export type PaymentMethod =
  | "DIRECT_UPI_P2M"
  | "CREDIT_CARD"
  | "DEBIT_CARD"
  | "NET_BANKING"
  | "PAYMENT_LINK"
  | "SUBSCRIPTION_MANDATE";

export type GatewayConfig = {
  id: string;
  organizationId: string;
  activeGateway: GatewayType;
  fallbackGateway: "RAZORPAY" | "CASHFREE" | "DIRECT_UPI";
  smartRoutingEnabled: boolean;
  smartRouteUpiToDirect: boolean;
  razorpayEnabled: boolean;
  razorpayKeyId: string;
  razorpayKeySecret?: string;
  razorpayMode: "test" | "live";
  cashfreeEnabled: boolean;
  cashfreeAppId: string;
  cashfreeSecretKey?: string;
  cashfreeMode: "sandbox" | "production";
  directUpiVpa: string;
  autoRefundOnFailure: boolean;
  updatedAt: Date;
};

export type SubscriptionPlan = {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  interval: "monthly" | "quarterly" | "annual";
  amountPaise: number;
  description: string;
  gatewayPreference: "RAZORPAY" | "CASHFREE";
  features: string[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type CustomerSubscription = {
  id: string;
  organizationId: string;
  planId: string;
  plan?: SubscriptionPlan;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  gateway: "RAZORPAY" | "CASHFREE";
  gatewaySubscriptionId: string;
  status: "ACTIVE" | "PENDING_AUTH" | "PAUSED" | "CANCELLED";
  autoDebitEnabled: boolean;
  amountPaise: number;
  interval: "monthly" | "quarterly" | "annual";
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  nextChargeDate: Date;
  lastPaymentStatus: "SUCCESS" | "FAILED";
  createdAt: Date;
};

export type PaymentLink = {
  id: string;
  organizationId: string;
  linkCode: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  amountPaise: number;
  purpose: string;
  gateway: GatewayType;
  status: "ACTIVE" | "PAID" | "EXPIRED";
  shortUrl: string;
  paidAt?: Date;
  paymentMethod?: string;
  referenceNumber?: string;
  expiresAt: Date;
  createdAt: Date;
};

/**
 * Multi-Gateway Smart Router
 * Evaluates payment method, transaction size, and tenant configuration to select optimal provider.
 */
export function routePaymentMethod(
  method: PaymentMethod,
  config: GatewayConfig,
): {
  selectedGateway: "DIRECT_UPI" | "RAZORPAY" | "CASHFREE";
  feePercent: number;
  routingRationale: string;
  fallbackGateway: "RAZORPAY" | "CASHFREE";
} {
  // Rule 1: Domestic UPI payments routed to 0% direct UPI QR
  if (method === "DIRECT_UPI_P2M" && config.smartRouteUpiToDirect) {
    return {
      selectedGateway: "DIRECT_UPI",
      feePercent: 0.0,
      routingRationale: "Smart Router: Selected Direct NPCI UPI (0% MDR, ₹0 Gateway Commission)",
      fallbackGateway: config.razorpayEnabled ? "RAZORPAY" : "CASHFREE",
    };
  }

  // Rule 2: Subscriptions and Mandates
  if (method === "SUBSCRIPTION_MANDATE") {
    const chosen = config.razorpayEnabled ? "RAZORPAY" : "CASHFREE";
    return {
      selectedGateway: chosen,
      feePercent: chosen === "RAZORPAY" ? 2.0 : 1.9,
      routingRationale: `Smart Router: Selected ${chosen} recurring e-mandate engine`,
      fallbackGateway: chosen === "RAZORPAY" ? "CASHFREE" : "RAZORPAY",
    };
  }

  // Rule 3: Cards & Net Banking
  // If activeGateway is explicitly set to CASHFREE or RAZORPAY
  if (config.activeGateway === "CASHFREE" && config.cashfreeEnabled) {
    return {
      selectedGateway: "CASHFREE",
      feePercent: 1.85,
      routingRationale: "Primary Gateway Override: Cashfree Payments (Cards / Net Banking)",
      fallbackGateway: "RAZORPAY",
    };
  }

  if (config.activeGateway === "RAZORPAY" && config.razorpayEnabled) {
    return {
      selectedGateway: "RAZORPAY",
      feePercent: 2.0,
      routingRationale: "Primary Gateway Override: Razorpay Standard Checkout",
      fallbackGateway: "CASHFREE",
    };
  }

  // Default Smart Router: Select lowest fee gateway with highest card success rates
  const primary = config.razorpayEnabled ? "RAZORPAY" : "CASHFREE";
  return {
    selectedGateway: primary,
    feePercent: primary === "RAZORPAY" ? 2.0 : 1.85,
    routingRationale: `Smart Router: Routed ${method.replace("_", " ")} to ${primary} with auto-failover to ${config.fallbackGateway}`,
    fallbackGateway: config.fallbackGateway === "RAZORPAY" ? "RAZORPAY" : "CASHFREE",
  };
}

export async function getGatewayConfig(actor: string, orgId: string): Promise<GatewayConfig> {
  return withOrganization(actor, orgId, "read", async () => {
    let config = (await inMemoryDb.gatewayConfig.findFirst({
      where: { organizationId: orgId },
    })) as GatewayConfig | null;

    if (!config) {
      config = {
        id: `gwcfg_${orgId}`,
        organizationId: orgId,
        activeGateway: "SMART_ROUTER",
        fallbackGateway: "CASHFREE",
        smartRoutingEnabled: true,
        smartRouteUpiToDirect: true,
        razorpayEnabled: true,
        razorpayKeyId: "rzp_test_bbd_k9210a",
        razorpayMode: "test",
        cashfreeEnabled: true,
        cashfreeAppId: "cf_test_bbd_app_8201",
        cashfreeMode: "sandbox",
        directUpiVpa: `${orgId.replace(/[^a-z0-9]/g, "")}@okicici`,
        autoRefundOnFailure: true,
        updatedAt: new Date(),
      };
      await inMemoryDb.gatewayConfig.create({ data: config });
    }

    return config;
  });
}

export async function updateGatewayConfig(
  actor: string,
  orgId: string,
  data: Partial<GatewayConfig>,
) {
  return withOrganization(actor, orgId, "settings", async (tx) => {
    const existing = await getGatewayConfig(actor, orgId);
    const updated = await inMemoryDb.gatewayConfig.update({
      where: { id: existing.id },
      data: {
        ...data,
        updatedAt: new Date(),
      },
    });

    await audit(tx, orgId, actor, "billing.gateway_config.updated");
    return updated as GatewayConfig;
  });
}

export async function listSubscriptionsData(actor: string, orgId: string) {
  return withOrganization(actor, orgId, "read", async () => {
    const plans = (await inMemoryDb.subscriptionPlan.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
    })) as SubscriptionPlan[];

    const subscriptions = (await inMemoryDb.subscription.findMany({
      where: { organizationId: orgId },
      include: { plan: true },
      orderBy: { createdAt: "desc" },
    })) as CustomerSubscription[];

    const activeCount = subscriptions.filter((s) => s.status === "ACTIVE").length;
    const mrrPaise = subscriptions
      .filter((s) => s.status === "ACTIVE")
      .reduce((acc, curr) => {
        const monthlyAmount =
          curr.interval === "annual" ? Math.round(curr.amountPaise / 12) : curr.amountPaise;
        return acc + monthlyAmount;
      }, 0);

    return {
      plans,
      subscriptions,
      stats: {
        totalPlans: plans.length,
        activeSubscriptions: activeCount,
        mrrPaise,
      },
    };
  });
}

export async function createSubscriptionPlan(
  actor: string,
  orgId: string,
  input: {
    name: string;
    code: string;
    interval: "monthly" | "quarterly" | "annual";
    amountInr: number;
    description: string;
    gatewayPreference: "RAZORPAY" | "CASHFREE";
    features: string[];
  },
) {
  return withOrganization(actor, orgId, "crm:write", async (tx) => {
    const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const plan: SubscriptionPlan = {
      id: planId,
      organizationId: orgId,
      name: input.name.trim(),
      code: input.code.trim().toUpperCase(),
      interval: input.interval,
      amountPaise: Math.round(input.amountInr * 100),
      description: input.description.trim(),
      gatewayPreference: input.gatewayPreference,
      features: input.features.filter(Boolean),
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await inMemoryDb.subscriptionPlan.create({ data: plan });
    await audit(tx, orgId, actor, "billing.subscription_plan.created", plan.id);
    return plan;
  });
}

export async function createCustomerSubscription(
  actor: string,
  orgId: string,
  input: {
    planId: string;
    customerName: string;
    customerPhone: string;
    customerEmail: string;
    gatewayOverride?: "RAZORPAY" | "CASHFREE";
  },
) {
  return withOrganization(actor, orgId, "crm:write", async (tx) => {
    const plan = (await inMemoryDb.subscriptionPlan.findUnique({
      where: { id: input.planId },
    })) as SubscriptionPlan | null;
    if (!plan || plan.organizationId !== orgId) throw new AccessError();

    const config = await getGatewayConfig(actor, orgId);
    const gateway = input.gatewayOverride || plan.gatewayPreference || (config.razorpayEnabled ? "RAZORPAY" : "CASHFREE");

    const days = plan.interval === "annual" ? 365 : plan.interval === "quarterly" ? 90 : 30;
    const now = new Date();
    const nextCharge = new Date(now.getTime() + days * 86400000);

    const subscription: CustomerSubscription = {
      id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      organizationId: orgId,
      planId: plan.id,
      customerName: input.customerName.trim(),
      customerPhone: input.customerPhone.trim(),
      customerEmail: input.customerEmail.trim(),
      gateway,
      gatewaySubscriptionId: `sub_${gateway.toLowerCase().slice(0, 3)}_${Math.random().toString(36).slice(2, 10)}`,
      status: "ACTIVE",
      autoDebitEnabled: true,
      amountPaise: plan.amountPaise,
      interval: plan.interval,
      currentPeriodStart: now,
      currentPeriodEnd: nextCharge,
      nextChargeDate: nextCharge,
      lastPaymentStatus: "SUCCESS",
      createdAt: now,
    };

    await inMemoryDb.subscription.create({ data: subscription });
    await audit(tx, orgId, actor, "billing.subscription.created", subscription.id);
    return subscription;
  });
}

export async function listPaymentLinks(actor: string, orgId: string) {
  return withOrganization(actor, orgId, "read", async () => {
    const links = (await inMemoryDb.paymentLink.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
    })) as PaymentLink[];

    const activeCount = links.filter((l) => l.status === "ACTIVE").length;
    const paidCount = links.filter((l) => l.status === "PAID").length;
    const totalCollectedPaise = links
      .filter((l) => l.status === "PAID")
      .reduce((acc, curr) => acc + (curr.amountPaise || 0), 0);

    return {
      links,
      stats: {
        totalLinks: links.length,
        activeCount,
        paidCount,
        totalCollectedPaise,
      },
    };
  });
}

export async function createPaymentLink(
  actor: string,
  orgId: string,
  input: {
    customerName: string;
    customerPhone?: string;
    customerEmail?: string;
    amountInr: number;
    purpose: string;
    preferredGateway?: GatewayType;
  },
) {
  return withOrganization(actor, orgId, "crm:write", async (tx) => {
    const linkCode = `bbd_pay_${Date.now().toString().slice(-4)}${Math.floor(100 + Math.random() * 900)}`;
    const config = await getGatewayConfig(actor, orgId);
    const gateway = input.preferredGateway || config.activeGateway;

    const link: PaymentLink = {
      id: `plink_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      organizationId: orgId,
      linkCode,
      customerName: input.customerName.trim(),
      customerPhone: input.customerPhone?.trim(),
      customerEmail: input.customerEmail?.trim(),
      amountPaise: Math.round(input.amountInr * 100),
      purpose: input.purpose.trim(),
      gateway,
      status: "ACTIVE",
      shortUrl: `/pay/${linkCode}`,
      expiresAt: new Date(Date.now() + 7 * 86400000), // 7 days expiry
      createdAt: new Date(),
    };

    await inMemoryDb.paymentLink.create({ data: link });
    await audit(tx, orgId, actor, "billing.payment_link.created", link.id);
    return link;
  });
}

export async function getPaymentLinkPublic(linkCode: string) {
  const link = (await inMemoryDb.paymentLink.findFirst({
    where: { linkCode },
  })) as PaymentLink | null;

  if (!link) return null;

  const org = await inMemoryDb.organization.get(link.organizationId);
  const config = (await inMemoryDb.gatewayConfig.findFirst({
    where: { organizationId: link.organizationId },
  })) as GatewayConfig | null;

  return {
    link,
    organizationName: org?.name || "BBD Clinic",
    config,
  };
}

export async function payPaymentLinkPublic(
  linkCode: string,
  paymentMethod: PaymentMethod,
  gateway: "DIRECT_UPI" | "RAZORPAY" | "CASHFREE",
  referenceNumber: string,
) {
  const link = (await inMemoryDb.paymentLink.findFirst({
    where: { linkCode },
  })) as PaymentLink | null;

  if (!link || link.status !== "ACTIVE") {
    throw new Error("This payment link is invalid or already paid.");
  }

  const updated = await inMemoryDb.paymentLink.update({
    where: { id: link.id },
    data: {
      status: "PAID",
      paidAt: new Date(),
      paymentMethod,
      gateway,
      referenceNumber,
    },
  });

  // Also create a billing invoice ledger entry
  const savings = calculateGatewaySavings(link.amountPaise / 100);
  const invNumber = `INV-${Date.now().toString().slice(-6)}`;
  await inMemoryDb.billingInvoice.create({
    data: {
      id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      organizationId: link.organizationId,
      invoiceNumber: invNumber,
      patientName: link.customerName,
      patientPhone: link.customerPhone,
      amountPaise: link.amountPaise,
      serviceName: link.purpose,
      vpa: gateway === "DIRECT_UPI" ? "bharathbloom@okicici" : `${gateway.toLowerCase()}@gateway`,
      payeeName: "BBD Health Services",
      status: "PAID",
      paymentMethod,
      feeSavedPaise: gateway === "DIRECT_UPI" ? savings.savedPaise : 0,
      paidAt: new Date(),
      transactionNote: `${link.purpose} (via ${gateway})`,
      referenceNumber,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  return updated;
}
