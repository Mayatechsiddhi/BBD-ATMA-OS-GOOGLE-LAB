/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { randomUUID } from "node:crypto";

type RecordItem = Record<string, any>;

class InMemoryTable {
  public records = new Map<string, RecordItem>();
  public db?: InMemoryDb;

  constructor(public name: string) {}

  public setDb(database: InMemoryDb) {
    this.db = database;
  }

  private matchesCondition(val: any, cond: any): boolean {
    if (cond === undefined) return true;
    if (cond === null) return val === null || val === undefined;
    if (typeof cond === "object" && !(cond instanceof Date)) {
      if ("equals" in cond) return this.matchesCondition(val, cond.equals);
      if ("not" in cond) return !this.matchesCondition(val, cond.not);
      if ("in" in cond) {
        return Array.isArray(cond.in) && cond.in.includes(val);
      }
      if ("notIn" in cond) {
        return Array.isArray(cond.notIn) && !cond.notIn.includes(val);
      }
      if ("gt" in cond) return val > cond.gt;
      if ("gte" in cond) return val >= cond.gte;
      if ("lt" in cond) return val < cond.lt;
      if ("lte" in cond) return val <= cond.lte;
      if ("contains" in cond) {
        const strVal = String(val ?? "").toLowerCase();
        const search = String(cond.contains ?? "").toLowerCase();
        return strVal.includes(search);
      }
      if ("startsWith" in cond) {
        return String(val ?? "")
          .toLowerCase()
          .startsWith(String(cond.startsWith ?? "").toLowerCase());
      }
      if ("some" in cond) {
        if (!Array.isArray(val)) return false;
        return val.some((item) => this.matchesWhere(item, cond.some));
      }
      if ("none" in cond) {
        if (!Array.isArray(val)) return true;
        return !val.some((item) => this.matchesWhere(item, cond.none));
      }
    }
    if (val instanceof Date && cond instanceof Date) {
      return val.getTime() === cond.getTime();
    }
    return val === cond;
  }

  public matchesWhere(record: RecordItem, where?: Record<string, any>): boolean {
    if (!where) return true;
    const database = this.db;

    for (const [key, cond] of Object.entries(where)) {
      if (key === "AND") {
        const andList = Array.isArray(cond) ? cond : [cond];
        if (!andList.every((sub) => this.matchesWhere(record, sub))) return false;
        continue;
      }
      if (key === "OR") {
        const orList = Array.isArray(cond) ? cond : [cond];
        if (!orList.some((sub) => this.matchesWhere(record, sub))) return false;
        continue;
      }
      if (key === "NOT") {
        const notList = Array.isArray(cond) ? cond : [cond];
        if (notList.some((sub) => this.matchesWhere(record, sub))) return false;
        continue;
      }

      // Handle relation filtering (e.g. memberships: { some: { userId } })
      if (key === "memberships" && database && typeof cond === "object" && cond !== null) {
        const orgMembers = database.membership.getAll().filter((m) => m.organizationId === record.id);
        if (cond.some) {
          if (!orgMembers.some((m) => database.membership.matchesWhere(m, cond.some))) return false;
          continue;
        }
        if (cond.none) {
          if (orgMembers.some((m) => database.membership.matchesWhere(m, cond.none))) return false;
          continue;
        }
      }

      // Handle composite unique keys like organizationId_userId
      if (key.includes("_") && typeof cond === "object" && cond !== null && !(cond instanceof Date)) {
        const parts = key.split("_");
        const allPartsPresent = parts.every((p) => p in cond);
        if (allPartsPresent) {
          const match = parts.every((p) => this.matchesCondition(record[p], cond[p]));
          if (!match) return false;
          continue;
        }
      }

      if (!this.matchesCondition(record[key], cond)) {
        return false;
      }
    }
    return true;
  }

