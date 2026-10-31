// Isolated test process only; no shell or adapter execution in the controller.
import { createWorkforceControlPlane } from "../../src/modules/workforce-control-plane/control";
if (process.env.NODE_ENV !== "test") throw Error("Fixture worker only");
const url = new URL(process.env.WORKFORCE_RUNTIME_DATABASE_URL!);
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !url.pathname.endsWith("_test")
)
  throw Error("Local fixture only");
let text = "";
for await (const chunk of process.stdin) {
  text += chunk;
  if (text.length > 4096) throw Error("Bounded fixture input");
}
const data = JSON.parse(text),
  control = await createWorkforceControlPlane();
try {
  const task = (await control.command(
    new Headers({ cookie: data.cookie }),
    data.company,
    "claim",
    data.command,
  )) as { version: number };
  console.log(JSON.stringify({ ok: true, version: task.version }));
} catch {
  console.log(JSON.stringify({ ok: false }));
} finally {
  await control.close();
}
