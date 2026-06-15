import { CustomerForm } from "../CustomerForm";

export default function NewCustomerPage() {
  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-3xl font-bold">New Customer</h1>
      <p className="text-sm text-ink-faint mb-6">Add a bill-to party to the master.</p>
      <CustomerForm />
    </div>
  );
}
