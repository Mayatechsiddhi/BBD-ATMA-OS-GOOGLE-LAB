import { inMemoryDb } from "@/lib/in-memory-db";
import { audit } from "@/modules/organizations/access";
import { moduleAccess } from "@/modules/entitlements/access";
import { AccessError } from "@/modules/organizations/policy";
import { buildUpiUri, generateUpiQrDataUrl, calculateGatewaySavings } from "./upi";

const withOrganization = moduleAccess("clinic");

export type BillingInvoice = {
  id: string;
  organizationId: string;
  invoiceNumber: string;
  patientName: string;
  patientPhone?: string;
  amountPaise: number;
  serviceName: string;
  vpa: string;
  payeeName: string;
  status: "PAID" | "PENDING" | "CANCELLED";
  paymentMethod: "DIRECT_UPI_P2M";
  feeSavedPaise: number;
  paidAt?: Date;
  transactionNote: string;
  referenceNumber: string;
  qrDataUrl?: string;
  createdAt: Date;
  updatedAt: Date;
};

export async function listInvoices(actor: string, orgId: string) {
  return withOrganization(actor, orgId, "read", async (tx) => {
    // Audit check and tenant context verification
    const invoices = (await inMemoryDb.billingInvoice.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
    })) as BillingInvoice[];

    // Organization info
    const org = await tx.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, slug: true },
    });

    // Recent active queue tokens to allow quick one-click billing at reception
    const tokens = await inMemoryDb.queueToken.findMany({
      where: { organizationId: orgId },
      include: {
        patient: {
          include: { lead: { select: { name: true, phone: true } } },
        },
        doctor: { select: { name: true, room: true } },
      },
      orderBy: { number: "asc" },
      take: 20,
    });

    const totalCollectedPaise = invoices
      .filter((i) => i.status === "PAID")
      .reduce((acc, curr) => acc + (curr.amountPaise || 0), 0);

    const pendingCollectionPaise = invoices
      .filter((i) => i.status === "PENDING")
      .reduce((acc, curr) => acc + (curr.amountPaise || 0), 0);

    const totalFeeSavedPaise = invoices
      .filter((i) => i.status === "PAID")
      .reduce((acc, curr) => acc + (curr.feeSavedPaise || 0), 0);

    return {
      organization: org,
      invoices,
      queueTokens: tokens,
      stats: {
        totalCollectedPaise,
        pendingCollectionPaise,
        totalFeeSavedPaise,
        totalCount: invoices.length,
        paidCount: invoices.filter((i) => i.status === "PAID").length,
      },
    };
  });
}

export async function createDirectInvoice(
  actor: string,
  orgId: string,
  input: {
    patientName: string;
    patientPhone?: string;
    amountInr: number;
    serviceName: string;
    customVpa?: string;
    customNote?: string;
  },
) {
  return withOrganization(actor, orgId, "crm:write", async (tx) => {
    const org = await tx.organization.findUnique({
      where: { id: orgId },
      select: { name: true, slug: true },
    });
    if (!org) throw new AccessError();

    const amountInr = Math.max(1, Number(input.amountInr) || 500);
    const amountPaise = Math.round(amountInr * 100);
    const savings = calculateGatewaySavings(amountInr);

    const payeeName = org.name;
    const vpa = input.customVpa?.trim() || `${org.slug.replace(/[^a-z0-9]/g, "")}@okicici`;
    const refNumber = `UPI${Date.now().toString().slice(-8)}${Math.floor(100 + Math.random() * 900)}`;
    const invoiceNumber = `INV-${Date.now().toString().slice(-6)}`;
    const transactionNote = input.customNote?.trim() || `${org.name} - ${input.serviceName.slice(0, 30)}`;

    const upiUri = buildUpiUri({
      vpa,
      payeeName,
      amount: amountInr,
      note: transactionNote,
      refId: refNumber,
    });

    const qrDataUrl = await generateUpiQrDataUrl(upiUri);

    const invoice: BillingInvoice = {
      id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      organizationId: orgId,
      invoiceNumber,
      patientName: input.patientName.trim(),
      patientPhone: input.patientPhone?.trim(),
      amountPaise,
      serviceName: input.serviceName.trim(),
      vpa,
      payeeName,
      status: "PENDING",
      paymentMethod: "DIRECT_UPI_P2M",
      feeSavedPaise: savings.savedPaise,
      transactionNote,
      referenceNumber: refNumber,
      qrDataUrl,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await inMemoryDb.billingInvoice.create({ data: invoice });
    await audit(tx, orgId, actor, "billing.invoice.created", invoice.id);

    return invoice;
  });
}

export async function markInvoiceAsPaid(
  actor: string,
  orgId: string,
  invoiceId: string,
  bankRefNumber?: string,
) {
  return withOrganization(actor, orgId, "crm:write", async (tx) => {
    const existing = (await inMemoryDb.billingInvoice.findUnique({
      where: { id: invoiceId },
    })) as BillingInvoice | null;

    if (!existing || existing.organizationId !== orgId) {
      throw new AccessError();
    }

    const updated = await inMemoryDb.billingInvoice.update({
      where: { id: invoiceId },
      data: {
        status: "PAID",
        paidAt: new Date(),
        referenceNumber: bankRefNumber?.trim() || existing.referenceNumber,
      },
    });

    await audit(tx, orgId, actor, "billing.invoice.paid", invoiceId);
    return updated;
  });
}
