import { z } from "zod";
import { audit } from "@/modules/organizations/access";
import { moduleAccess } from "@/modules/entitlements/access";
const withOrganization = moduleAccess("crm");
import { AccessError } from "@/modules/organizations/policy";
import type { Prisma } from "@/generated/prisma/client";
import {
  OpportunityError,
  stageInput,
  opportunityNext,
  opportunityInput,
  opportunityQuery,
} from "./opportunity-rules";
export {
  OpportunityError,
  stages,
  opportunityNext,
  opportunityInput,
  opportunityQuery,
} from "./opportunity-rules";
export async function createOpportunity(
  actor: string,
  org: string,
  input: unknown,
) {
  const data = opportunityInput.parse(input);
  return withOrganization(actor, org, "crm:write", async (tx) => {
    const contact = await tx.contact.findUnique({
      where: { organizationId_id: { organizationId: org, id: data.contactId } },
    });
    if (!contact) throw new AccessError();
    const existing = await tx.opportunity.findUnique({
      where: {
        organizationId_requestKey: {
          organizationId: org,
          requestKey: data.requestKey,
        },
      },
    });
    if (existing) {
      if (
        existing.contactId !== data.contactId ||
        existing.title !== data.title ||
        existing.amountPaise !== data.amount
      )
        throw new OpportunityError(
          "This form was already submitted with different values. Reload to create another opportunity.",
        );
      return existing;
    }
    if (contact.status === "ARCHIVED")
      throw new OpportunityError("Choose an active contact.");
    const opportunity = await tx.opportunity.create({
      data: {
        organizationId: org,
        contactId: data.contactId,
        title: data.title,
        amountPaise: data.amount,
        requestKey: data.requestKey,
      },
    });
    await audit(tx, org, actor, "crm.opportunity.created", opportunity.id);
    return opportunity;
  });
}
export async function transitionOpportunity(
  actor: string,
  org: string,
  id: string,
  version: unknown,
  input: unknown,
) {
  const stage = stageInput.parse(input);
  const expected = z.coerce
    .number()
    .int()
    .min(0)
    .max(2147483646)
    .parse(version);
  return withOrganization(actor, org, "crm:write", async (tx) => {
    const opportunity = await tx.opportunity.findUnique({
      where: { organizationId_id: { organizationId: org, id } },
    });
    if (!opportunity) throw new AccessError();
    if (opportunity.version !== expected)
      throw new OpportunityError(
        "This opportunity changed. Reload and try again.",
      );
    if (!opportunityNext[opportunity.stage]?.includes(stage))
      throw new OpportunityError("That stage change is not allowed.");
    const result = await tx.opportunity.update({
      where: { organizationId_id: { organizationId: org, id } },
      data: { stage, version: { increment: 1 } },
    });
    await audit(tx, org, actor, `crm.opportunity.${stage.toLowerCase()}`, id);
    return result;
  });
}
export async function listOpportunities(
  actor: string,
  org: string,
  input: unknown = {},
) {
  const query = opportunityQuery.parse(input);
  return withOrganization(actor, org, "read", async (tx) => {
    const where: Prisma.OpportunityWhereInput = {
      organizationId: org,
      ...(query.stage ? { stage: query.stage } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: "insensitive" } },
              {
                contact: {
                  name: { contains: query.search, mode: "insensitive" },
                },
              },
              {
                contact: {
                  email: { contains: query.search, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    };
    return {
      page: query.page,
      total: await tx.opportunity.count({ where }),
      counts: await tx.opportunity.groupBy({
        by: ["stage"],
        where: { organizationId: org },
        _count: { _all: true },
      }),
      opportunities: await tx.opportunity.findMany({
        where,
        include: { contact: { select: { name: true, email: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (query.page - 1) * 25,
        take: 25,
      }),
    };
  });
}
