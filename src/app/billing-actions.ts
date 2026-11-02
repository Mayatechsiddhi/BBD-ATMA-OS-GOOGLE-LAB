"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { AccessError } from "@/modules/organizations/policy";
import { logger } from "@/lib/logger";
import { createDirectInvoice, markInvoiceAsPaid } from "@/modules/billing/service";
import {
  createPaymentLink,
  createCustomerSubscription,
  createSubscriptionPlan,
  updateGatewayConfig,
  payPaymentLinkPublic,
  type GatewayType,
  type PaymentMethod,
} from "@/modules/billing/gateway-router";

function value(data: FormData, key: string, fallback = ""): string {
  const v = data.get(key);
  if (typeof v !== "string") return fallback;
  return v;
}

export async function createDirectInvoiceAction(
  organizationId: string,
  data: FormData,
) {
  const { user } = await requireSession();
  let error: string | undefined;
  let newInvoiceId: string | undefined;

  try {
    const patientName = value(data, "patientName");
    if (!patientName || patientName.length < 2) {
      throw new Error("Patient or client name is required.");
    }

    const amountInr = Number(value(data, "amountInr", "500"));
    if (isNaN(amountInr) || amountInr <= 0) {
      throw new Error("Valid billing amount in INR is required.");
    }

    const serviceName = value(data, "serviceName", "Clinic Consultation");
    const customVpa = value(data, "customVpa") || undefined;
    const customNote = value(data, "customNote") || undefined;
    const patientPhone = value(data, "patientPhone") || undefined;

    const invoice = await createDirectInvoice(user.id, organizationId, {
      patientName,
      patientPhone,
      amountInr,
      serviceName,
      customVpa,
      customNote,
    });

    newInvoiceId = invoice.id;
  } catch (e) {
    if (e instanceof AccessError) {
      error = "You do not have permission to generate bills.";
    } else if (e instanceof Error) {
      error = e.message;
    } else {
      error = "Unable to generate UPI billing invoice.";
      logger.error({ event: "billing.invoice.create_failed" });
    }
  }

  revalidatePath(`/organizations/${organizationId}/clinic/billing`);
  if (error) {
    redirect(
      `/organizations/${organizationId}/clinic/billing?error=${encodeURIComponent(error)}`,
    );
  } else if (newInvoiceId) {
    redirect(
      `/organizations/${organizationId}/clinic/billing?activeInvoice=${encodeURIComponent(newInvoiceId)}`,
    );
  }
}

export async function markInvoiceAsPaidAction(
  organizationId: string,
  invoiceId: string,
  data: FormData,
) {
  const { user } = await requireSession();
  let error: string | undefined;

  try {
    const bankRef = value(data, "bankRefNumber");
    await markInvoiceAsPaid(user.id, organizationId, invoiceId, bankRef);
  } catch (e) {
    if (e instanceof AccessError) {
      error = "You do not have permission to update billing records.";
    } else {
      error = "Failed to mark invoice as paid.";
      logger.error({ event: "billing.invoice.paid_failed" });
    }
  }

  revalidatePath(`/organizations/${organizationId}/clinic/billing`);
  if (error) {
    redirect(
      `/organizations/${organizationId}/clinic/billing?error=${encodeURIComponent(error)}`,
    );
  }
}

export async function createPaymentLinkAction(
  organizationId: string,
  data: FormData,
) {
  const { user } = await requireSession();
  let error: string | undefined;

  try {
    const customerName = value(data, "customerName");
    if (!customerName) throw new Error("Customer name is required.");

    const amountInr = Number(value(data, "amountInr"));
    if (isNaN(amountInr) || amountInr <= 0) throw new Error("Valid amount is required.");

    const purpose = value(data, "purpose", "Medical Consultation");
    const customerPhone = value(data, "customerPhone") || undefined;
    const customerEmail = value(data, "customerEmail") || undefined;
    const preferredGateway = (value(data, "preferredGateway") || "SMART_ROUTER") as GatewayType;

    await createPaymentLink(user.id, organizationId, {
      customerName,
      customerPhone,
      customerEmail,
      amountInr,
      purpose,
      preferredGateway,
    });
  } catch (e) {
    if (e instanceof AccessError) {
      error = "You do not have permission to create payment links.";
    } else if (e instanceof Error) {
      error = e.message;
    } else {
      error = "Failed to create payment link.";
      logger.error({ event: "billing.payment_link.create_failed" });
    }
  }

  revalidatePath(`/organizations/${organizationId}/clinic/billing`);
  redirect(
    `/organizations/${organizationId}/clinic/billing?tab=links${error ? `&error=${encodeURIComponent(error)}` : ""}`,
  );
}