  private resolveIncludes(record: RecordItem, include?: Record<string, any>, db?: InMemoryDb): RecordItem {
    const database = db || this.db;
    if (!include || !database) return { ...record };
    const result = { ...record };

    for (const [relKey, incValue] of Object.entries(include)) {
      if (!incValue) continue;
      const subWhere = typeof incValue === "object" && incValue.where ? incValue.where : undefined;
      const subSelect = typeof incValue === "object" && incValue.select ? incValue.select : undefined;
      const subOrderBy = typeof incValue === "object" && incValue.orderBy ? incValue.orderBy : undefined;

      if (relKey === "memberships") {
        let members = database.membership.getAll().filter((m) => m.organizationId === record.id);
        if (subWhere) members = members.filter((m) => database.membership.matchesWhere(m, subWhere));
        result.memberships = members.map((m) => (subSelect ? this.applySelect(m, subSelect) : m));
      } else if (relKey === "user") {
        const u = database.user.get(record.userId);
        result.user = u ? (subSelect ? this.applySelect(u, subSelect) : { ...u }) : null;
      } else if (relKey === "lead") {
        const l = database.clinicLead.get(record.leadId);
        result.lead = l ? (subSelect ? this.applySelect(l, subSelect) : { ...l }) : null;
      } else if (relKey === "contact") {
        const c = database.contact.get(record.contactId);
        result.contact = c ? (subSelect ? this.applySelect(c, subSelect) : { ...c }) : null;
      } else if (relKey === "doctor") {
        const d = database.doctor.get(record.doctorId);
        result.doctor = d ? (subSelect ? this.applySelect(d, subSelect) : { ...d }) : null;
      } else if (relKey === "patient") {
        const p = database.patient.get(record.patientId);
        result.patient = p ? (subSelect ? this.applySelect(p, subSelect) : { ...p }) : null;
      } else if (relKey === "appointment") {
        const a = record.appointmentId ? database.appointment.get(record.appointmentId) : null;
        result.appointment = a ? (subSelect ? this.applySelect(a, subSelect) : { ...a }) : null;
      } else if (relKey === "plan") {
        const pl = database.subscriptionPlan ? database.subscriptionPlan.get(record.planId) : null;
        result.plan = pl ? (subSelect ? this.applySelect(pl, subSelect) : { ...pl }) : null;
      }
    }
    return result;
  }

  private applySelect(record: RecordItem, select?: Record<string, boolean>): RecordItem {
    if (!select) return { ...record };
    const out: RecordItem = {};
    for (const [k, v] of Object.entries(select)) {
      if (v) out[k] = record[k];
    }
    return out;
  }

  public get(id: string): RecordItem | null {
    const r = this.records.get(id);
    return r ? { ...r } : null;
  }

  public getAll(): RecordItem[] {
    return Array.from(this.records.values()).map((r) => ({ ...r }));
  }

  public async findMany(args: any = {}, db?: InMemoryDb): Promise<RecordItem[]> {
    let items = this.getAll().filter((r) => this.matchesWhere(r, args.where));

    if (args.orderBy) {
      const orderKeys = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy];
      items.sort((a, b) => {
        for (const order of orderKeys) {
          for (const [col, dir] of Object.entries(order)) {
            const va = a[col];
            const vb = b[col];
            if (va < vb) return dir === "desc" ? 1 : -1;
            if (va > vb) return dir === "desc" ? -1 : 1;
          }
        }
        return 0;
      });
    }

    if (args.skip) {
      items = items.slice(args.skip);
    }
    if (args.take !== undefined) {
      items = items.slice(0, args.take);
    }

