import { withOrganization, audit } from "@/modules/organizations/access";
import { AccessError } from "@/modules/organizations/policy";
import { contactInput, contactStatus } from "./validation";
import { validateTransition } from "./workflow";
export async function listContacts(userId: string, organizationId: string) {
  return withOrganization(userId, organizationId, "read", async (tx) =>
    tx.contact.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    }),
  );
}
export async function createContact(
  userId: string,
  organizationId: string,
  input: unknown,
) {
  const data = contactInput.parse(input);
  return withOrganization(userId, organizationId, "crm:write", async (tx) => {
    const contact = await tx.contact.create({
      data: { ...data, organizationId },
    });
    await audit(tx, organizationId, userId, "crm.contact.created", contact.id);
    return contact;
  });
}
export async function transitionContact(
  userId: string,
  organizationId: string,
  id: string,
  input: unknown,
) {
  const status = contactStatus.parse(input);
  return withOrganization(userId, organizationId, "crm:write", async (tx) => {
    const contact = await tx.contact.findUnique({
      where: { organizationId_id: { organizationId, id } },
    });
    if (!contact) throw new AccessError();
    validateTransition(contact.status, status);
    const updated = await tx.contact.update({
      where: { organizationId_id: { organizationId, id } },
      data: { status },
    });
    await audit(
      tx,
      organizationId,
      userId,
      `crm.contact.${status.toLowerCase()}`,
      id,
    );
    return updated;
  });
}