export async function createSubscriptionPlanAction(
  organizationId: string,
  data: FormData,
) {
  const { user } = await requireSession();
  let error: string | undefined;

  try {
    const name = value(data, "name");
    const code = value(data, "code");
    const amountInr = Number(value(data, "amountInr"));
    const interval = value(data, "interval", "monthly") as "monthly" | "quarterly" | "annual";
    const description = value(data, "description");
    const gatewayPreference = value(data, "gatewayPreference", "RAZORPAY") as "RAZORPAY" | "CASHFREE";
    const featuresRaw = value(data, "features");
    const features = featuresRaw ? featuresRaw.split(",").map((s) => s.trim()) : [];

    await createSubscriptionPlan(user.id, organizationId, {
      name,
      code,
      amountInr,
      interval,
      description,
      gatewayPreference,
      features,
    });
  } catch (e) {
    if (e instanceof AccessError) {
      error = "Permission denied to create subscription plans.";
    } else if (e instanceof Error) {
      error = e.message;
    } else {
      error = "Failed to create subscription plan.";
    }
  }

  revalidatePath(`/organizations/${organizationId}/clinic/billing`);
  redirect(
    `/organizations/${organizationId}/clinic/billing?tab=subscriptions${error ? `&error=${encodeURIComponent(error)}` : ""}`,
  );
}

export async function createCustomerSubscriptionAction(
  organizationId: string,
  data: FormData,
) {
  const { user } = await requireSession();
  let error: string | undefined;

  try {
    const planId = value(data, "planId");
    const customerName = value(data, "customerName");
    const customerPhone = value(data, "customerPhone");
    const customerEmail = value(data, "customerEmail");
    const gatewayOverride = value(data, "gatewayOverride") as "RAZORPAY" | "CASHFREE" | undefined;

    await createCustomerSubscription(user.id, organizationId, {
      planId,
      customerName,
      customerPhone,
      customerEmail,
      gatewayOverride: gatewayOverride || undefined,
    });
  } catch (e) {
    if (e instanceof AccessError) {
      error = "Permission denied to add subscribers.";
    } else if (e instanceof Error) {
      error = e.message;
    } else {
      error = "Failed to enroll subscriber.";
    }
  }

  revalidatePath(`/organizations/${organizationId}/clinic/billing`);
  redirect(
    `/organizations/${organizationId}/clinic/billing?tab=subscriptions${error ? `&error=${encodeURIComponent(error)}` : ""}`,
  );
}

export async function updateGatewayConfigAction(
  organizationId: string,
  data: FormData,
) {
  const { user } = await requireSession();
  let error: string | undefined;

  try {
    const activeGateway = value(data, "activeGateway") as GatewayType;
    const fallbackGateway = value(data, "fallbackGateway") as "RAZORPAY" | "CASHFREE" | "DIRECT_UPI";
    const smartRoutingEnabled = data.get("smartRoutingEnabled") === "on";
    const smartRouteUpiToDirect = data.get("smartRouteUpiToDirect") === "on";
    const razorpayEnabled = data.get("razorpayEnabled") === "on";
    const razorpayKeyId = value(data, "razorpayKeyId");
    const razorpayMode = value(data, "razorpayMode", "test") as "test" | "live";
    const cashfreeEnabled = data.get("cashfreeEnabled") === "on";
    const cashfreeAppId = value(data, "cashfreeAppId");
    const cashfreeMode = value(data, "cashfreeMode", "sandbox") as "sandbox" | "production";
    const directUpiVpa = value(data, "directUpiVpa");

    await updateGatewayConfig(user.id, organizationId, {
      activeGateway,
      fallbackGateway,
      smartRoutingEnabled,
      smartRouteUpiToDirect,
      razorpayEnabled,
      razorpayKeyId,
      razorpayMode,
      cashfreeEnabled,
      cashfreeAppId,
      cashfreeMode,
      directUpiVpa,
    });
  } catch (e) {
    if (e instanceof AccessError) {
      error = "Only owners or administrators can configure payment gateways.";
    } else if (e instanceof Error) {
      error = e.message;
    } else {
      error = "Failed to update payment gateway settings.";
    }
  }

  revalidatePath(`/organizations/${organizationId}/clinic/billing`);
  redirect(
    `/organizations/${organizationId}/clinic/billing?tab=gateways${error ? `&error=${encodeURIComponent(error)}` : ""}`,
  );
}

export async function payPaymentLinkAction(linkCode: string, data: FormData) {
  let error: string | undefined;

  try {
    const paymentMethod = value(data, "paymentMethod", "CREDIT_CARD") as PaymentMethod;
    const gateway = value(data, "gateway", "RAZORPAY") as "DIRECT_UPI" | "RAZORPAY" | "CASHFREE";
    const ref = `pay_${gateway.toLowerCase().slice(0, 3)}_${Math.random().toString(36).slice(2, 9)}`;

    await payPaymentLinkPublic(linkCode, paymentMethod, gateway, ref);
  } catch (e) {
    if (e instanceof Error) {
      error = e.message;
    } else {
      error = "Payment failed. Please retry.";
    }
  }

  if (error) {
    redirect(`/pay/${linkCode}?error=${encodeURIComponent(error)}`);
  } else {
    redirect(`/pay/${linkCode}?success=true`);
  }
}