    return items.map((r) => {
      let populated = this.resolveIncludes(r, args.include, db);
      if (args.select) populated = this.applySelect(populated, args.select);
      return populated;
    });
  }

  public async findFirst(args: any = {}, db?: InMemoryDb): Promise<RecordItem | null> {
    const list = await this.findMany({ ...args, take: 1 }, db);
    return list[0] ?? null;
  }

  public async findUnique(args: any = {}, db?: InMemoryDb): Promise<RecordItem | null> {
    if (args.where?.id) {
      const r = this.get(args.where.id);
      if (!r) return null;
      if (!this.matchesWhere(r, args.where)) return null;
      let populated = this.resolveIncludes(r, args.include, db);
      if (args.select) populated = this.applySelect(populated, args.select);
      return populated;
    }
    return this.findFirst(args, db);
  }

  public async findUniqueOrThrow(args: any = {}, db?: InMemoryDb): Promise<RecordItem> {
    const item = await this.findUnique(args, db);
    if (!item) {
      const err = new Error(`An operation failed because it depends on one or more records that were required but not found in ${this.name}`);
      (err as any).code = "P2025";
      throw err;
    }
    return item;
  }

  public async create(args: any = {}, db?: InMemoryDb): Promise<RecordItem> {
    const now = new Date();
    const id = args.data?.id || randomUUID();
    const item: RecordItem = {
      ...args.data,
      id,
      createdAt: args.data?.createdAt || now,
      updatedAt: args.data?.updatedAt || now,
    };
    if (this.name === "user") {
      item.emailVerified = true;
    }
    this.records.set(id, item);
    let populated = this.resolveIncludes(item, args.include, db);
    if (args.select) populated = this.applySelect(populated, args.select);
    return populated;
  }

  public async createMany(args: any = {}): Promise<{ count: number }> {
    const list = Array.isArray(args.data) ? args.data : [args.data];
    let count = 0;
    for (const d of list) {
      await this.create({ data: d });
      count++;
    }
    return { count };
  }

  private applyPatch(existing: RecordItem, data: Record<string, any> = {}): RecordItem {
    const patch: RecordItem = {};
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
        const op = v as any;
        if ("increment" in op) {
          patch[k] = (Number(existing[k]) || 0) + Number(op.increment);
          continue;
        }
        if ("decrement" in op) {
          patch[k] = (Number(existing[k]) || 0) - Number(op.decrement);
          continue;
        }
        if ("set" in op) {
          patch[k] = op.set;
          continue;
        }
      }
      patch[k] = v;
    }
    return patch;
  }

  public async update(args: any = {}, db?: InMemoryDb): Promise<RecordItem> {
    const existing = await this.findUnique(args, db);
    if (!existing) {
      const err = new Error(`Record to update not found in ${this.name}`);
      (err as any).code = "P2025";
      throw err;
    }
    const patch = this.applyPatch(existing, args.data);
    const updated: RecordItem = {
      ...existing,
      ...patch,
      updatedAt: new Date(),
    };
    this.records.set(existing.id, updated);
    let populated = this.resolveIncludes(updated, args.include, db);
    if (args.select) populated = this.applySelect(populated, args.select);
    return populated;
  }

  public async updateMany(args: any = {}): Promise<{ count: number }> {
    const targets = this.getAll().filter((r) => this.matchesWhere(r, args.where));
    for (const t of targets) {
      const patch = this.applyPatch(t, args.data);
      const updated = {
        ...t,
        ...patch,
        updatedAt: new Date(),
      };
      this.records.set(t.id, updated);
    }
    return { count: targets.length };
  }

  public async upsert(args: any = {}, db?: InMemoryDb): Promise<RecordItem> {
    const existing = await this.findUnique({ where: args.where }, db);
    if (existing) {
      return this.update({ where: { id: existing.id }, data: args.update, include: args.include, select: args.select }, db);
    }
    return this.create({ data: args.create, include: args.include, select: args.select }, db);
  }

  public async delete(args: any = {}): Promise<RecordItem> {
    const existing = await this.findUnique(args);
    if (!existing) {
      const err = new Error(`Record to delete not found in ${this.name}`);
      (err as any).code = "P2025";
      throw err;
    }
    this.records.delete(existing.id);
    return existing;
  }

  public async deleteMany(args: any = {}): Promise<{ count: number }> {
    const targets = this.getAll().filter((r) => this.matchesWhere(r, args.where));
    for (const t of targets) {
      this.records.delete(t.id);
    }
    return { count: targets.length };
  }

  public async count(args: any = {}): Promise<number> {
    return this.getAll().filter((r) => this.matchesWhere(r, args.where)).length;
  }

  public async groupBy(args: any = {}): Promise<any[]> {
    const byKey = Array.isArray(args.by) ? args.by[0] : args.by;
    const items = this.getAll().filter((r) => this.matchesWhere(r, args.where));
    const counts = new Map<any, number>();
    for (const item of items) {
      const key = item[byKey];
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const result: any[] = [];
    for (const [key, cnt] of counts.entries()) {
      result.push({
        [byKey]: key,
        _count: { _all: cnt, [byKey]: cnt },
      });
    }
    return result;
  }
}

