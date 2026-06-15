import { VendorForm } from "../VendorForm";

export default function NewVendorPage() {
  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-3xl font-bold">New Vendor</h1>
      <p className="text-sm text-ink-faint mb-6">Add a vendor to the master.</p>
      <VendorForm />
    </div>
  );
}
