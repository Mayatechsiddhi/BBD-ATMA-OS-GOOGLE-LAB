import { AuthForm } from "@/components/auth-form";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
export default function Page() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-md">
        <p className="mb-6 text-sm font-semibold tracking-widest text-primary">
          BHARATH BLOOM DIGITAL
        </p>
        <Card>
          <CardHeader>
            <p className="text-sm text-muted-foreground">Master ATMA OS</p>
            <CardTitle>Create your account</CardTitle>
          </CardHeader>
          <CardContent>
            <AuthForm signup={true} />
          </CardContent>
        </Card>
        <p className="mt-6 text-xs text-muted-foreground">
          Secure access to your organization’s operating system.
        </p>
      </div>
    </main>
  );
}