export class InMemoryDb {
  public user = new InMemoryTable("user");
  public session = new InMemoryTable("session");
  public account = new InMemoryTable("account");
  public verification = new InMemoryTable("verification");
  public rateLimit = new InMemoryTable("rateLimit");
  public organization = new InMemoryTable("organization");
  public membership = new InMemoryTable("membership");
  public invitation = new InMemoryTable("invitation");
  public auditEvent = new InMemoryTable("auditEvent");
  public contact = new InMemoryTable("contact");
  public opportunity = new InMemoryTable("opportunity");
  public clinicLead = new InMemoryTable("clinicLead");
  public appointment = new InMemoryTable("appointment");
  public followUp = new InMemoryTable("followUp");
  public patient = new InMemoryTable("patient");
  public doctor = new InMemoryTable("doctor");
  public queueToken = new InMemoryTable("queueToken");
  public organizationModule = new InMemoryTable("organizationModule");
  public outboxEvent = new InMemoryTable("outboxEvent");
  public billingInvoice = new InMemoryTable("billingInvoice");
  public gatewayConfig = new InMemoryTable("gatewayConfig");
  public subscriptionPlan = new InMemoryTable("subscriptionPlan");
  public subscription = new InMemoryTable("subscription");
  public paymentLink = new InMemoryTable("paymentLink");

  public currentActorId = "system";
  public currentOrgId = "";

  constructor() {
    this.user.setDb(this);
    this.session.setDb(this);
    this.account.setDb(this);
    this.verification.setDb(this);
    this.rateLimit.setDb(this);
    this.organization.setDb(this);
    this.membership.setDb(this);
    this.invitation.setDb(this);
    this.auditEvent.setDb(this);
    this.contact.setDb(this);
    this.opportunity.setDb(this);
    this.clinicLead.setDb(this);
    this.appointment.setDb(this);
    this.followUp.setDb(this);
    this.patient.setDb(this);
    this.doctor.setDb(this);
    this.queueToken.setDb(this);
    this.organizationModule.setDb(this);
    this.outboxEvent.setDb(this);
    this.billingInvoice.setDb(this);
    this.gatewayConfig.setDb(this);
    this.subscriptionPlan.setDb(this);
    this.subscription.setDb(this);
    this.paymentLink.setDb(this);

    this.seedDefaultData();
  }

