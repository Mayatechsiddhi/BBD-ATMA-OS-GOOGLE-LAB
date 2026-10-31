import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../../src/components/ui/card";
import { Button } from "../../src/components/ui/button";
import { Input } from "../../src/components/ui/input";
import type { WorkforceSnapshot } from "../../src/modules/workforce-control-plane/reader";
function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
export function operatorPage({
  nonce,
  error,
  snapshot,
}: { nonce?: string; error?: string; snapshot?: WorkforceSnapshot } = {}) {
  return (
    "<!doctype html>" +
    renderToStaticMarkup(
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>BBD Workforce — local read-only operator</title>
          <link rel="stylesheet" href="/assets/operator.css" />
        </head>
        <body>
          <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
            <header>
              <h1 className="text-2xl font-bold">BBD Workforce Operator</h1>
              <p>
                Local only · Read only · Synthetic adapters · No live agents
              </p>
            </header>
            {error && <p role="alert">{error}</p>}
            {nonce ? (
              <Panel title="Internal workforce sign in">
                <form
                  method="post"
                  action="/sign-in"
                  className="max-w-md space-y-4"
                >
                  <input type="hidden" name="csrf" value={nonce} />
                  <label className="block">
                    Email
                    <Input
                      name="email"
                      type="email"
                      autoComplete="username"
                      required
                    />
                  </label>
                  <label className="block">
                    Password
                    <Input
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      required
                      maxLength={128}
                    />
                  </label>
                  <Button type="submit">Sign in</Button>
                </form>
                <p>
                  Verified, pre-provisioned workforce accounts only. No
                  enrollment or customer accounts.
                </p>
              </Panel>
            ) : (
              <>
                <Panel title="Company scope">
                  <form
                    method="get"
                    action="/"
                    className="flex flex-wrap gap-3"
                  >
                    <label>
                      Company ID
                      <Input
                        name="company"
                        defaultValue={snapshot?.companyId}
                        required
                      />
                    </label>
                    <Button type="submit">View records</Button>
                  </form>
                  <p>
                    Company identifiers select scope; they grant no access.{" "}
                    <a href="/sign-in">Sign in</a>
                  </p>
                </Panel>
                {snapshot && (
                  <>
                    <Panel title="Snapshot">
                      <p>
                        Company {snapshot.companyId} · Role {snapshot.role} ·{" "}
                        {snapshot.paused ? "Paused" : "Not paused"}
                      </p>
                      <p>
                        Retrieved {snapshot.retrievedAt} (UTC). Refresh manually
                        for a new authorization check.
                      </p>
                      <p>
                        Stored consent is historical; execution eligibility is
                        not assessed here. A claim is not proof an agent is
                        running.
                      </p>
                      <a href={`/?company=${snapshot.companyId}`}>
                        Refresh snapshot
                      </a>
                    </Panel>
                    <Panel title="Tasks">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr>
                              {[
                                "Task",
                                "Department",
                                "Status",
                                "Claim evidence",
                                "Approval",
                                "Expiry",
                              ].map((h) => (
                                <th key={h} className="p-2">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {snapshot.tasks.map((t) => (
                              <tr key={t.id}>
                                <td className="p-2">
                                  <a
                                    href={`/?company=${snapshot.companyId}&task=${t.id}`}
                                  >
                                    {t.id}
                                  </a>
                                </td>
                                <td className="p-2">{t.department}</td>
                                <td className="p-2">{t.status}</td>
                                <td className="p-2">{t.activity}</td>
                                <td className="p-2">
                                  {t.approval.state}
                                  {t.approval.expired ? " (expired)" : ""}
                                </td>
                                <td className="p-2">{t.expiresAt}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {!snapshot.tasks.length && <p>No visible tasks.</p>}
                      {snapshot.next && (
                        <a
                          href={`/?company=${snapshot.companyId}&after=${snapshot.next}`}
                        >
                          Next 50 tasks
                        </a>
                      )}
                    </Panel>
                    {snapshot.selected && (
                      <Panel title="Task detail">
                        <dl className="space-y-2 break-words">
                          {Object.entries({
                            Task: snapshot.selected.id,
                            Status: snapshot.selected.status,
                            Activity: snapshot.selected.activity,
                            Version: snapshot.selected.version,
                            Attempts: snapshot.selected.attempts,
                            Requester: snapshot.selected.submittedBy,
                            "Recorded approval":
                              snapshot.selected.approval.state +
                              (snapshot.selected.approval.expired
                                ? " (expired)"
                                : ""),
                            "Approval expires":
                              snapshot.selected.approval.expiresAt ??
                              "Not recorded",
                            Approver:
                              snapshot.selected.approval.approver ??
                              "Not recorded",
                            Founder:
                              snapshot.selected.approval.founder ??
                              "Not recorded",
                          }).map(([k, v]) => (
                            <div key={k}>
                              <dt className="font-semibold">{k}</dt>
                              <dd>{v}</dd>
                            </div>
                          ))}
                        </dl>
                        <h3 className="mt-4 font-semibold">
                          Execution receipts
                        </h3>
                        {snapshot.selected.receipts.map((r) => (
                          <div key={r.id} className="my-3 break-words">
                            <p>
                              {r.id} · Attempt {r.attempt} · {r.status}
                            </p>
                            <p>
                              {r.executor} · Created {r.createdAt} · Finished{" "}
                              {r.finishedAt ?? "Unknown / not recorded"}
                            </p>
                            <p>
                              Current approval binding{" "}
                              {r.bindingMatches ? "matches" : "does not match"};
                              not a proof of successful execution.
                            </p>
                          </div>
                        ))}
                        {!snapshot.selected.receipts.length && (
                          <p>No execution receipts.</p>
                        )}
                        <h3 className="mt-4 font-semibold">
                          Verification evidence
                        </h3>
                        <p>{snapshot.selected.evidence}</p>
                        <p>
                          Request payloads, draft bodies, raw identities and
                          credentials are redacted.
                        </p>
                      </Panel>
                    )}
                    <Panel title="Audit events">
                      {snapshot.canAudit ? (
                        <div className="space-y-3 break-words">
                          {snapshot.audit.map((a) => (
                            <p key={a.id}>
                              #{a.id} · {a.action} · {a.createdAt} · Actor{" "}
                              {a.actor} · Subject {a.subject ?? "Not recorded"}{" "}
                              · Task {a.taskId ?? "Not applicable"} · Version{" "}
                              {a.version}
                            </p>
                          ))}
                          {!snapshot.audit.length && <p>No recorded events.</p>}
                          <p>
                            Most recent 100 events. Read access does not modify
                            the audit ledger.
                          </p>
                        </div>
                      ) : (
                        <p>
                          Audit access restricted to company APPROVER and
                          FOUNDER.
                        </p>
                      )}
                    </Panel>
                  </>
                )}
              </>
            )}
          </main>
        </body>
      </html>,
    )
  );
}