  private seedDefaultData() {
    // Seed default demo user and organization
    const userId = "usr_bbd_admin";
    const orgId = "org_bbd_master";

    this.user.create({
      data: {
        id: userId,
        name: "BBD Administrator",
        email: "admin@bbd.com",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    this.account.create({
      data: {
        id: "acc_bbd_admin",
        accountId: userId,
        providerId: "credential",
        userId: userId,
        password:
          "48ea5232f982cdc9521ceb09d078666b:e6c12ce1475824734d5943ba8bbea66bd4a8b9a37e9ade7a6984137e0ed9fa485520f56cbb34290d80d2bc1ef3b7732458543de265f8f2cf4a0155eb7e6bda92",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    this.organization.create({
      data: {
        id: orgId,
        name: "Bharath Bloom Digital",
        slug: "bbd-master",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    this.membership.create({
      data: {
        id: "mem_bbd_admin",
        organizationId: orgId,
        userId: userId,
        role: "OWNER",
        createdAt: new Date(),
      },
    });

    // Seed modules
    for (const mod of ["crm", "clinic"]) {
      this.organizationModule.create({
        data: {
          id: `mod_${orgId}_${mod}`,
          organizationId: orgId,
          moduleId: mod,
          enabled: true,
          version: 1,
        },
      });
    }

    // Seed demo clinic doctor
    this.doctor.create({
      data: {
        id: "doc_1",
        organizationId: orgId,
        name: "Dr. A. Sharma",
        room: "Consultation 101",
        resource: "Dr. A. Sharma",
        revision: 0,
        scheduleVersion: 1,
        schedule: {
          duration: 30,
          weekly: [
            { weekday: 1, start: 540, end: 1020, breakStart: 780, breakEnd: 840 },
            { weekday: 2, start: 540, end: 1020, breakStart: 780, breakEnd: 840 },
            { weekday: 3, start: 540, end: 1020, breakStart: 780, breakEnd: 840 },
            { weekday: 4, start: 540, end: 1020, breakStart: 780, breakEnd: 840 },
            { weekday: 5, start: 540, end: 1020, breakStart: 780, breakEnd: 840 },
          ],
          leave: [],
        },
      },
    });

    // Seed demo contact
    this.contact.create({
      data: {
        id: "cnt_1",
        organizationId: orgId,
        name: "Ravi Kumar",
        email: "ravi.kumar@example.com",
        company: "Apex Enterprises",
        status: "LEAD",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Seed demo clinic lead
    this.clinicLead.create({
      data: {
        id: "lead_1",
        organizationId: orgId,
        name: "Priya Patel",
        phone: "+91 98765 43210",
        email: "priya.patel@example.com",
        source: "WALK_IN",
        status: "NEW",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const todayStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    this.patient.create({
      data: {
        id: "pat_1",
        organizationId: orgId,
        leadId: "lead_1",
        createdAt: new Date(),
      },
    });

    this.queueToken.create({
      data: {
        id: "tok_1",
        organizationId: orgId,
        patientId: "pat_1",
        leadId: "lead_1",
        doctorId: "doc_1",
        day: todayStr,
        number: 101,
        status: "CALLED",
        callCount: 1,
        calledAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    this.queueToken.create({
      data: {
        id: "tok_2",
        organizationId: orgId,
        patientId: "pat_1",
        leadId: "lead_1",
        doctorId: "doc_1",
        day: todayStr,
        number: 102,
        status: "WAITING",
        callCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    this.queueToken.create({
      data: {
        id: "tok_3",
        organizationId: orgId,
        patientId: "pat_1",
        leadId: "lead_1",
        doctorId: "doc_1",
        day: todayStr,
        number: 103,
        status: "WAITING",
        callCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Seed initial 0%-fee Direct UPI invoices for org_bbd_master
    this.billingInvoice.create({
      data: {
        id: "inv_101",
        organizationId: orgId,
        invoiceNumber: "INV-2026-0101",
        patientName: "Sunita Patel",
        patientPhone: "+91 98765 43210",
        amountPaise: 50000, // ₹500.00
        serviceName: "General Physician Consultation",
        vpa: "bharathbloom@okicici",
        payeeName: "Bharath Bloom Digital",
        status: "PAID",
        paymentMethod: "DIRECT_UPI_P2M",
        feeSavedPaise: 1180, // ₹11.80 saved vs 2% + GST gateway fee
        paidAt: new Date(Date.now() - 3600000),
        transactionNote: "BBD Clinic - Token 101 - Dr. Sharma",
        referenceNumber: "UPI26101149204",
        createdAt: new Date(Date.now() - 3600000),
        updatedAt: new Date(Date.now() - 3600000),
      },
    });

    this.billingInvoice.create({
      data: {
        id: "inv_102",
        organizationId: orgId,
        invoiceNumber: "INV-2026-0102",
        patientName: "Arjun Verma",
        patientPhone: "+91 91234 56789",
        amountPaise: 100000, // ₹1,000.00
        serviceName: "Specialist Consultation & ECG",
        vpa: "bharathbloom@okicici",
        payeeName: "Bharath Bloom Digital",
        status: "PENDING",
        paymentMethod: "DIRECT_UPI_P2M",
        feeSavedPaise: 2360, // ₹23.60 saved
        transactionNote: "BBD Clinic - Token 102 - Dr. Sharma",
        referenceNumber: "UPI26102830119",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Seed Second Organization: BBD Health & Medical Spa (for multi-tenant switching)
    const healthOrgId = "org_bbd_health";
    this.organization.create({
      data: {
        id: healthOrgId,
        name: "BBD Health & Medical Spa",
        slug: "bbd-medispa",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    this.membership.create({
      data: {
        id: "mem_bbd_health_admin",
        organizationId: healthOrgId,
        userId: userId,
        role: "OWNER",
        createdAt: new Date(),
      },
    });

    for (const mod of ["crm", "clinic"]) {
      this.organizationModule.create({
        data: {
          id: `mod_${healthOrgId}_${mod}`,
          organizationId: healthOrgId,
          moduleId: mod,
          enabled: true,
          version: 1,
        },
      });
    }

    this.doctor.create({
      data: {
        id: "doc_2",
        organizationId: healthOrgId,
        name: "Dr. Priya Patel",
        room: "Consultation 202",
        resource: "Dr. Priya Patel",
        revision: 0,
        scheduleVersion: 1,
        schedule: {
          duration: 20,
          weekly: [
            { day: 1, start: "09:00", end: "17:00" },
            { day: 2, start: "09:00", end: "17:00" },
            { day: 3, start: "09:00", end: "17:00" },
            { day: 4, start: "09:00", end: "17:00" },
            { day: 5, start: "09:00", end: "17:00" },
          ],
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    this.billingInvoice.create({
      data: {
        id: "inv_201",
        organizationId: healthOrgId,
        invoiceNumber: "INV-SPA-001",
        patientName: "Meera Nair",
        patientPhone: "+91 99887 76655",
        amountPaise: 250000, // ₹2,500.00
        serviceName: "Comprehensive Wellness Assessment",
        vpa: "bbdmedispa@okaxis",
        payeeName: "BBD Health & Medical Spa",
        status: "PAID",
        paymentMethod: "DIRECT_UPI_P2M",
        feeSavedPaise: 5900, // ₹59.00 saved
        paidAt: new Date(),
        transactionNote: "Medispa Consultation - Dr. Patel",
        referenceNumber: "UPI26201991204",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Seed Gateway Configurations for org_bbd_master
    this.gatewayConfig.create({
      data: {
        id: `gwcfg_${orgId}`,
        organizationId: orgId,
        activeGateway: "SMART_ROUTER", // Smart Router auto-routes UPI to 0%-fee Direct QR, Cards to Razorpay/Cashfree
        fallbackGateway: "CASHFREE",
        smartRoutingEnabled: true,
        smartRouteUpiToDirect: true,
        razorpayEnabled: true,
        razorpayKeyId: "rzp_test_bbd_k9210a",
        razorpayKeySecret: "rzp_test_sec_bbd_99318",
        razorpayMode: "test",
        cashfreeEnabled: true,
        cashfreeAppId: "cf_test_bbd_app_8201",
        cashfreeSecretKey: "cf_test_sec_bbd_88192",
        cashfreeMode: "sandbox",
        directUpiVpa: "bharathbloom@okicici",
        autoRefundOnFailure: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Seed Gateway Configurations for org_bbd_health
    this.gatewayConfig.create({
      data: {
        id: `gwcfg_${healthOrgId}`,
        organizationId: healthOrgId,
        activeGateway: "SMART_ROUTER",
        fallbackGateway: "RAZORPAY",
        smartRoutingEnabled: true,
        smartRouteUpiToDirect: true,
        razorpayEnabled: true,
        razorpayKeyId: "rzp_test_medispa_k101",
        razorpayKeySecret: "rzp_test_sec_medispa_s202",
        razorpayMode: "test",
        cashfreeEnabled: true,
        cashfreeAppId: "cf_test_medispa_app_303",
        cashfreeSecretKey: "cf_test_sec_medispa_sec_404",
        cashfreeMode: "sandbox",
        directUpiVpa: "bbdmedispa@okaxis",
        autoRefundOnFailure: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Seed Subscription Plans for org_bbd_master
    this.subscriptionPlan.create({
      data: {
        id: "plan_wellness_monthly",
        organizationId: orgId,
        name: "Monthly Family Care OPD Pass",
        code: "OPD-MONTHLY",
        interval: "monthly",
        amountPaise: 99900, // ₹999/mo
        description: "Unlimited general physician visits, zero-wait token queue priority, and 15% lab discounts.",
        gatewayPreference: "RAZORPAY",
        features: ["Unlimited General OPD Consultations", "Priority Token Kiosk Allocation", "15% Diagnostic & Blood Test Discount", "Electronic Medical Health Locker"],
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    this.subscriptionPlan.create({
      data: {
        id: "plan_diabetes_chronic",
        organizationId: orgId,
        name: "Chronic Disease & Diabetes Shield",
        code: "CHRONIC-CARE",
        interval: "monthly",
        amountPaise: 149900, // ₹1,499/mo
        description: "Comprehensive monthly monitoring for diabetes, hypertension, and cardiac vitals.",
        gatewayPreference: "CASHFREE",
        features: ["Monthly HbA1c & Blood Sugar Check", "Dedicated Dietitian Tele-Consult", "Monthly Endocrinologist Review", "Automated Prescription Refill Reminders"],
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    this.subscriptionPlan.create({
      data: {
        id: "plan_senior_annual",
        organizationId: orgId,
        name: "Senior Citizen Annual Wellness Pass",
        code: "SENIOR-ANNUAL",
        interval: "annual",
        amountPaise: 499900, // ₹4,999/yr
        description: "Year-long geriatric protection package with quarterly full-body profiling.",
        gatewayPreference: "RAZORPAY",
        features: ["Quarterly Comprehensive Body Profiles", "Complimentary Home Sample Collection", "24/7 Priority Emergency Tele-Consult", "Dedicated Nurse Care Coordinator"],
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Seed Active Recurring Subscriptions
    this.subscription.create({
      data: {
        id: "sub_101",
        organizationId: orgId,
        planId: "plan_wellness_monthly",
        customerName: "Vikram Sen",
        customerPhone: "+91 98111 22233",
        customerEmail: "vikram.sen@example.com",
        gateway: "RAZORPAY",
        gatewaySubscriptionId: "sub_rzp_9812903",
        status: "ACTIVE",
        autoDebitEnabled: true,
        amountPaise: 99900,
        interval: "monthly",
        currentPeriodStart: new Date(Date.now() - 5 * 86400000),
        currentPeriodEnd: new Date(Date.now() + 25 * 86400000),
        nextChargeDate: new Date(Date.now() + 25 * 86400000),
        lastPaymentStatus: "SUCCESS",
        createdAt: new Date(Date.now() - 35 * 86400000),
        updatedAt: new Date(),
      },
    });

    this.subscription.create({
      data: {
        id: "sub_102",
        organizationId: orgId,
        planId: "plan_diabetes_chronic",
        customerName: "Ananya Roy",
        customerPhone: "+91 97222 33344",
        customerEmail: "ananya.roy@example.com",
        gateway: "CASHFREE",
        gatewaySubscriptionId: "sub_cf_110928",
        status: "ACTIVE",
        autoDebitEnabled: true,
        amountPaise: 149900,
        interval: "monthly",
        currentPeriodStart: new Date(Date.now() - 16 * 86400000),
        currentPeriodEnd: new Date(Date.now() + 14 * 86400000),
        nextChargeDate: new Date(Date.now() + 14 * 86400000),
        lastPaymentStatus: "SUCCESS",
        createdAt: new Date(Date.now() - 46 * 86400000),
        updatedAt: new Date(),
      },
    });

    // Seed Hosted Payment Links
    this.paymentLink.create({
      data: {
        id: "plink_1",
        organizationId: orgId,
        linkCode: "bbd_pay_9012",
        customerName: "Rahul Mehta",
        customerPhone: "+91 98888 77766",
        customerEmail: "rahul.mehta@example.com",
        amountPaise: 150000, // ₹1,500.00
        purpose: "Comprehensive ECG & Cardiac Consult",
        gateway: "SMART_ROUTER",
        status: "ACTIVE",
        shortUrl: "/pay/bbd_pay_9012",
        expiresAt: new Date(Date.now() + 3 * 86400000),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    this.paymentLink.create({
      data: {
        id: "plink_2",
        organizationId: orgId,
        linkCode: "bbd_pay_8471",
        customerName: "Kavita Rao",
        customerPhone: "+91 97777 66655",
        customerEmail: "kavita.rao@example.com",
        amountPaise: 50000, // ₹500.00
        purpose: "Pediatric Consultation",
        gateway: "RAZORPAY",
        status: "PAID",
        paymentMethod: "CREDIT_CARD",
        referenceNumber: "pay_rzp_991823",
        shortUrl: "/pay/bbd_pay_8471",
        paidAt: new Date(Date.now() - 86400000),
        expiresAt: new Date(Date.now() + 2 * 86400000),
        createdAt: new Date(Date.now() - 86400000),
        updatedAt: new Date(Date.now() - 86400000),
      },
    });
  }

  public async $transaction<T>(fn: (tx: any) => Promise<T>, _options?: any): Promise<T> {
    return fn(this);
  }

  public async $executeRaw(..._args: any[]): Promise<number> {
    return 1;
  }

  public async $queryRaw<T = any>(query: any, ...values: any[]): Promise<T> {
    const rawSql = typeof query === "string" ? query : (query?.strings ? query.strings.join("?") : String(query));

    // Handle privilege audit & missing grant checks (return empty array = no drift/missing grants)
    if (rawSql.includes("findings AS") || rawSql.includes("pg_default_acl") || rawSql.includes("runtimePrivilegeAudit") || rawSql.includes("runtimeRequiredPrivileges")) {
      return [] as unknown as T;
    }

    // Handle assertRuntimeDatabase check
    if (rawSql.includes("protectedTables") || rawSql.includes("transactionContext")) {
      return [
        {
          unsafe: false,
          protectedTables: 14,
          transactionContext: true,
        },
      ] as unknown as T;
    }

    // Handle bbd_private.create_organization
    if (rawSql.includes("SELECT * FROM bbd_private.create_organization")) {
      const qVals = Array.isArray(query?.values) ? query.values : [];
      const id = qVals[0] || values[0] || randomUUID();
      const name = qVals[1] || values[1] || "New Organization";
      const slug = qVals[2] || values[2] || `org-${Date.now()}`;
      const now = new Date();
      const org = {
        id,
        name,
        slug,
        createdAt: now,
        updatedAt: now,
      };
      this.organization.records.set(id, org);

      if (this.currentActorId) {
        const memId = randomUUID();
        this.membership.records.set(memId, {
          id: memId,
          organizationId: id,
          userId: this.currentActorId,
          role: "OWNER",
          createdAt: now,
        });
        const auditId = randomUUID();
        this.auditEvent.records.set(auditId, {
          id: auditId,
          organizationId: id,
          actorId: this.currentActorId,
          action: "organization.created",
          createdAt: now,
        });
      }
      return [org] as unknown as T;
    }

    // Handle SELECT 1 (health check)
    if (rawSql.trim().toUpperCase().startsWith("SELECT 1")) {
      return [{ "?column?": 1 }] as unknown as T;
    }

    // Handle QueueToken board query
    if (rawSql.includes("QueueToken")) {
      const qVals = Array.isArray(query?.values) ? query.values : values;
      const orgId = qVals[0] || this.currentOrgId;
      const day = qVals[1];
      const tokens = this.queueToken.getAll().filter(
        (t) => (!orgId || t.organizationId === orgId) && (!day || t.day === day) && (t.status === "CALLED" || t.status === "WAITING")
      );
      return tokens.map((t) => ({
        doctorId: t.doctorId,
        number: t.number,
        callCount: t.callCount ?? 1,
        status: t.status,
      })) as unknown as T;
    }

    // Handle set_config
    if (rawSql.includes("set_config")) {
      const qVals = Array.isArray(query?.values) ? query.values : values;
      if (qVals[0]) this.currentActorId = qVals[0];
      if (qVals[1]) this.currentOrgId = qVals[1];
      return [{ set_config: "" }] as unknown as T;
    }

    return [] as unknown as T;
  }

  public async $disconnect(): Promise<void> {
    return;
  }

  public async $connect(): Promise<void> {
    return;
  }
}

// Global singleton for hot-reloads
const globalStore = globalThis as unknown as { inMemoryDbInstance?: InMemoryDb };
export const inMemoryDb = globalStore.inMemoryDbInstance ?? new InMemoryDb();
if (process.env.NODE_ENV !== "production") {
  globalStore.inMemoryDbInstance = inMemoryDb;
}
